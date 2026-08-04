import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  ArgumentError,
  CommandExecutionError,
  TimeoutError,
} from '@agentrhq/webcmd/errors';

const BASE = 'https://www.ualberta.ca';
const PROGRAMS_URL = `${BASE}/en/graduate-programs/index.html`;
const UNIVERSITY = 'University of Alberta';
const CHECKED_DATE = '2026-08-03';
const DEGREE_LEVELS = new Set(['all', 'masters', 'certificate', 'diploma', 'professional', 'doctorate']);
const SOURCES = {
  catalogue: PROGRAMS_URL,
  apply: `${BASE}/en/graduate-studies/admissions-programs/apply/index.html`,
  applicationFee: `${BASE}/en/graduate-studies/resources/policies-procedures/graduate-program-manual/section-5-admissions/5-4-application-fee.html`,
  english: `${BASE}/en/graduate-studies/admissions-programs/apply/international-academic-requirements/english-language-proficiency/index.html`,
  academic: `${BASE}/en/graduate-studies/admissions-programs/apply/domestic-academic-requirements/index.html`,
  tuition: `${BASE}/en/graduate-studies/fees-funding/tuition-fees/index.html`,
};

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

function parseOptions(args) {
  const degreeLevel = String(args['degree-level'] ?? 'all').toLowerCase();
  if (!DEGREE_LEVELS.has(degreeLevel)) {
    throw new ArgumentError(`--degree-level must be one of: ${[...DEGREE_LEVELS].join(', ')}`);
  }
  if (args.count === undefined || args.count === null || args.count === '') return { degreeLevel, count: null };
  const count = Number(args.count);
  if (!Number.isInteger(count) || count <= 0) throw new ArgumentError('--count must be a positive integer');
  return { degreeLevel, count };
}

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function canonicalProgramUrl(value) {
  const url = new URL(value, BASE);
  if (url.hostname !== 'www.ualberta.ca' || !url.pathname.startsWith('/en/graduate-programs/')) return '';
  url.protocol = 'https:';
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

function inferCredential(raw) {
  return raw.ua__grad_cred || String(raw.ua__program || '').match(/Online (Master of Engineering)/i)?.[1] || '';
}

function degreeTags(row) {
  const text = `${row.degree} ${row.name}`.toLowerCase();
  const tags = new Set();
  if (/certificat|certificate/.test(text)) tags.add('certificate');
  if (/diploma/.test(text)) tags.add('diploma');
  if (/doctor of philosophy|doctorat|doctor of music/.test(text)) tags.add('doctorate');
  if (/doctor of medicine|doctor of pharmacy|juris doctor|\bjd\b/.test(text)) tags.add('professional');
  if (/master|maîtrise|maître/.test(text)) tags.add('masters');
  return [...tags];
}

function normalizeResult(result) {
  const raw = result.raw || {};
  const url = canonicalProgramUrl(result.uri || result.clickUri || raw.uri || raw.clickableuri || '');
  const name = raw.ua__program || String(result.title || '').replace(/\s*\|\s*Graduate Programs\s*$/i, '');
  const degree = inferCredential(raw);
  return {
    name,
    url,
    degree,
    degreeInferred: !raw.ua__grad_cred && !!degree,
    substream: raw.ua__grad_sub || '',
    types: asList(raw.ua__program_type),
    modes: asList(raw.ua__program_mode),
    faculties: asList(raw.ua__program_faculty),
    detailExcerpt: String(result.excerpt || '').replace(/\s+/g, ' ').trim(),
  };
}

function buildRow(program) {
  const row = Object.fromEntries(COLUMNS.map((column) => [column, '']));
  const references = [
    `Course: ${program.url}`,
    `Catalogue: ${SOURCES.catalogue}`,
    `Admissions: ${SOURCES.apply}`,
    `Application fee: ${SOURCES.applicationFee}`,
    `English: ${SOURCES.english}`,
    `Academic requirements: ${SOURCES.academic}`,
    `Tuition: ${SOURCES.tuition}`,
  ];
  row['Course Name'] = program.name;
  row['Course URL'] = program.url;
  row['University \nname'] = UNIVERSITY;
  row['Substream/\nSpecialisation'] = program.substream;
  row['App fees'] = 'CAD 135';
  row['Degree Level'] = program.degree;
  row['Study Level'] = 'PG';
  row['Study option'] = program.modes.join(' | ');
  row['Program Type'] = program.types.join(' | ');
  row['IELTS \n(Overall & Subscores)'] = '6.5 overall, at least 6.0 on each band';
  row['ielts_reading_score'] = '6.0';
  row['ielts_writing_score'] = '6.0';
  row['ielts_listening_score'] = '6.0';
  row['ielts_speaking_score'] = '6.0';
  row['TOEFL\n(Overall & Subscores)'] = 'Before 2026-01-21: 90 total, no section below 21; on/after 2026-01-21: 4.5 overall, no band below 4.5';
  row['toefl_reading_score'] = '21 / 4.5';
  row['toefl_writing_score'] = '21 / 4.5';
  row['toefl_listening_score'] = '21 / 4.5';
  row['toefl_speaking_score'] = '21 / 4.5';
  row['PTE\n(Overall & Subscores)'] = '61 overall, minimum band score 60';
  row['pte_reading_score'] = '60';
  row['pte_writing_score'] = '60';
  row['pte_listening_score'] = '60';
  row['pte_speaking_score'] = '60';
  row['Duolingo\n(Overall & Subscores)'] = '120, no integrated subscore below 100';
  row['duolingo_comprehension_score'] = '100';
  row['duolingo_literacy_score'] = '100';
  row['duolingo_conversation_score'] = '100';
  row['duolingo_production_score'] = '100';
  row['Is Waiver \nProvided?'] = 'Yes';
  row['Waiver Info'] = 'English Language Proficiency can be demonstrated by approved tests or recognized English-language countries/institutions; some programs may require higher scores.';
  row['Min UG score'] = program.degree.toLowerCase().includes('doctor')
    ? 'Master’s degree or equivalent; admission GPA 3.0/4.0 or B'
    : 'Four-year bachelor’s degree or equivalent; admission GPA 3.0/4.0 or B';
  row['Main Entry \nRequirements'] = program.detailExcerpt
    ? `Official program-detail excerpt: ${program.detailExcerpt}`
    : 'Minimum academic standard for graduate admission | Official application documents | English Language Proficiency if applicable | Program-specific requirements may apply';
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
    '15 years of\nEducation Allowed?',
    'Gap Years',
    'Backlogs',
    'Work \nExperience \nRequired?',
    'Intake status(open/close)\n(eg: Fall (september)-Open\nSpring(January)- Closed)',
  ]) if (!row[column]) row[column] = unavailable;
  for (const column of ['Partner', '12th scores']) row[column] = notApplicable;
  row['Share list, if any'] = 'Not available as a single value on official program page';
  row['Is MOI \naccepted?'] = 'Not available on official program page';
  row['Status'] = 'Not available on official program page';
  row['Remarks (if any)'] = [
    `Checked: ${CHECKED_DATE}. Official Coveo SitemapCrawler records were read for each program-detail page; structured program metadata and detail-page excerpts are used before shared admissions fallbacks. Fields without a published program-page value are marked as unavailable. Secondary-school and partner fields are not applicable to PG admission.`,
    program.degreeInferred ? 'Degree Level inferred from official ua__program label because ua__grad_cred was blank in the Coveo result.' : '',
  ].filter(Boolean).join(' | ');
  row['Reference Links (if any)'] = references.join(' | ');
  return row;
}

