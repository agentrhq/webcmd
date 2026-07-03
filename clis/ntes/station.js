import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { HOME_URL, SITE, parseHours, parseLimit, requireRows, rowsWithRank, scriptHelpers, stationCode, stationInput } from './utils.js';

export function buildStationActionScript(stationValue, hours) {
    return `(() => {
    const form = document.frmSTN;
    if (!form || typeof onLiveStationSubmit !== 'function') return { ok: false, error: 'Live Station form not found' };
    form.jFromStationInput.value = ${JSON.stringify(stationValue)};
    form.jToStationInput.value = '';
    const radio = Array.from(form.elements.nHr || []).find((el) => String(el.value) === ${JSON.stringify(String(hours))});
    if (radio) radio.checked = true;
    onLiveStationSubmit();
    return { ok: true };
  })()`;
}

export function buildOpenStationMenuScript() {
    return `(() => {
    const menu = Array.from(document.querySelectorAll('a')).find((a) => (a.innerText || '').includes('Live Station'));
    if (!menu) return { ok: false, error: 'Live Station menu not found' };
    menu.click();
    return { ok: true };
  })()`;
}

export function buildStationExtractScript() {
    return `(() => {
    ${scriptHelpers()}
    if (/Requested service.*un-available/i.test(document.body.innerText || '')) {
      return { ok: false, error: 'NTES live station service unavailable' };
    }
    const table = Array.from(document.querySelectorAll('table')).find((t) => {
      const text = clean(t.innerText);
      return text.includes('Trains departing from/arriving at') && text.includes('Train No./Name');
    });
    if (!table) return { ok: true, rows: [] };
    const rows = tableRows(table).filter((cells) => cells.length >= 5 && /^\\d+$/.test(cells[0]));
    return { ok: true, rows: rows.map((cells) => {
      const lines = cells[1].split('\\n').map(clean).filter(Boolean);
      const head = lines[0] || '';
      const match = head.match(/^(\\d{5})\\s*\\|\\s*(.+)$/);
      const depLines = cells[3].split('\\n').map(clean).filter(Boolean);
      const arrLines = cells[2].split('\\n').map(clean).filter(Boolean);
      return {
        trainNumber: match ? match[1] : '',
        trainName: match ? match[2] : head,
        route: lines[1] || '',
        arrival: arrLines[0] || '',
        departure: depLines[0] || '',
        status: depLines.find((line) => /time|mins?|late|early/i.test(line)) || arrLines.find((line) => /time|mins?|late|early/i.test(line)) || '',
        platform: clean(cells[4]).replace(/Coach Position/i, '').replace(/\\*/g, ''),
      };
    }) };
  })()`;
}

export const command = cli({
    site: SITE,
    name: 'station',
    access: 'read',
    description: 'NTES live station departures and arrivals',
    example: 'webcmd ntes station MMCT --hours 2 --limit 5',
    domain: 'enquiry.indianrail.gov.in',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'station', type: 'string', required: true, positional: true, help: 'Station code or NTES station label' },
        { name: 'hours', type: 'int', default: 2, choices: ['2', '4', '8'], help: 'Lookahead window in hours' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of trains to return (max 20)' },
    ],
    columns: ['rank', 'station', 'trainNumber', 'trainName', 'route', 'arrival', 'departure', 'status', 'platform', 'url'],
    func: async (page, kwargs) => {
        const stationValue = stationInput(kwargs.station);
        const code = stationCode(stationValue);
        const hours = parseHours(kwargs.hours);
        const limit = parseLimit(kwargs.limit, 'ntes station');
        await page.goto(HOME_URL);
        await page.wait(1);
        await page.evaluate(buildOpenStationMenuScript());
        await page.wait(2);
        const action = await page.evaluate(buildStationActionScript(stationValue, hours));
        if (action && action.ok === false)
            throw new CommandExecutionError(`ntes station UI action failed: ${action.error || 'Live Station submit failed'}`);
        await page.wait(4);
        const rows = requireRows(await page.evaluate(buildStationExtractScript()), 'ntes station');
        return rowsWithRank(rows, limit, (row) => ({
            station: code,
            trainNumber: row.trainNumber || '',
            trainName: row.trainName || '',
            route: row.route || '',
            arrival: row.arrival || '',
            departure: row.departure || '',
            status: row.status || '',
            platform: row.platform || '',
            url: HOME_URL,
        }));
    },
});

export const __test__ = {
    command,
    buildOpenStationMenuScript,
    buildStationActionScript,
    buildStationExtractScript,
};
