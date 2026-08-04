import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  ArgumentError,
  CommandExecutionError,
} from '@agentrhq/webcmd/errors';

const BASE = 'https://e-catalogue.jhu.edu';
const CATALOGUE_URL = `${BASE}/programs/`;
const UNIVERSITY = 'Johns Hopkins University';
const CHECKED_DATE = '2026-08-04';
const REQUEST_TIMEOUT_MS = 20000;
const DETAIL_REQUEST_TIMEOUT_MS = 6000;
const DETAIL_CONCURRENCY = 32;
const DEGREE_LEVELS = new Set(['all', 'masters', 'certificate', 'diploma', 'professional', 'doctorate']);

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

function decodeHtml(value = '') {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;|&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, '-')
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

function canonicalizeUrl(value) {
  const url = new URL(value, BASE);
  if (url.hostname !== 'e-catalogue.jhu.edu') return '';
  url.protocol = 'https:';
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '/');
  return url.href;
}

async function fetchHtml(url, marker = '<html', timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Webcmd JHU public data export)' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new CommandExecutionError(`JHU request failed: HTTP ${response.status} ${url}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      throw new CommandExecutionError(`JHU returned ${contentType || 'unknown content type'} instead of HTML: ${url}`);
    }
    const html = await response.text();
    if (marker && !html.includes(marker)) {
      throw new CommandExecutionError(`JHU page structure changed: missing ${marker} at ${url}`);
    }
    return { html, finalUrl: response.url };
  } catch (error) {
    if (error instanceof CommandExecutionError) throw error;
    throw new CommandExecutionError(`JHU request failed for ${url}: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCatalogue() {
  const { html } = await fetchHtml(CATALOGUE_URL, 'filter-items--grid');
  if (!html.includes('Programs of Study')) {
    throw new CommandExecutionError('JHU catalogue page structure changed: missing program list markers');
  }
  return html;
}

function extractAll(block, pattern) {
  return [...block.matchAll(pattern)].map((match) => text(match[1])).filter(Boolean);
}

function classifyProgram(name, keywords) {
  const keywordSet = new Set(keywords);
  const tags = new Set();
  if (keywordSet.has("Master's")) tags.add('masters');
  if (keywordSet.has('Doctoral')) tags.add('doctorate');
  if (keywordSet.has('Certificate') || keywordSet.has("Post-Master's Certificate (Graduate Certificate)")) {
    tags.add('certificate');
  }
  if (/diploma/i.test(name)) tags.add('diploma');
  if (/(?:\bDNP\b|\bDrPH\b|\bMD\b|Doctor of Medicine|Business Administration, MBA|Master of Public Health|Public Health, MPH|Health Administration, MHA)/i.test(name)) {
    tags.add('professional');
  }
  return [...tags];
}

function isPostgraduate(name, keywords, tags) {
  if (keywords.includes("Bachelor's") || keywords.includes('Minors') || keywords.includes('Non Degree Program')) {
    return false;
  }
  return tags.some((tag) => ['masters', 'certificate', 'diploma', 'doctorate', 'professional'].includes(tag));
}

function degreeLabel(keywords, tags) {
  const labels = keywords.filter((keyword) =>
    ["Master's", 'Doctoral', 'Certificate', "Post-Master's Certificate (Graduate Certificate)"].includes(keyword)
  );
  if (tags.includes('diploma') && !labels.some((label) => /diploma/i.test(label))) labels.push('Diploma');
  return labels.join(' | ');
}

function parsePrograms(html) {
  const rows = [];
  const seen = new Set();
  const itemPattern = /<li id=["']isotope-item\d+["'][^>]*class=["'][^"']*item[^"']*["'][^>]*>([\s\S]*?)(?=<li id=["']isotope-item\d+["']|<\/ul>\s*<\/div>)/gi;
  for (const item of html.matchAll(itemPattern)) {
    const block = item[1];
    const href = block.match(/<a\s+href=["']([^"']+)["']/i)?.[1] || '';
    const url = href ? canonicalizeUrl(decodeHtml(href)) : '';
    const name = text(block.match(/<span class=["']title["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    if (!url || !name || seen.has(url)) continue;

    const divisions = extractAll(block, /<ul class=["']divisions["'][^>]*>[\s\S]*?<li[^>]*>([\s\S]*?)<\/li>/gi);
    const keywords = extractAll(block, /<span class=["']keyword["'][^>]*>([\s\S]*?)<\/span>/gi);
    const tags = classifyProgram(name, keywords);
    if (!isPostgraduate(name, keywords, tags)) continue;

    seen.add(url);
    rows.push({
      name,
      url,
      divisions,
      keywords,
      tags,
      degree: degreeLabel(keywords, tags),
    });
  }
  if (!rows.length) throw new CommandExecutionError('JHU catalogue parser found no postgraduate programs');
  return rows;
}

function headingSection(html, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<h[2-4][^>]*>\\s*${escaped}\\s*</h[2-4]>([\\s\\S]*?)(?=<h[2-4][^>]*>|$)`, 'i');
  return text(html.match(pattern)?.[1] || '');
}