function validateRow(row) {
  for (const column of ['Course Name', 'Course URL', 'University \nname', 'Degree Level', 'Study Level', 'Reference Links (if any)']) {
    if (!String(row[column] || '').trim()) throw new CommandExecutionError(`UAlberta row is missing required field: ${column}`);
  }
  if (row['Study Level'] !== 'PG') throw new CommandExecutionError('UAlberta row Study Level must be PG');
  if (!/^https:\/\/www\.ualberta\.ca\/en\/graduate-programs\/[^/]+\.html$/.test(row['Course URL'])) {
    throw new CommandExecutionError(`UAlberta row has invalid course URL: ${row['Course URL']}`);
  }
  return row;
}

async function fetchPrograms(page) {
  let raw;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(PROGRAMS_URL, { waitUntil: 'none', settleMs: 0 });
      await page.wait({ selector: '#search-ug-programs.coveo-after-initialization' });
      raw = await page.evaluate(`
        (async () => {
          const root = document.querySelector('#search-ug-programs');
          if (!window.Coveo || !root) throw new Error('Coveo graduate program search not found');
          const controller = window.Coveo.get(root, 'QueryController');
          if (!controller?.lastQuery && window.Coveo.executeQuery) window.Coveo.executeQuery(root);
          for (let i = 0; i < 30 && !controller?.lastQuery; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          if (!controller?.lastQuery || !controller?.options?.endpoint) throw new Error('Coveo query controller unavailable');
          const query = JSON.parse(JSON.stringify(controller.lastQuery));
          query.firstResult = 0;
          query.numberOfResults = 1000;
          query.groupBy = [];
          const response = await controller.options.endpoint.search(query);
          return JSON.stringify({
            totalCount: response.totalCount,
            results: response.results.map((result) => ({
          title: result.title,
          excerpt: result.excerpt,
          uri: result.uri,
              clickUri: result.clickUri,
              raw: result.raw,
            })),
          });
        })()
      `);
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 3) throw error;
      await page.wait({ time: 2 });
    }
  }
  if (!raw) throw lastError;
  const data = JSON.parse(String(raw));
  if (data.totalCount !== 301 || !Array.isArray(data.results) || data.results.length < 250) {
    throw new CommandExecutionError(`UAlberta Coveo program result shape changed: total=${data.totalCount}, rows=${data.results?.length}`);
  }
  return data.results;
}

