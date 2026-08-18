import { readFile, stat } from 'node:fs/promises';
import { htmlToMarkdown as coreHtmlToMarkdown } from '@agentrhq/webcmd/utils';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    ConfigError,
    EmptyResultError,
} from '@agentrhq/webcmd/errors';

const USER_AGENT = 'webcmd-atlassian-adapter (+https://github.com/agentrhq/webcmd)';
const DEPLOYMENTS = new Set(['cloud', 'datacenter', 'auto']);

function firstEnv(names) {
    for (const name of names) {
        const value = process.env[name]?.trim();
        if (value) return value;
    }
    return '';
}

function normalizeBaseUrl(value, label) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new ConfigError(`Missing ${label}`, `Set ${label}, for example https://example.atlassian.net`);
    }
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new ConfigError(`Invalid ${label}: ${raw}`, 'Use an absolute http(s) URL.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new ConfigError(`Invalid ${label}: ${raw}`, 'Use an http(s) URL.');
    }
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/+$/, '');
}

function parseDeployment(raw, baseUrl) {
    const value = String(raw || 'auto').trim().toLowerCase();
    if (!DEPLOYMENTS.has(value)) {
        throw new ConfigError('Invalid ATLASSIAN_DEPLOYMENT', 'Expected one of: cloud, datacenter, auto.');
    }
    if (value !== 'auto') return value;
    const host = new URL(baseUrl).hostname;
    return host === 'atlassian.net' || host.endsWith('.atlassian.net') ? 'cloud' : 'datacenter';
}

function normalizeConfluenceBaseUrl(baseUrl, deployment) {
    if (deployment !== 'cloud') return baseUrl;
    const parsed = new URL(baseUrl);
    const path = parsed.pathname.replace(/\/+$/, '');
    if (path === '/wiki' || path.endsWith('/wiki')) return baseUrl;
    parsed.pathname = `${path}/wiki`;
    return parsed.toString().replace(/\/+$/, '');
}

function resolveAuthHeaders(deployment) {
    const bearer = firstEnv(['ATLASSIAN_BEARER_TOKEN', 'ATLASSIAN_OAUTH_TOKEN']);
    if (bearer) return { Authorization: `Bearer ${bearer}` };

    const pat = firstEnv(['ATLASSIAN_PAT', 'CONFLUENCE_PAT']);
    if (deployment === 'datacenter' && pat) return { Authorization: `Bearer ${pat}` };

    const email = firstEnv(['ATLASSIAN_EMAIL', 'ATLASSIAN_USERNAME', 'CONFLUENCE_EMAIL', 'CONFLUENCE_USERNAME']);
    const token = firstEnv(['ATLASSIAN_API_TOKEN', 'ATLASSIAN_PASSWORD', 'CONFLUENCE_API_TOKEN', 'CONFLUENCE_PASSWORD']);
    if (email && token) {
        return { Authorization: `Basic ${Buffer.from(`${email}:${token}`, 'utf8').toString('base64')}` };
    }

    if (deployment === 'cloud') {
        throw new ConfigError(
            'Missing Atlassian Cloud credentials',
            'Set ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN, or set ATLASSIAN_BEARER_TOKEN for OAuth.',
        );
    }
    throw new ConfigError(
        'Missing Atlassian Data Center credentials',
        'Set ATLASSIAN_PAT, ATLASSIAN_BEARER_TOKEN, or ATLASSIAN_USERNAME plus ATLASSIAN_PASSWORD.',
    );
}

export function getConfluenceConfig() {
    const initialBaseUrl = normalizeBaseUrl(
        firstEnv(['ATLASSIAN_CONFLUENCE_BASE_URL', 'CONFLUENCE_BASE_URL']),
        'ATLASSIAN_CONFLUENCE_BASE_URL',
    );
    const deployment = parseDeployment(process.env.ATLASSIAN_DEPLOYMENT, initialBaseUrl);
    return {
        product: 'confluence',
        baseUrl: normalizeConfluenceBaseUrl(initialBaseUrl, deployment),
        deployment,
        authHeaders: resolveAuthHeaders(deployment),
    };
}

function summarizeApiError(parsed, fallback) {
    if (parsed && typeof parsed === 'object') {
        const messages = [];
        if (Array.isArray(parsed.errorMessages)) messages.push(...parsed.errorMessages.filter(Boolean));
        if (typeof parsed.message === 'string') messages.push(parsed.message);
        if (typeof parsed.error === 'string') messages.push(parsed.error);
        if (typeof parsed.reason === 'string') messages.push(parsed.reason);
        if (parsed.errors && typeof parsed.errors === 'object') {
            for (const [key, value] of Object.entries(parsed.errors)) messages.push(`${key}: ${String(value)}`);
        }
        if (messages.length) return messages.join(' \u00b7 ');
    }
    if (typeof parsed === 'string' && parsed.trim()) return parsed.trim().slice(0, 300);
    return fallback;
}

