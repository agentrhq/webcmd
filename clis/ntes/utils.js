import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const SITE = 'ntes';
export const HOME_URL = 'https://enquiry.indianrail.gov.in/mntes/';
const MAX_LIMIT = 20;

const STATIONS = new Map([
    ['MMCT', 'MMCT - MUMBAI CENTRAL'],
    ['BCT', 'MMCT - MUMBAI CENTRAL'],
    ['NDLS', 'NDLS - NEW DELHI'],
    ['NZM', 'NZM - HAZRAT NIZAMUDDIN JN'],
    ['BVI', 'BVI - BORIVALI'],
    ['ST', 'ST - SURAT'],
    ['BRC', 'BRC - VADODARA JN'],
    ['CSMT', 'CSMT - CHHATRAPATI SHIVAJI MAHARAJ TERMINUS'],
    ['LTT', 'LTT - LOKMANYATILAK'],
]);

export function cleanText(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function requireTrainNumber(value) {
    const raw = cleanText(value);
    if (!/^\d{5}$/.test(raw)) {
        throw new ArgumentError('ntes train must be a 5 digit train number', 'Example: webcmd ntes status 12951 --station MMCT');
    }
    return raw;
}

export function stationInput(value) {
    const raw = cleanText(value).toUpperCase();
    if (!raw) {
        throw new ArgumentError('ntes station code cannot be empty', 'Example: webcmd ntes station MMCT');
    }
    if (/^[A-Z]{2,5}$/.test(raw))
        return STATIONS.get(raw) || raw;
    return raw;
}

export function stationCode(value) {
    const raw = cleanText(value).toUpperCase();
    const match = raw.match(/^([A-Z]{2,5})\b/) || raw.match(/\b([A-Z]{2,5})$/);
    return match ? match[1] : raw;
}

export function parseLimit(value, commandName) {
    const n = value == null || value === '' ? 10 : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
        throw new ArgumentError(`${commandName} --limit must be an integer between 1 and ${MAX_LIMIT}`, `Example: webcmd ${commandName} --limit 5`);
    }
    return n;
}

export function parseHours(value) {
    const n = value == null || value === '' ? 2 : Number(value);
    if (![2, 4, 8].includes(n)) {
        throw new ArgumentError('ntes station --hours must be one of 2, 4, or 8', 'Example: webcmd ntes station MMCT --hours 2');
    }
    return n;
}

export function requireRows(result, commandName) {
    if (!result || typeof result !== 'object') {
        throw new CommandExecutionError(`${commandName} page returned malformed extraction data`, 'NTES may have changed its page structure.');
    }
    if (result.ok === false) {
        throw new CommandExecutionError(`${commandName} extraction failed: ${result.error || 'unknown error'}`, 'Open the official NTES page in Chrome and retry.');
    }
    const rows = Array.isArray(result.rows) ? result.rows : [];
    if (!rows.length) {
        throw new EmptyResultError(commandName, 'No visible NTES rows were found. Try another train/station or retry later if NTES is unavailable.');
    }
    return rows;
}

export async function runNtesPage(page, actionScript, extractScript, commandName) {
    await page.goto(HOME_URL);
    await page.wait(1);
    const action = await page.evaluate(actionScript);
    if (action && action.ok === false)
        throw new CommandExecutionError(`${commandName} UI action failed: ${action.error || 'unknown error'}`);
    await page.wait(4);
    return requireRows(await page.evaluate(extractScript), commandName);
}

export function rowsWithRank(rows, limit, mapRow) {
    return rows.slice(0, limit).map((row, index) => ({ rank: index + 1, ...mapRow(row) }));
}

export function scriptHelpers() {
    return `
    const clean = (value) => String(value || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
    const cellText = (cell) => clean(cell && cell.innerText);
    const tableRows = (table) => Array.from(table.rows || []).map((row) => Array.from(row.cells || []).map(cellText));
  `;
}

export const __test__ = {
    cleanText,
    requireTrainNumber,
    stationInput,
    stationCode,
    parseLimit,
    parseHours,
    requireRows,
};
