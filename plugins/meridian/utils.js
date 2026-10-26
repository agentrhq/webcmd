import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@agentrhq/webcmd/errors';

export const MERIDIAN_DOMAIN = 'getmeridian.tech';
// The React app lives on the app subdomain (the apex serves a static marketing
// site) and calls the API cross-origin, authenticated by an httpOnly
// `session_token` cookie (SameSite=None) issued by the API host.
export const MERIDIAN_APP_ORIGIN = 'https://app.getmeridian.tech';
export const MERIDIAN_API_ORIGIN = 'https://api.getmeridian.tech';
export const SESSION_COOKIE_NAME = 'session_token';

export function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function requireNonEmptyText(value, label, example) {
    const text = String(value ?? '').trim();
    if (!text) throw new ArgumentError(`${label} cannot be empty`, example);
    return text;
}

export function requireProjectId(value) {
    const id = String(value ?? '').trim();
    if (!id) {
        throw new ArgumentError(
            'a Meridian project id is required',
            'List projects with: webcmd meridian projects',
        );
    }
    return id;
}

export function requireBoundedInt(value, fallback, min, max, label) {
    const raw = value ?? fallback;
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new ArgumentError(`${label} must be an integer between ${min} and ${max}, got ${JSON.stringify(value)}`);
    }
    return parsed;
}

export function parseBoolFlag(value) {
    if (typeof value === 'boolean') return value;
    return String(value ?? '').trim().toLowerCase() === 'true';
}