async function parseResponseBody(response, label) {
    let text;
    try {
        text = await response.text();
    } catch (error) {
        throw new CommandExecutionError(
            `${label} response body could not be read: ${error?.message ?? error}`,
            'Check whether the Atlassian instance, proxy, or network interrupted the response.',
        );
    }
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

export async function atlassianRequest(config, apiPath, options = {}) {
    const method = (options.method ?? 'GET').toUpperCase();
    const label = options.label ?? `${config.product} ${method} ${apiPath}`;
    const headers = {
        'user-agent': USER_AGENT,
        accept: 'application/json',
        ...config.authHeaders,
        ...(options.headers ?? {}),
    };
    let body;
    if (options.body !== undefined) {
        headers['content-type'] = headers['content-type'] ?? 'application/json';
        body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const url = /^https?:\/\//i.test(apiPath)
        ? apiPath
        : `${config.baseUrl}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
    let response;
    try {
        response = await fetch(url, { method, headers, body });
    } catch (error) {
        throw new CommandExecutionError(
            `${label} request failed: ${error?.message ?? error}`,
            'Check the Atlassian base URL, VPN/network access, and proxy settings.',
        );
    }

    const parsed = await parseResponseBody(response, label);
    if (response.status === 401) {
        throw new AuthRequiredError(
            config.baseUrl,
            `${label} returned HTTP 401`,
            'Check Atlassian credentials and whether this instance accepts the configured auth method.',
        );
    }
    if (response.status === 403) {
        throw new AuthRequiredError(
            config.baseUrl,
            `${label} returned HTTP 403: ${summarizeApiError(parsed, 'forbidden')}`,
            'The authenticated user lacks permission for this Confluence page or space.',
        );
    }
    if (response.status === 404) throw new EmptyResultError(label, `Atlassian returned 404 for ${url}.`);
    if (response.status === 409) {
        throw new CommandExecutionError(
            `${label} returned HTTP 409: ${summarizeApiError(parsed, 'version conflict')}`,
            'Reload the current Confluence page version and retry the update.',
        );
    }
    if (response.status === 429) {
        throw new CommandExecutionError(`${label} returned HTTP 429 (rate limited)`, 'Wait and retry with a smaller limit.');
    }
    if (!response.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${response.status}: ${summarizeApiError(parsed, response.statusText)}`);
    }
    if (typeof parsed === 'string') {
        throw new CommandExecutionError(
            `${label} returned a non-JSON response`,
            'Expected Atlassian REST API JSON. Check the base URL and whether an HTML login, SSO, or proxy page was returned.',
        );
    }
    return parsed;
}

export function queryString(params) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
            for (const item of value) query.append(key, String(item));
        } else {
            query.set(key, String(value));
        }
    }
    const value = query.toString();
    return value ? `?${value}` : '';
}

export function requireString(value, label) {
    const string = String(value ?? '').trim();
    if (!string) throw new ArgumentError(`${label} is required`);
    return string;
}

export function requirePayloadObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new CommandExecutionError(`${label} returned an unexpected payload shape; expected an object.`);
    }
    return value;
}

export function requirePayloadArray(value, label) {
    if (!Array.isArray(value)) {
        throw new CommandExecutionError(`${label} returned an unexpected payload shape; expected an array.`);
    }
    return value;
}

export function requirePayloadString(value, field, label) {
    if (typeof value !== 'string' && typeof value !== 'number') {
        throw new CommandExecutionError(`${label} did not include a stable ${field}.`);
    }
    const string = String(value).trim();
    if (!string) throw new CommandExecutionError(`${label} did not include a stable ${field}.`);
    return string;
}

export function requireNonEmptyRows(rows, label, hint) {
    if (!rows.length) throw new EmptyResultError(label, hint);
    return rows;
}

export function parseLimit(value, defaultValue = 20, maxValue = 100, label = 'limit') {
    const raw = value ?? defaultValue;
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new ArgumentError(`${label} must be a positive integer`);
    if (parsed > maxValue) throw new ArgumentError(`${label} must be <= ${maxValue}`);
    return parsed;
}

export function requireExecute(args, commandName) {
    if (args.execute !== true) {
        throw new ArgumentError(`${commandName} requires --execute to perform a remote write`);
    }
}

