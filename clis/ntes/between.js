import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { HOME_URL, SITE, parseLimit, requireRows, rowsWithRank, scriptHelpers, stationCode, stationInput } from './utils.js';

export function buildBetweenActionScript(fromStation, toStation) {
    return `(() => {
    const form = document.frmTBS;
    if (!form || typeof onTBS !== 'function') return { ok: false, error: 'Trains B/w Stations form not found' };
    form.jFromStationInput.value = ${JSON.stringify(fromStation)};
    form.jToStationInput.value = ${JSON.stringify(toStation)};
    onTBS();
    return { ok: true };
  })()`;
}

export function buildOpenBetweenMenuScript() {
    return `(() => {
    const menu = Array.from(document.querySelectorAll('a')).find((a) => (a.innerText || '').includes('Trains B/w Stations'));
    if (!menu) return { ok: false, error: 'Trains B/w Stations menu not found' };
    menu.click();
    return { ok: true };
  })()`;
}

export function buildBetweenExtractScript() {
    return `(() => {
    ${scriptHelpers()}
    const table = Array.from(document.querySelectorAll('table')).find((t) => {
      const text = clean(t.innerText);
      return /Trains found from/.test(text) && /See Train Status/.test(text);
    });
    if (!table) return { ok: true, rows: [] };
    const rows = Array.from(table.rows || [])
      .map((row) => Array.from(row.cells || [])[0])
      .filter(Boolean)
      .map((cell) => cell.innerText || '')
      .filter((text) => /^\\d{5}/.test(clean(text)));
    return { ok: true, rows: rows.map((text) => {
      const lines = text.split('\\n').map(clean).filter(Boolean).filter((line) => line !== 'See Train Status >>');
      const head = lines[0] || '';
      const match = head.match(/^(\\d{5})\\s+(.+)$/);
      const meta = (lines[1] || '').split('|').map(clean);
      const durationIndex = lines.findIndex((line) => /^--.*Hrs\\.?.*--$/.test(line));
      let arriveIndex = durationIndex >= 0 ? durationIndex + 1 : -1;
      const maybeClasses = arriveIndex >= 0 && !/^\\d{1,2}:\\d{2}$/.test(lines[arriveIndex] || '') && /^\\d{1,2}:\\d{2}$/.test(lines[arriveIndex + 1] || '');
      if (maybeClasses) arriveIndex += 1;
      return {
        trainNumber: match ? match[1] : '',
        trainName: match ? match[2] : head,
        days: meta[0] || '',
        departTime: lines[2] || '',
        departStation: lines[3] || '',
        duration: durationIndex >= 0 ? lines[durationIndex].replace(/^--|--$/g, '') : '',
        arriveTime: arriveIndex >= 0 ? lines[arriveIndex] || '' : '',
        arriveStation: arriveIndex >= 0 ? lines[arriveIndex + 1] || '' : '',
      };
    }) };
  })()`;
}

export const command = cli({
    site: SITE,
    name: 'between',
    access: 'read',
    description: 'NTES trains between two stations',
    example: 'webcmd ntes between MMCT NDLS --limit 5',
    domain: 'enquiry.indianrail.gov.in',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'from', type: 'string', required: true, positional: true, help: 'Origin station code or NTES station label' },
        { name: 'to', type: 'string', required: true, positional: true, help: 'Destination station code or NTES station label' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of trains to return (max 20)' },
    ],
    columns: ['rank', 'trainNumber', 'trainName', 'from', 'to', 'days', 'departTime', 'departStation', 'arriveTime', 'arriveStation', 'duration', 'url'],
    func: async (page, kwargs) => {
        const fromValue = stationInput(kwargs.from);
        const toValue = stationInput(kwargs.to);
        const from = stationCode(fromValue);
        const to = stationCode(toValue);
        const limit = parseLimit(kwargs.limit, 'ntes between');
        await page.goto(HOME_URL);
        await page.wait(1);
        await page.evaluate(buildOpenBetweenMenuScript());
        await page.wait(2);
        const action = await page.evaluate(buildBetweenActionScript(fromValue, toValue));
        if (action && action.ok === false)
            throw new CommandExecutionError(`ntes between UI action failed: ${action.error || 'Trains B/w Stations submit failed'}`);
        await page.wait(4);
        const rows = requireRows(await page.evaluate(buildBetweenExtractScript()), 'ntes between');
        return rowsWithRank(rows, limit, (row) => ({
            trainNumber: row.trainNumber || '',
            trainName: row.trainName || '',
            from,
            to,
            days: row.days || '',
            departTime: row.departTime || '',
            departStation: row.departStation || '',
            arriveTime: row.arriveTime || '',
            arriveStation: row.arriveStation || '',
            duration: row.duration || '',
            url: HOME_URL,
        }));
    },
});

export const __test__ = {
    command,
    buildOpenBetweenMenuScript,
    buildBetweenActionScript,
    buildBetweenExtractScript,
};
