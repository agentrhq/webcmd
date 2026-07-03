import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { HOME_URL, SITE, parseLimit, requireRows, requireTrainNumber, rowsWithRank, stationCode, stationInput } from './utils.js';

export function buildStatusFindTrainScript(trainNumber) {
    return `(() => {
    const input = document.querySelector('#trainNo');
    if (!input || typeof onTrainFindInput !== 'function') return { ok: false, error: 'Spot Your Train form not found' };
    input.value = ${JSON.stringify(trainNumber)};
    onTrainFindInput('B');
    return { ok: true };
  })()`;
}

export function buildStatusSubmitScript(journeyStation) {
    return `(() => {
    const form = document.frmTRN;
    const select = form && form.jStation;
    if (!select || select.options.length <= 1 || typeof onTrainFindInput !== 'function') {
      return { ok: false, error: 'Journey station list not found' };
    }
    const wanted = ${JSON.stringify(stationCode(journeyStation))};
    const options = Array.from(select.options);
    const match = options.find((o) => String(o.text || '').toUpperCase().includes(wanted) || String(o.value || '').toUpperCase().startsWith(wanted + '#'));
    select.value = match ? match.value : options[1].value;
    onTrainFindInput('A');
    return { ok: true };
  })()`;
}

export function buildStatusExtractScript() {
    return `(() => {
    const clean = (value) => String(value || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
    const lines = (document.body.innerText || '').split('\\n').map(clean).filter(Boolean);
    const rows = [];
    for (let i = 0; i < lines.length; i += 1) {
      const station = lines[i];
      const codeLine = lines[i + 1] || '';
      const code = (codeLine.match(/^([A-Z]{2,5})\\b/) || [])[1] || '';
      if (!code || !/^[A-Z][A-Z .()/-]+$/.test(station) || station.includes('National Train')) continue;
      if (station === 'SRC' || station === 'DSTN') continue;
      const before = lines.slice(Math.max(0, i - 8), i);
      const window = lines.slice(i + 2, i + 10);
      const distance = (window.find((line) => /\\d+\\s*KMs?/i.test(line)) || '').replace(/\\s*KMs?.*/i, '');
      const beforeTimes = before.filter((line) => /^(SRC|DSTN|\\d{1,2}:\\d{2}\\s+\\d{2}-[A-Za-z]{3})/.test(line));
      const afterTimes = window.filter((line) => /^(SRC|DSTN|\\d{1,2}:\\d{2}\\s+\\d{2}-[A-Za-z]{3})/.test(line));
      const status = window.find((line) => /On Time|Mins?\\.|Late|Early|Cancelled|Diverted/i.test(line))
        || before.slice().reverse().find((line) => /On Time|Mins?\\.|Late|Early|Cancelled|Diverted/i.test(line))
        || '';
      if (!beforeTimes.length && !afterTimes.length && !status) continue;
      rows.push({
        station,
        code,
        arrival: beforeTimes[beforeTimes.length - 1] || afterTimes[0] || '',
        departure: (afterTimes[0] === 'SRC' || afterTimes[0] === 'DSTN') ? afterTimes[1] || afterTimes[0] : afterTimes[0] || '',
        status,
        distanceKm: distance,
      });
    }
    return { ok: true, rows };
  })()`;
}

export const command = cli({
    site: SITE,
    name: 'status',
    access: 'read',
    description: 'NTES live train running status',
    example: 'webcmd ntes status 12951 --station MMCT --limit 8',
    domain: 'enquiry.indianrail.gov.in',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'train', type: 'string', required: true, positional: true, help: '5 digit train number' },
        { name: 'station', type: 'string', default: 'MMCT', help: 'Journey station code or NTES station label' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of status rows to return (max 20)' },
    ],
    columns: ['rank', 'trainNumber', 'station', 'code', 'arrival', 'departure', 'status', 'distanceKm', 'url'],
    func: async (page, kwargs) => {
        const trainNumber = requireTrainNumber(kwargs.train);
        const journeyStation = stationInput(kwargs.station || 'MMCT');
        const limit = parseLimit(kwargs.limit, 'ntes status');
        await page.goto(HOME_URL);
        await page.wait(1);
        let action = await page.evaluate(buildStatusFindTrainScript(trainNumber));
        if (action && action.ok === false)
            throw new CommandExecutionError(`ntes status UI action failed: ${action.error || 'train search failed'}`);
        await page.wait(3);
        action = await page.evaluate(buildStatusSubmitScript(journeyStation));
        if (action && action.ok === false)
            throw new CommandExecutionError(`ntes status UI action failed: ${action.error || 'status submit failed'}`);
        await page.wait(5);
        const rows = requireRows(await page.evaluate(buildStatusExtractScript()), 'ntes status');
        return rowsWithRank(rows, limit, (row) => ({
            trainNumber,
            station: row.station || '',
            code: row.code || '',
            arrival: row.arrival || '',
            departure: row.departure || '',
            status: row.status || '',
            distanceKm: row.distanceKm || '',
            url: HOME_URL,
        }));
    },
});

export const __test__ = {
    command,
    buildStatusFindTrainScript,
    buildStatusSubmitScript,
    buildStatusExtractScript,
};