function firstOfficialProgramLink(html) {
  const candidates = [];
  for (const match of html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = text(match[2]);
    const href = decodeHtml(match[1]);
    let url;
    try {
      url = new URL(href, BASE);
    } catch {
      continue;
    }
    if (!/(\.|^)jhu\.edu$/i.test(url.hostname) || url.hostname === 'e-catalogue.jhu.edu') continue;
    if (url.hostname === 'www.jhu.edu' && /^\/admissions\/?$/i.test(url.pathname)) continue;
    const score = /program page|certificate program page|degree program page|requirements|tuition/i.test(label)
      ? 2
      : (/academics|degree|certificate|program/i.test(url.pathname) && !/^admissions?$/i.test(label) ? 1 : 0);
    if (score) candidates.push({ url: url.href, label, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

async function enrichProgram(program) {
  try {
    const { html, finalUrl } = await fetchHtml(program.url, '<main', DETAIL_REQUEST_TIMEOUT_MS);
    const catalogueAdmissions = headingSection(html, 'ADMISSIONS') || headingSection(html, 'Admissions');
    const catalogueRequirements = headingSection(html, 'Requirements') || headingSection(html, 'Program Requirements');
    const link = firstOfficialProgramLink(html);
    return {
      ...program,
      url: canonicalizeUrl(finalUrl) || program.url,
      catalogueAdmissions,
      catalogueRequirements,
      external: link ? { url: link.url, label: link.label } : {},
      detailError: '',
    };
  } catch (error) {
    return { ...program, catalogueAdmissions: '', catalogueRequirements: '', external: {}, detailError: error.message };
  }
}

async function enrichPrograms(programs) {
  const rows = [];
  for (let index = 0; index < programs.length; index += DETAIL_CONCURRENCY) {
    rows.push(...await Promise.all(programs.slice(index, index + DETAIL_CONCURRENCY).map(enrichProgram)));
  }
  return rows;
}

function normalizeRecord(program) {
  const row = Object.fromEntries(COLUMNS.map((column) => [column, '']));
  const studyOptions = program.keywords.filter((keyword) =>
    ['Full-time', 'Part-time', 'Hybrid', 'In-person', 'Online'].includes(keyword)
  );
  const programTypes = program.keywords.filter((keyword) =>
    ["Master's", 'Doctoral', 'Certificate', "Post-Master's Certificate (Graduate Certificate)"].includes(keyword)
  );
  if (program.tags.includes('diploma')) programTypes.push('Diploma');

  row['Course Name'] = program.name;
  row['Course URL'] = program.url;
  row['University \nname'] = UNIVERSITY;
  row['Substream/\nSpecialisation'] = program.divisions.join(' | ');
  row['Degree Level'] = program.degree;
  row['Study Level'] = 'PG';
  row['Intake Month'] = program.external?.startTerms || '';
  row['Duration\n(in months)'] = program.external?.duration || '';
  row['Study option'] = studyOptions.join(' | ');
  if (program.external?.mode) row['Study option'] = [...new Set([row['Study option'], program.external.mode].filter(Boolean))].join(' | ');
  row['Program Type'] = [...new Set(programTypes)].join(' | ');
  row['Tution fees \n(per year)'] = program.external?.tuition || '';
  row['Main Entry \nRequirements'] = program.external?.admissions || program.catalogueAdmissions || program.catalogueRequirements || '';
  row['Status'] = 'Official listing active';
  row['Remarks (if any)'] = [
    `Checked ${CHECKED_DATE}; official JHU catalogue/detail source.`,
    program.external?.url ? 'Enriched from official JHU school program page linked by catalogue.' : '',
    program.detailError ? `Catalogue detail unavailable: ${program.detailError}` : '',
    'Fields absent from the official catalogue detail page are marked unavailable for that catalogue page.',
  ].filter(Boolean).join(' ');
  row['Reference Links (if any)'] = [
    `Course: ${program.url}`,
    `Catalogue: ${CATALOGUE_URL}`,
    program.external?.url ? `School page: ${program.external.url}` : '',
  ].filter(Boolean).join(' | ');
  return applyBlankPolicy(row);
}

function applyBlankPolicy(row) {
  const unavailable = 'Not available on official catalogue page';
  for (const column of [
    'Intake Month',
    'Duration\n(in months)',
    'Study option',
    'Partner',
    'App fees',
    'Tution fees \n(per year)',
    'Total Tution \nFees',
    'IELTS \n(Overall & Subscores)',
    'TOEFL\n(Overall & Subscores)',
    'PTE\n(Overall & Subscores)',
    'Duolingo\n(Overall & Subscores)',
    'Is Waiver \nProvided?',
    'Waiver Info',
    'Is MOI \naccepted?',
    'Share list, if any',
    'GRE Required',
    'GMAT Required',
    '15 years of\nEducation Allowed?',
    'Gap Years',
    'Backlogs',
    'Work \nExperience \nRequired?',
    'Intake status(open/close)\n(eg: Fall (september)-Open\nSpring(January)- Closed)',
  ]) {
    if (!row[column]) row[column] = column === 'Partner' ? 'Not applicable unless listed by official catalogue page' : unavailable;
  }
  for (const column of [
    'ielts_reading_score',
    'ielts_writing_score',
    'ielts_listening_score',
    'ielts_speaking_score',
    'toefl_reading_score',
    'toefl_writing_score',
    'toefl_listening_score',
    'toefl_speaking_score',
    'pte_reading_score',
    'pte_writing_score',
    'pte_listening_score',
    'pte_speaking_score',
    'duolingo_comprehension_score',
    'duolingo_literacy_score',
    'duolingo_conversation_score',
    'duolingo_production_score',
    'GRE/GMAT Scores',
    'Min UG score',
  ]) {
    if (!row[column]) row[column] = unavailable;
  }
  if (!row['12th scores']) row['12th scores'] = 'Not applicable for postgraduate admission';
  if (!row['Main Entry \nRequirements']) row['Main Entry \nRequirements'] = unavailable;
  return row;
}

function validateRecord(row) {
  for (const column of ['Course Name', 'Course URL', 'University \nname', 'Degree Level', 'Study Level', 'Reference Links (if any)']) {
    if (!row[column]?.trim()) throw new CommandExecutionError(`JHU row is missing required field: ${column}`);
  }
  if (!/^https:\/\/e-catalogue\.jhu\.edu\//.test(row['Course URL'])) {
    throw new CommandExecutionError(`JHU row has invalid course URL: ${row['Course URL']}`);
  }
  if (row['Study Level'] !== 'PG') throw new CommandExecutionError('JHU row Study Level must be PG');
  return row;
}

cli({
  site: 'jhu',
  name: 'export-postgraduate-courses',
  description: 'Export Johns Hopkins University postgraduate programs using the official Academic Catalogue.',
  access: 'read',
  example: 'webcmd jhu export-postgraduate-courses --degree-level masters --count 10 -f csv',
  domain: 'e-catalogue.jhu.edu',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'degree-level', type: 'string', default: 'all', help: 'all, masters, certificate, diploma, professional, or doctorate' },
    { name: 'count', type: 'int', required: false, help: 'Positive maximum number of programs after filtering and deduplication' },
  ],
  columns: OUTPUT_COLUMNS,
  func: async (args) => {
    const { degreeLevel, count } = parseOptions(args);
    const html = await fetchCatalogue();
    const programs = parsePrograms(html)
      .filter((program) => degreeLevel === 'all' || program.tags.includes(degreeLevel));
    const selected = await enrichPrograms(count === null ? programs : programs.slice(0, count));
    return selected.map((program) => {
      const row = validateRecord(normalizeRecord(program));
      return CSV_OUTPUT
        ? Object.fromEntries(COLUMNS.map((column, index) => [OUTPUT_COLUMNS[index], row[column]]))
        : row;
    });
  },
});