export function toHttpsUrlOrNull(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    try {
        const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

export async function isOnMeridianApp(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    if (typeof url !== 'string' || !url) return false;
    try {
        const host = new URL(url).hostname;
        // Vibe preview origins are excluded from the platform CORS allowlist,
        // so they cannot serve as a fetch origin for API calls.
        return (host === MERIDIAN_DOMAIN || host.endsWith(`.${MERIDIAN_DOMAIN}`)) && !host.includes('preview.');
    } catch {
        return false;
    }
}

export async function ensureOnMeridianApp(page) {
    if (await isOnMeridianApp(page)) return false;
    await page.goto(`${MERIDIAN_APP_ORIGIN}/`, { waitUntil: 'load', settleMs: 1000 });
    return true;
}

export async function hasMeridianSessionCookie(page) {
    const cookies = await page.getCookies({ url: `${MERIDIAN_API_ORIGIN}/` });
    return cookies.some((cookie) => cookie.name === SESSION_COOKIE_NAME && cookie.value);
}

export async function ensureMeridianSession(page) {
    await ensureOnMeridianApp(page);
    if (!await hasMeridianSessionCookie(page)) {
        throw new AuthRequiredError(
            MERIDIAN_DOMAIN,
            'No Meridian session in this browser profile. Run `webcmd meridian login`, sign in (or sign up) in the opened browser, then retry.',
        );
    }
}

// CDP evaluate calls have a hard 30s cap, while Meridian's Astra endpoints can
// legitimately run for minutes (LLM turns + web research). Kick the fetch off
// inside the page, park the outcome on a window slot, and poll it with short
// evaluates until it settles. The page origin (app.getmeridian.tech) is on the
// platform CORS allowlist, and `credentials: 'include'` rides the same
// httpOnly session cookie the app itself uses.
function buildFetchKickoffScript(slot, path, method, body) {
    return `(() => {
      var store = window.__webcmdMeridianFetch = window.__webcmdMeridianFetch || {};
      store[${JSON.stringify(slot)}] = { pending: true };
      var init = { method: ${JSON.stringify(method)}, credentials: 'include', headers: { 'Accept': 'application/json' } };
      var body = ${JSON.stringify(body ?? null)};
      if (body !== null) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      fetch(${JSON.stringify(`${MERIDIAN_API_ORIGIN}/api${path}`)}, init)
        .then(function(res) {
          return res.text().then(function(text) {
            var data = null;
            try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 2000) }; }
            store[${JSON.stringify(slot)}] = { pending: false, status: res.status, ok: res.ok, data: data };
          });
        })
        .catch(function(err) {
          store[${JSON.stringify(slot)}] = { pending: false, error: String((err && err.message) || err) };
        });
      return true;
    })()`;
}

function buildFetchPollScript(slot) {
    return `(() => {
      var store = window.__webcmdMeridianFetch || {};
      var entry = store[${JSON.stringify(slot)}];
      if (!entry) return { pending: false, error: 'request slot lost (page navigated mid-request)' };
      if (!entry.pending) delete store[${JSON.stringify(slot)}];
      return entry;
    })()`;
}

function extractErrorDetail(data) {
    const detail = data && typeof data === 'object' ? data.detail : null;
    if (typeof detail === 'string') return { message: detail, code: '' };
    if (detail && typeof detail === 'object') {
        return { message: String(detail.message ?? ''), code: String(detail.code ?? '') };
    }
    return { message: '', code: '' };
}

export async function apiFetch(page, path, { method = 'GET', body = null, timeoutSeconds = 120, label = path } = {}) {
    await ensureMeridianSession(page);
    const slot = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const kicked = await page.evaluate(buildFetchKickoffScript(slot, path, method, body));
    if (kicked !== true) {
        throw new CommandExecutionError(`Meridian ${label} request could not start in the browser page`);
    }

    const deadline = Date.now() + timeoutSeconds * 1000;
    let entry = null;
    while (Date.now() < deadline) {
        entry = await page.evaluate(buildFetchPollScript(slot));
        if (entry && entry.pending === false) break;
        await page.wait(1);
    }

    if (!entry || entry.pending !== false) {
        throw new CommandExecutionError(
            `Meridian ${label} did not finish within ${timeoutSeconds}s. Re-run with a higher --timeout if Astra is still working.`,
        );
    }
    if (entry.error) {
        throw new CommandExecutionError(`Meridian ${label} failed: ${entry.error}`);
    }
    if (entry.ok) return entry.data;

    const { message, code } = extractErrorDetail(entry.data);
    if (entry.status === 401) {
        throw new AuthRequiredError(
            MERIDIAN_DOMAIN,
            `Meridian ${label} returned HTTP 401${message ? ` (${message})` : ''}. Run \`webcmd meridian login\` and sign in, then retry.`,
        );
    }
    if (entry.status === 402) {
        throw new CommandExecutionError(
            `Meridian ${label} needs more credits${message ? `: ${message}` : ''}. Top up in the Meridian app, then retry.`,
        );
    }
    if (entry.status === 403 && code === 'subscription_required') {
        throw new CommandExecutionError(`Meridian ${label} requires an active subscription: ${message}`);
    }
    if (entry.status === 403) {
        throw new AuthRequiredError(MERIDIAN_DOMAIN, `Meridian ${label} returned HTTP 403${message ? ` (${message})` : ''}.`);
    }
    throw new CommandExecutionError(
        `Meridian ${label} returned HTTP ${entry.status}${message ? `: ${message}` : ''}`,
    );
}

// Long jobs (project creation, competitor scans) return {job_id}; poll the
// jobs endpoint until the job settles.
export async function pollJob(page, jobId, { timeoutSeconds = 300, label = 'job' } = {}) {
    const id = String(jobId ?? '').trim();
    if (!id) throw new CommandExecutionError(`Meridian ${label} did not return a job id`);
    const deadline = Date.now() + timeoutSeconds * 1000;
    let job = null;
    while (Date.now() < deadline) {
        job = await apiFetch(page, `/jobs/${encodeURIComponent(id)}`, { timeoutSeconds: 30, label: `${label} status` });
        const status = String(job?.status ?? '');
        if (status === 'completed') return job;
        if (status === 'failed') {
            throw new CommandExecutionError(`Meridian ${label} failed: ${normalizeText(job?.error) || 'unknown job error'}`);
        }
        await page.wait(2);
    }
    const stage = normalizeText(job?.stage);
    throw new CommandExecutionError(
        `Meridian ${label} is still running after ${timeoutSeconds}s${stage ? ` (${stage})` : ''}. Re-run with a higher --timeout.`,
    );
}

// Chat drafts are stateless on the server side of a turn — the client owns the
// running messages/assessment. Park that state in sessionStorage of the
// persistent site tab so consecutive calls continue one conversation.
export const IDEATION_STATE_KEY = 'webcmd-meridian-ideation';

export function personaStateKey(projectId) {
    return `webcmd-meridian-persona-${projectId}`;
}

export async function loadPageState(page, key, fallback) {
    const raw = await page.evaluate(
        `(() => { try { return window.sessionStorage.getItem(${JSON.stringify(key)}) || ''; } catch { return ''; } })()`,
    );
    if (typeof raw !== 'string' || !raw) return { ...fallback };
    try {
        const state = JSON.parse(raw);
        return state && typeof state === 'object' ? { ...fallback, ...state } : { ...fallback };
    } catch {
        return { ...fallback };
    }
}

export async function savePageState(page, key, state) {
    await page.evaluate(
        `(() => { try { window.sessionStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); return true; } catch { return false; } })()`,
    );
}

export async function clearPageState(page, key) {
    await page.evaluate(
        `(() => { try { window.sessionStorage.removeItem(${JSON.stringify(key)}); return true; } catch { return false; } })()`,
    );
}

export function newDraftSessionId() {
    return `draft_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// Mirrors the frontend's collectTurnSources: web-research findings from the
// sub-agent trail plus competitive-landscape visual items, deduped by URL.
export function collectTurnSources(turn) {
    const sources = [];
    const seen = new Set();
    const push = (title, url) => {
        const link = normalizeText(url);
        if (!link || seen.has(link)) return;
        seen.add(link);
        const name = normalizeText(title);
        sources.push(name && name !== link ? `${name} — ${link}` : link);
    };
    for (const agent of Array.isArray(turn?.agents) ? turn.agents : []) {
        for (const finding of Array.isArray(agent?.findings) ? agent.findings : []) {
            push(finding?.title, finding?.url);
        }
    }
    for (const item of Array.isArray(turn?.visual?.items) ? turn.visual.items : []) {
        push(item?.name, item?.url);
    }
    return sources.join(' | ');
}

export function formatSuggestions(suggestions) {
    if (!Array.isArray(suggestions)) return '';
    return suggestions
        .map((item) => {
            if (typeof item === 'string') return normalizeText(item);
            const label = normalizeText(item?.label);
            const value = normalizeText(item?.value);
            return label && value && label !== value ? `${label}: ${value}` : (value || label);
        })
        .filter(Boolean)
        .join(' | ');
}

export function formatConfidence(confidence, fields) {
    return fields
        .map((field) => {
            const value = Number(confidence?.[field]);
            return `${field}=${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
        })
        .join(' ');
}
