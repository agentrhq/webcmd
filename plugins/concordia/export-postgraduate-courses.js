import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  ArgumentError,
  CommandExecutionError,
} from '@agentrhq/webcmd/errors';

const BASE = 'https://www.concordia.ca';
const CATALOGUE_URL = `${BASE}/academics/graduate.html`;
const UNIVERSITY = 'Concordia University Montreal';
const CHECKED_DATE = '2026-08-03';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 800;
const DETAIL_CONCURRENCY = 8;
const SOURCES = {
  catalogue: CATALOGUE_URL,
  application: `${BASE}/gradstudies/future-students/how-to-apply/start-your-application.html`,
  requirements: `${BASE}/gradstudies/future-students/how-to-apply/requirements.html`,
  english: `${BASE}/gradstudies/future-students/how-to-apply/english-language-proficiency.html`,
  tuition: `${BASE}/students/financial/tuition-fees/rates.html`,
};
const DEGREE_LEVELS = new Set([
  'all',
  'masters',
  'certificate',
  'diploma',
  'professional',
  'doctorate',
]);

const COLUMNS = [
  'Course Name',
  'Course URL',
  'University \nname',
  'Intake Month',
  'Substream/\nSpecialisation',
  'App fees',
  'Degree Level',
  'Study Level',
  'Duration\n(in months)',
  'Study option',
  'Program Type',
  'Partner',
  'Tution fees \n(per year)',
  'Total Tution \nFees',
  'IELTS \n(Overall & Subscores)',
  'ielts_reading_score',
  'ielts_writing_score',
  'ielts_listening_score',
  'ielts_speaking_score',
  'TOEFL\n(Overall & Subscores)',
  'toefl_reading_score',
  'toefl_writing_score',
  'toefl_listening_score',
  'toefl_speaking_score',
  'PTE\n(Overall & Subscores)',
  'pte_reading_score',
  'pte_writing_score',
  'pte_listening_score',
  'pte_speaking_score',
  'Duolingo\n(Overall & Subscores)',
  'duolingo_comprehension_score',
  'duolingo_literacy_score',
  'duolingo_conversation_score',
  'duolingo_production_score',
  'Is Waiver \nProvided?',
  'Waiver Info',
  'Is MOI \naccepted?',
  'Share list, if any',
  'GRE Required',
  'GMAT Required',
  'GRE/GMAT Scores',
  '12th scores',
  'Min UG score',
  '15 years of\nEducation Allowed?',
  'Gap Years',
  'Backlogs',
  'Work \nExperience \nRequired?',
  'Main Entry \nRequirements',
  'Status',
  'Intake status(open/close)\n(eg: Fall (september)-Open\nSpring(January)- Closed)',
  'Remarks (if any)',
  'Reference Links (if any)',
];

