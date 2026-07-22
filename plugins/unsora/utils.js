import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const HOST = 'tryunsora.com';
export const ROOT_URL = `https://${HOST}/`;

export async function loadHomepage(page) {
    await page.goto(ROOT_URL, { waitUntil: 'load', settleMs: 1000 });
}

export function requireRows(result, command) {
    if (!result || typeof result !== 'object') {
        throw new CommandExecutionError(`Unsora ${command} extraction returned an unreadable response`);
    }
    const rows = Array.isArray(result.rows) ? result.rows : [];
    if (!rows.length) {
        throw new EmptyResultError(`unsora ${command}`, `No ${command} information was found on Unsora's public site. The page layout may have changed.`);
    }
    return rows;
}
