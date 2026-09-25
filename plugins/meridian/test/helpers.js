import { vi } from 'vitest';

const SESSION_COOKIE = { name: 'session_token', value: 'sess_test' };

// Interprets the page scripts utils.js emits (location probe, cookie check,
// fetch kickoff/poll slots, sessionStorage chat state) so command funcs can run
// against the real utils flow without a browser.
export function makeMeridianPage({
    href = 'https://app.getmeridian.tech/app/initiatives',
    cookies = [SESSION_COOKIE],
    fetchResults = [],
    pageState = {},
} = {}) {
    const remaining = [...fetchResults];
    const storageKey = (script) => {
        const match = script.match(/(?:getItem|setItem|removeItem)\((".*?")/);
        return match ? JSON.parse(match[1]) : null;
    };
    const page = {
        state: { storage: { ...pageState }, kickoffs: [] },
        goto: vi.fn(async () => {}),
        wait: vi.fn(async () => {}),
        getCookies: vi.fn(async () => cookies),
        evaluate: vi.fn(async (script) => {
            if (script.includes('window.location.href')) return href;
            if (script.includes('sessionStorage.getItem')) return page.state.storage[storageKey(script)] ?? '';
            if (script.includes('sessionStorage.setItem')) {
                const match = script.match(/setItem\([^,]+,\s*(".*")\)/s);
                if (match) page.state.storage[storageKey(script)] = JSON.parse(match[1]);
                return true;
            }
            if (script.includes('sessionStorage.removeItem')) {
                delete page.state.storage[storageKey(script)];
                return true;
            }
            if (script.includes('__webcmdMeridianFetch') && script.includes('fetch(')) {
                page.state.kickoffs.push(script);
                return true;
            }
            if (script.includes('__webcmdMeridianFetch')) {
                return remaining.length ? remaining.shift() : { pending: true };
            }
            throw new Error(`makeMeridianPage: unhandled script: ${script.slice(0, 120)}`);
        }),
    };
    return page;
}

export function okFetch(data, status = 200) {
    return { pending: false, status, ok: status >= 200 && status < 300, data };
}

export function failFetch(status, data = null) {
    return { pending: false, status, ok: false, data };
}