const CSV_OUTPUT = process.argv.some((arg, index, argv) =>
  /^(?:-f|--format)=csv$/.test(arg) || ((arg === '-f' || arg === '--format') && argv[index + 1] === 'csv')
);
const OUTPUT_COLUMNS = CSV_OUTPUT
  ? COLUMNS.map((column) => /[,"\r\n]/.test(column) ? `"${column.replace(/"/g, '""')}"` : column)
  : COLUMNS;

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtml(value = '') {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function text(value = '') {
  return decodeHtml(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

async function fetchHtml(url, marker = '<html') {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Webcmd Concordia public data export)' },
        redirect: 'follow',
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('text/html')) {
        lastError = new Error(`HTTP ${response.status}, ${contentType || 'unknown content type'}`);
        if (!([429].includes(response.status) || response.status >= 500)) break;
      } else {
        const html = await response.text();
        if (marker && !html.includes(marker)) {
          throw new CommandExecutionError(`Concordia page structure changed for ${url}: missing ${marker}`);
        }
        return { html, finalUrl: response.url };
      }
    } catch (error) {
      lastError = error;
      if (error instanceof CommandExecutionError) throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < MAX_ATTEMPTS) await pause(attempt * RETRY_DELAY_MS);
  }
  throw new CommandExecutionError(`Concordia request failed for ${url}: ${lastError?.message || 'unknown network error'}`);
}

function parseOptions(args) {
  const degreeLevel = String(args['degree-level'] ?? 'all').toLowerCase();
  if (!DEGREE_LEVELS.has(degreeLevel)) {
    throw new ArgumentError(`--degree-level must be one of: ${[...DEGREE_LEVELS].join(', ')}`);
  }
  if (args.count === undefined || args.count === null || args.count === '') {
    return { degreeLevel, count: null };
  }
  const count = Number(args.count);
  if (!Number.isInteger(count) || count <= 0) {
    throw new ArgumentError('--count must be a positive integer');
  }
  return { degreeLevel, count };
}

function canonicalizeProgramUrl(value) {
  const url = new URL(value, BASE);
  if (url.hostname !== 'www.concordia.ca' || !url.pathname.startsWith('/academics/graduate/') || !url.pathname.endsWith('.html')) {
    return '';
  }
  url.protocol = 'https:';
  url.search = '';
  url.hash = '';
  return url.href;
}

function hiddenValue(block, className) {
  return text(block.match(new RegExp(`<span class=["']d-none ${className}["']>([\\s\\S]*?)<\\/span>`, 'i'))?.[1]);
}

function classifyDegree(program) {
  const haystack = `${program.name} ${program.degree} ${program.credential}`.toLowerCase();
  const tags = new Set();
  if (haystack.includes("master")) tags.add('masters');
  if (haystack.includes('certificate')) tags.add('certificate');
  if (haystack.includes('diploma')) tags.add('diploma');
  if (haystack.includes('doctorate') || haystack.includes('phd')) tags.add('doctorate');
  if (
    haystack.includes('mba') ||
    haystack.includes('master of business administration') ||
    haystack.includes('master of supply chain management') ||
    haystack.includes('cpa') ||
    haystack.includes('chartered professional accountancy')
  ) {
    tags.add('professional');
  }
  return [...tags];
}

function parseCatalogue(html) {
  const starts = [...html.matchAll(/<div class="program c-accordion[^>]*>/g)].map((match) => match.index);
  const rows = [];
  const seen = new Set();
  for (let index = 0; index < starts.length; index += 1) {
    const block = html.slice(starts[index], starts[index + 1] || html.length);
    const link = block.match(/<div class="section-title alphabar-title">\s*<a href="([^"]+)">([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = canonicalizeProgramUrl(link[1]);
    if (!url || seen.has(url)) continue;
    const program = {
      name: text(link[2]),
      url,
      degree: hiddenValue(block, 'degree'),
      credential: hiddenValue(block, 'credential'),
      category: hiddenValue(block, 'category'),
      programType: hiddenValue(block, 'programType'),
      campus: hiddenValue(block, 'campus'),
      experiential: hiddenValue(block, 'experiential'),
    };
    program.tags = classifyDegree(program);
    if (!program.name || !program.degree || !program.credential) continue;
    seen.add(url);
    rows.push(program);
  }
  if (!starts.length || !rows.length) {
    throw new CommandExecutionError('Concordia catalogue parser found no graduate program cards');
  }
  return rows;
}

async function discoverPrograms(degreeLevel) {
  const { html } = await fetchHtml(CATALOGUE_URL, 'program c-accordion');
  const programs = parseCatalogue(html);
  return degreeLevel === 'all'
    ? programs
    : programs.filter((program) => program.tags.includes(degreeLevel));
}

function extractProgramInfo(html) {
  const info = {};
  for (const match of html.matchAll(/<div class="heading-program-info">([\s\S]*?)<\/div>\s*<div class="text-program-info">([\s\S]*?)<\/div>/gi)) {
    info[text(match[1]).toLowerCase()] = text(match[2]);
  }
  return info;
}

function durationMonths(value = '') {
  const lower = value.toLowerCase();
  const yearRange = lower.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*years?/);
  if (yearRange) return `${Number(yearRange[1]) * 12}-${Number(yearRange[2]) * 12}`;
  const monthRange = lower.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*months?/);
  if (monthRange) return `${Number(monthRange[1])}-${Number(monthRange[2])}`;
  const years = lower.match(/(\d+(?:\.\d+)?)\s*years?/);
  if (years) return String(Number(years[1]) * 12);
  const months = lower.match(/(\d+(?:\.\d+)?)\s*months?/);
  return months ? String(Number(months[1])) : '';
}

function intakeMonths(value = '') {
  const terms = [
    [/fall/i, 'Fall (September)'],
    [/winter/i, 'Winter (January)'],
    [/summer/i, 'Summer (May)'],
  ].filter(([pattern]) => pattern.test(value)).map(([, term]) => term);
  return terms.join(' | ');
}

function extractRequirements(html) {
  const section = html.match(/<a id="requirements"><\/a>([\s\S]*?)<a id="application"><\/a>/i)?.[1] || '';
  const items = [...section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => text(match[1]))
    .filter(Boolean)
    .slice(0, 8);
  return items.join(' | ');
}

function extractDeadlineSummary(html) {
  const start = html.search(/Application deadlines/i);
  if (start < 0) return '';
  const tail = html.slice(start, html.search(/<a id="tuition"><\/a>/i) > start ? html.search(/<a id="tuition"><\/a>/i) : start + 25000);
  const deadlines = [];
  for (const term of ['FALL', 'WINTER', 'SUMMER']) {
    const match = tail.match(new RegExp(`<h3>\\s*${term}\\s*<\\/h3>[\\s\\S]{0,900}?<span class=["']xlarge-text["']>([\\s\\S]*?)<\\/span>`, 'i'));
    if (match) deadlines.push(`${term[0]}${term.slice(1).toLowerCase()} - ${text(match[1])}`);
  }
  return deadlines.join(' | ');
}

function extractCalendarUrl(html) {
  const match = html.match(/href=["'](\/academics\/graduate\/calendar\/current\/[^"']+)["'][^>]*>[\s\S]*?(?:Degree Requirements|credits|Courses|Consult the Graduate Calendar)/i);
  return match ? new URL(decodeHtml(match[1]), BASE).href : '';
}

function requirementValue(requirements, pattern) {
  return requirements.match(pattern)?.[1]?.trim() || '';
}

function yesNoFromText(requirements, testName) {
  const lower = requirements.toLowerCase();
  if (new RegExp(`(?:does not|not|no longer)\\s+require[^|.]{0,80}${testName}`, 'i').test(requirements)) return 'No';
  if (new RegExp(`${testName}[^|.]{0,80}(?:not required|optional)`, 'i').test(requirements)) return 'No';
  if (new RegExp(`${testName}[^|.]{0,80}required|required[^|.]{0,80}${testName}`, 'i').test(requirements)) return 'Yes';
  if (new RegExp(`\\b${testName}\\b`, 'i').test(lower)) return 'See requirements';
  return '';
}

function workExperience(requirements) {
  if (/work experience[^|.]{0,100}(?:not required|optional)|no work experience/i.test(requirements)) return 'No';
  if (/(?:work|professional) experience|years? of experience/i.test(requirements)) return 'See requirements';
  return '';
}

async function extractProgram(program) {
  let html;
  let finalUrl;
  try {
    ({ html, finalUrl } = await fetchHtml(program.url, '<h1'));
  } catch (error) {
    return {
      ...program,
      detailUrl: program.url,
      programInfo: {},
      requirements: '',
      deadlineSummary: '',
      calendarUrl: '',
      detailError: error.message,
    };
  }
  const detailUrl = canonicalizeProgramUrl(finalUrl) || program.url;
  const programInfo = extractProgramInfo(html);
  const requirements = extractRequirements(html);
  return {
    ...program,
    detailUrl,
    programInfo,
    requirements,
    deadlineSummary: extractDeadlineSummary(html),
    calendarUrl: extractCalendarUrl(html),
    detailError: '',
  };
}

async function mapWithConcurrency(items, mapper, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function fetchSharedSources() {
  const [application, requirements, english, tuition] = await Promise.all([
    fetchHtml(SOURCES.application, 'application fee of $100.00 CAD'),
    fetchHtml(SOURCES.requirements, 'reference letters'),
    fetchHtml(SOURCES.english, 'IELTS'),
    fetchHtml(SOURCES.tuition, 'Graduate costs per course credit'),
  ]);
  return { application, requirements, english, tuition };
}

function normalizeRecord(data) {
  const row = Object.fromEntries(COLUMNS.map((column) => [column, '']));
  const requirements = data.requirements || '';
  const remarks = [`Checked: ${CHECKED_DATE}`];
  if (data.detailError) remarks.push(`Program detail page unavailable on ${CHECKED_DATE}: ${data.detailError}`);
  if (!row['Tution fees \n(per year)']) remarks.push('Concordia publishes graduate fee schedules/estimator rather than a single annual amount for this program.');
  const references = [
    `Course: ${data.detailUrl || data.url}`,
    `Catalogue: ${SOURCES.catalogue}`,
    data.calendarUrl ? `Calendar: ${data.calendarUrl}` : '',
    `Application fee: ${SOURCES.application}`,
    `Requirements: ${SOURCES.requirements}`,
    `English: ${SOURCES.english}`,
    `Tuition: ${SOURCES.tuition}`,
  ].filter(Boolean);
  const studyOptions = [
    data.programInfo['program options'] || data.programType,
    data.experiential,
    data.programInfo['primary campus'] || data.campus.toUpperCase(),
  ].filter(Boolean);

  row['Course Name'] = data.name;
  row['Course URL'] = data.detailUrl || data.url;
  row['University \nname'] = UNIVERSITY;
  row['Intake Month'] = intakeMonths(data.programInfo['start term']);
  row['App fees'] = data.credential === 'Microprogram' ? 'CAD 40' : 'CAD 100';
  row['Degree Level'] = data.degree;
  row['Study Level'] = 'PG';
  row['Duration\n(in months)'] = durationMonths(data.programInfo.duration);
  row['Study option'] = studyOptions.join(' | ');
  row['Program Type'] = data.programType;
  row['IELTS \n(Overall & Subscores)'] = '6.5 overall; 6.5 each component for no English language courses (some programs higher)';
  row['ielts_reading_score'] = '6.5';
  row['ielts_writing_score'] = '6.5';
  row['ielts_listening_score'] = '6.5';
  row['ielts_speaking_score'] = '6.5';
  row['TOEFL\n(Overall & Subscores)'] = '86 overall, 20 each component; Jan 2026+ scale: 4.5 overall, no section below 4.0 (some programs higher)';
  row['toefl_reading_score'] = '20';
  row['toefl_writing_score'] = '20';
  row['toefl_listening_score'] = '20';
  row['toefl_speaking_score'] = '20';
  row['PTE\n(Overall & Subscores)'] = '61 overall, no part under 53';
  row['pte_reading_score'] = '53';
  row['pte_writing_score'] = '53';
  row['pte_listening_score'] = '53';
  row['pte_speaking_score'] = '53';
  row['Duolingo\n(Overall & Subscores)'] = 'Above 120 (some programs higher)';
  row['Is Waiver \nProvided?'] = 'Yes';
  row['Waiver Info'] = 'Exempt after at least three full undergraduate/graduate years at an accredited university in an English- or French-primary-language country, or four secondary-school years in an English-primary-language country; Concordia may still require a test.';
  row['Is MOI \naccepted?'] = 'Yes — exemption is based on qualifying study where English or French is the primary language of instruction.';
  row['Share list, if any'] = 'American Samoa; Anguilla; Antigua & Barbuda; Australia; Bahamas; Barbados; Belgium (French); Belize; Bermuda; Botswana; British Virgin Islands; Canada; Cayman Islands; Dominica; Falkland Islands; Fiji; France (French); Gambia; Ghana; Gibraltar; Grenada; Guam; Guyana; Ireland; Jamaica; Kenya; Lesotho; Liberia; Malta; Mauritius; Montserrat; New Zealand; Nigeria; Seychelles; Sierra Leone; Singapore; South Africa; St. Helena; St. Kitts & Nevis; St. Lucia; St. Vincent & the Grenadines; Tanzania; Trinidad & Tobago; Turks & Caicos Islands; Uganda; United Kingdom; US Virgin Islands; United States of America; Zambia; Zimbabwe.';
  row['GRE Required'] = yesNoFromText(requirements, 'GRE');
  row['GMAT Required'] = yesNoFromText(requirements, 'GMAT');
  row['Min UG score'] = requirementValue(requirements, /(?:minimum GPA of|GPA of|minimum GPA)\s*([0-9](?:\.[0-9]{1,2})?(?:\s*\([^)]+\))?)/i);
  row['Work \nExperience \nRequired?'] = workExperience(requirements);
  row['Main Entry \nRequirements'] = requirements;
  row['Intake status(open/close)\n(eg: Fall (september)-Open\nSpring(January)- Closed)'] = data.deadlineSummary;
  row['Remarks (if any)'] = remarks.join(' | ');
  row['Reference Links (if any)'] = references.join(' | ');
  // These fields are either not part of postgraduate admission or are assessed
  // program-by-program; do not turn missing catalogue metadata into a claim.
  const unavailable = 'Not available on official program page';
  const notApplicable = 'Not applicable (postgraduate admission)';
  for (const column of [
    'Substream/\nSpecialisation',
    'Intake Month',
    'Duration\n(in months)',
    'Tution fees \n(per year)',
    'Total Tution \nFees',
    'GRE Required',
    'GMAT Required',
    'GRE/GMAT Scores',
    'Min UG score',
    '15 years of\nEducation Allowed?',
    'Gap Years',
    'Backlogs',
    'Work \nExperience \nRequired?',
    'Main Entry \nRequirements',
    'Intake status(open/close)\n(eg: Fall (september)-Open\nSpring(January)- Closed)',
  ]) if (!row[column]) row[column] = unavailable;
  for (const column of ['Partner', '12th scores', 'duolingo_comprehension_score', 'duolingo_literacy_score', 'duolingo_conversation_score', 'duolingo_production_score']) {
    if (!row[column]) row[column] = notApplicable;
  }
  if (!row['Is MOI \naccepted?']) row['Is MOI \naccepted?'] = 'Not available on official program page';
  if (!row['Status']) row['Status'] = 'Not available on official program page';
  row['Remarks (if any)'] = `${row['Remarks (if any)']} | Fields without a published program-page value are marked as unavailable; secondary-school and partner fields are not applicable to PG admission.`;
  return row;
}

function validateRecord(row) {
  for (const column of ['Course Name', 'Course URL', 'University \nname', 'Degree Level', 'Study Level', 'Reference Links (if any)']) {
    if (!row[column]?.trim()) throw new CommandExecutionError(`Concordia row is missing required field: ${column}`);
  }
  if (!/^https:\/\/www\.concordia\.ca\/academics\/graduate\/[^/]+\.html$/.test(row['Course URL'])) {
    throw new CommandExecutionError(`Concordia row has invalid course URL: ${row['Course URL']}`);
  }
  if (row['Study Level'] !== 'PG') throw new CommandExecutionError('Concordia row Study Level must be PG');
  return row;
}

cli({
  site: 'concordia',
  name: 'export-postgraduate-courses',
  description: 'Export Concordia University Montreal postgraduate programs using official public sources.',
  access: 'read',
  example: 'webcmd concordia export-postgraduate-courses --degree-level masters --count 10 -f csv',
  domain: 'www.concordia.ca',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'degree-level', type: 'string', default: 'all', help: 'all, masters, certificate, diploma, professional, or doctorate' },
    { name: 'count', type: 'int', required: false, help: 'Positive maximum number of programs after filtering and deduplication' },
  ],
  columns: OUTPUT_COLUMNS,
  func: async (args) => {
    const { degreeLevel, count } = parseOptions(args);
    const programs = await discoverPrograms(degreeLevel);
    if (!programs.length) return [];
    await fetchSharedSources();
    const selected = count === null ? programs : programs.slice(0, count);
    const details = await mapWithConcurrency(selected, extractProgram, DETAIL_CONCURRENCY);
    return details.map((detail) => {
      const row = validateRecord(normalizeRecord(detail));
      return CSV_OUTPUT
        ? Object.fromEntries(COLUMNS.map((column, index) => [OUTPUT_COLUMNS[index], row[column]]))
        : row;
    });
  },
});