export async function readUtf8File(filePath) {
    const path = requireString(filePath, '--file');
    let fileStat;
    try {
        fileStat = await stat(path);
    } catch {
        throw new ArgumentError(`File not found: ${path}`);
    }
    if (!fileStat.isFile()) throw new ArgumentError(`File must be a readable text file: ${path}`);
    let raw;
    try {
        raw = await readFile(path);
    } catch {
        throw new ArgumentError(`File could not be read: ${path}`);
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
        throw new ArgumentError(`File could not be decoded as UTF-8 text: ${path}`);
    }
}

export function htmlToMarkdown(html) {
    return coreHtmlToMarkdown(String(html ?? ''));
}

function htmlEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderInlineMarkdown(value) {
    const source = String(value ?? '');
    const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    let output = '';
    let last = 0;
    for (const match of source.matchAll(linkPattern)) {
        output += htmlEscape(source.slice(last, match.index));
        output += `<a href="${htmlEscape(match[2])}">${htmlEscape(match[1])}</a>`;
        last = match.index + match[0].length;
    }
    output += htmlEscape(source.slice(last));
    return output
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function isMarkdownTable(lines, index) {
    return lines[index]?.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? '');
}

function parseTableRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderMarkdownTable(lines, start) {
    const rows = [parseTableRow(lines[start])];
    let index = start + 2;
    while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
    }
    const htmlRows = rows.map((row, rowIndex) => {
        const tag = rowIndex === 0 ? 'th' : 'td';
        return `<tr>${row.map((cell) => `<${tag}>${renderInlineMarkdown(cell)}</${tag}>`).join('')}</tr>`;
    }).join('');
    return { html: `<table><tbody>${htmlRows}</tbody></table>`, next: index };
}

export function markdownToConfluenceStorage(markdown) {
    const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
    const output = [];
    const listStack = [];
    let index = 0;
    let inCode = false;
    let codeLines = [];

    const closeOneList = () => {
        const current = listStack.pop();
        if (!current) return;
        if (current.liOpen) output.push('</li>');
        output.push(`</${current.tag}>`);
    };
    const closeListsTo = (indent) => {
        while (listStack.length && listStack[listStack.length - 1].indent > indent) closeOneList();
    };
    const closeAllLists = () => {
        while (listStack.length) closeOneList();
    };
    const openList = (tag, indent) => {
        output.push(`<${tag}>`);
        listStack.push({ tag, indent, liOpen: false });
    };
    const renderListItem = (tag, indent, text) => {
        closeListsTo(indent);
        let current = listStack[listStack.length - 1];
        if (current && current.indent === indent && current.tag !== tag) {
            closeOneList();
            current = listStack[listStack.length - 1];
        }
        if (!current || current.indent < indent) {
            openList(tag, indent);
            current = listStack[listStack.length - 1];
        }
        if (current.indent === indent && current.liOpen) output.push('</li>');
        output.push(`<li>${renderInlineMarkdown(text)}`);
        current.liOpen = true;
    };

    while (index < lines.length) {
        const line = lines[index];
        if (/^```/.test(line)) {
            if (inCode) {
                output.push(`<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[${codeLines.join('\n')}]]></ac:plain-text-body></ac:structured-macro>`);
                codeLines = [];
            } else {
                closeAllLists();
            }
            inCode = !inCode;
            index += 1;
            continue;
        }
        if (inCode) {
            codeLines.push(line);
            index += 1;
            continue;
        }
        if (!line.trim()) {
            closeAllLists();
            index += 1;
            continue;
        }
        if (isMarkdownTable(lines, index)) {
            closeAllLists();
            const table = renderMarkdownTable(lines, index);
            output.push(table.html);
            index = table.next;
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            closeAllLists();
            output.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`);
            index += 1;
            continue;
        }
        const unordered = line.match(/^(\s*)[-*]\s+(.+)$/);
        const ordered = line.match(/^(\s*)\d+\.\s+(.+)$/);
        if (unordered || ordered) {
            const match = unordered || ordered;
            renderListItem(unordered ? 'ul' : 'ol', match[1].replace(/\t/g, '  ').length, match[2]);
            index += 1;
            continue;
        }
        closeAllLists();
        output.push(`<p>${renderInlineMarkdown(line)}</p>`);
        index += 1;
    }

    closeAllLists();
    if (inCode) {
        output.push(`<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[${codeLines.join('\n')}]]></ac:plain-text-body></ac:structured-macro>`);
    }
    return output.join('\n');
}