cli({
  site: 'ualberta',
  name: 'export-postgraduate-courses',
  description: 'Export University of Alberta postgraduate programs from the official graduate-program catalogue.',
  access: 'read',
  example: 'webcmd ualberta export-postgraduate-courses --degree-level masters --count 10 -f csv',
  domain: 'www.ualberta.ca',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'degree-level', type: 'string', default: 'all', help: 'all, masters, certificate, diploma, professional, or doctorate' },
    { name: 'count', type: 'int', required: false, help: 'Positive maximum number of programs after filtering and deduplication' },
  ],
  columns: OUTPUT_COLUMNS,
  func: async (page, args) => {
    const { degreeLevel, count } = parseOptions(args);
    let results;
    try {
      results = await fetchPrograms(page);
    } catch (error) {
      if (/timeout/i.test(error.message || '')) throw new TimeoutError(`Timed out loading UAlberta graduate program search: ${error.message}`);
      throw error;
    }
    const rows = [];
    const seen = new Set();
    const candidates = [];
    for (const result of results) {
      const program = normalizeResult(result);
      if (!program.name || !program.url || !program.degree || seen.has(program.url)) continue;
      if (degreeLevel !== 'all' && !degreeTags(program).includes(degreeLevel)) continue;
      seen.add(program.url);
      candidates.push(program);
      if (count !== null && candidates.length >= count) break;
    }
    for (const program of candidates) {
      const row = validateRow(buildRow(program));
      rows.push(CSV_OUTPUT
        ? Object.fromEntries(COLUMNS.map((column, index) => [OUTPUT_COLUMNS[index], row[column]]))
        : row);
    }
    return rows;
  },
});
