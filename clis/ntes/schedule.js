import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { HOME_URL, SITE, requireTrainNumber, parseLimit, rowsWithRank, runNtesPage, scriptHelpers } from './utils.js';

export function buildScheduleActionScript(trainNumber) {
    return `(() => {
    const input = document.querySelector('#trainNo');
    if (!input || typeof showTrainSchedule !== 'function') return { ok: false, error: 'schedule form not found' };
    input.value = ${JSON.stringify(trainNumber)};
    showTrainSchedule('B');
    return { ok: true };
  })()`;
}

export function buildScheduleExtractScript() {
    return `(() => {
    ${scriptHelpers()}
    const table = Array.from(document.querySelectorAll('table')).find((t) => {
      const text = clean(t.innerText);
      return text.includes('Sr.') && text.includes('Station') && text.includes('Dist.');
    });
    if (!table) return { ok: true, rows: [] };
    const rows = tableRows(table).slice(1).filter((cells) => cells.length >= 6 && /^\\d+$/.test(cells[0]));
    return { ok: true, rows: rows.map((cells) => {
      let stationParts = cells[1].split(/\\n| {2,}/).map(clean).filter(Boolean);
      if (stationParts.length === 1) {
        const match = stationParts[0].match(/^(.+)\\s+([A-Z]{2,5})$/);
        if (match) stationParts = [match[1], match[2]];
      }
      let times = cells[3].split(/\\n| {2,}/).map(clean).filter(Boolean);
      if (times.length === 1) {
        const match = times[0].match(/^(SRC|DSTN|\\d{1,2}:\\d{2})\\s+(SRC|DSTN|\\d{1,2}:\\d{2})$/);
        if (match) times = [match[1], match[2]];
      }
      return {
        station: stationParts[0] || '',
        code: stationParts[1] || '',
        day: cells[2] || '',
        arrival: times[0] || '',
        departure: times[1] || '',
        halt: cells[4] || '',
        distanceKm: cells[5] || '',
      };
    }) };
  })()`;
}

export const command = cli({
    site: SITE,
    name: 'schedule',
    access: 'read',
    description: 'NTES train schedule stops',
    example: 'webcmd ntes schedule 12951 --limit 8',
    domain: 'enquiry.indianrail.gov.in',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'train', type: 'string', required: true, positional: true, help: '5 digit train number' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of stops to return (max 20)' },
    ],
    columns: ['rank', 'trainNumber', 'station', 'code', 'day', 'arrival', 'departure', 'halt', 'distanceKm', 'url'],
    func: async (page, kwargs) => {
        const trainNumber = requireTrainNumber(kwargs.train);
        const limit = parseLimit(kwargs.limit, 'ntes schedule');
        const rows = await runNtesPage(page, buildScheduleActionScript(trainNumber), buildScheduleExtractScript(), 'ntes schedule');
        return rowsWithRank(rows, limit, (row) => ({
            trainNumber,
            station: row.station || '',
            code: row.code || '',
            day: row.day || '',
            arrival: row.arrival || '',
            departure: row.departure || '',
            halt: row.halt || '',
            distanceKm: row.distanceKm || '',
            url: HOME_URL,
        }));
    },
});

export const __test__ = {
    command,
    buildScheduleActionScript,
    buildScheduleExtractScript,
};
