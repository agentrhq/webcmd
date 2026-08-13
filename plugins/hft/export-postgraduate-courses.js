import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  ArgumentError,
  CommandExecutionError,
} from '@agentrhq/webcmd/errors';
import { resolve4 } from 'node:dns/promises';
import { Agent } from 'undici';

const BASE = 'https://www.hft-stuttgart.de';
const CATALOGUE_URL = `${BASE}/`;
const APPLICATION_URL = `${BASE}/studium/bewerbung`;
const INTERNATIONAL_URL = `${BASE}/studium/vor-dem-studium/studieninteressierte-aus-dem-ausland`;
const UNIVERSITY = 'Hochschule für Technik Stuttgart';
const CHECKED_DATE = '2026-08-03';
const REQUEST_TIMEOUT_MS = 20000;
const DETAIL_CONCURRENCY = 8;
const DEGREE_LEVELS = new Set(['all', 'masters', 'certificate', 'diploma', 'professional', 'doctorate']);
const DNS_DISPATCHER = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      resolve4(hostname).then(
        (addresses) => options?.all
          ? callback(null, addresses.map((address) => ({ address, family: 4 })))
          : callback(null, addresses[0], 4),
        callback,
      );
    },
  },
});

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
    .replace(/&apos;|&#0*39;|&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&euro;/gi, '€')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function text(value = '') {
  return decodeHtml(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' | ')
      .replace(/<\/(?:p|li|dd|dt|h[1-6])>/gi, ' | ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s*\|\s*/g, ' | ').replace(/\s+/g, ' ').replace(/(?: \|)+$/g, '').trim();
}

async function fetchHtml(url, marker = '<html') {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Webcmd HFT Stuttgart public data export)' },
        redirect: 'follow',
        dispatcher: DNS_DISPATCHER,
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('text/html')) {
        lastError = new Error(`HTTP ${response.status}, ${contentType || 'unknown content type'}`);
      } else {
        const html = await response.text();
        if (marker && !html.includes(marker)) {
          throw new CommandExecutionError(`HFT page structure changed for ${url}: missing ${marker}`);
        }
        return { html, finalUrl: response.url };
      }
    } catch (error) {
      lastError = error;
      if (error instanceof CommandExecutionError) throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 2) await pause(500);
  }
  throw new CommandExecutionError(`HFT request failed for ${url}: ${lastError?.message || 'unknown network error'}`);
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
  if (url.hostname !== 'www.hft-stuttgart.de') return '';
  url.protocol = 'https:';
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}

function classifyCourse(name = '', degree = '') {
  const haystack = `${name} ${degree}`.toLowerCase();
  const tags = new Set();
  if (haystack.includes('master') || haystack.includes('m.sc') || haystack.includes('m.a')) tags.add('masters');
  if (haystack.includes('certificate')) tags.add('certificate');
  if (haystack.includes('diploma')) tags.add('diploma');
  if (haystack.includes('doctor') || haystack.includes('ph.d') || haystack.includes('phd')) tags.add('doctorate');
  return [...tags];
}

function parseCatalogue(html) {
  const courses = new Map();
  const sections = html.match(/<section\b[^>]*class="[^"]*\bstudycourses\b[^"]*"[\s\S]*?<\/section>/gi) || [];
  for (const section of sections) {
    const area = text(section.match(/<h3\b[^>]*studycourses__header__title[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '');
    const masterBlock = section.match(/<div\b[^>]*studycourses__wrapper--master[^>]*>([\s\S]*?)<\/ul>/i)?.[1] || '';
    for (const match of masterBlock.matchAll(/<li\b[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/li>/gi)) {
      const url = canonicalizeProgramUrl(match[1]);
      if (!url) continue;
      const note = text(match[3]);
      const existing = courses.get(url);
      if (existing) {
        if (area) existing.areas.add(area);
        if (note) existing.notes.add(note);
      } else {
        courses.set(url, {
          name: text(match[2]),
          url,
          areas: new Set(area ? [area] : []),
          notes: new Set(note ? [note] : []),
          tags: classifyCourse(text(match[2])),
        });
      }
    }
  }
  const rows = [...courses.values()].map((course) => ({
    ...course,
    areas: [...course.areas],
    notes: [...course.notes],
  }));
  if (!rows.length) throw new CommandExecutionError('HFT catalogue parser found no master programs');
  return rows;
}

function quickInfo(html) {
  const facts = {};
  const section = html.match(/<section\b[^>]*aria-label="Studiengang Quick-Info"[\s\S]*?<\/section>/i)?.[0] || '';
  for (const dl of section.matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl>/gi)) {
    const key = text(dl[1].match(/<dt\b[^>]*>([\s\S]*?)<\/dt>/i)?.[1] || '').toLowerCase();
    const value = [...dl[1].matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)].map((match) => text(match[1])).filter(Boolean).join(' | ');
    if (key && value) facts[key] = value;
  }
  return facts;
}

function pageTitle(html) {
  return text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
}

function detailSections(html) {
  const sections = [];
  for (const match of html.matchAll(/<div class="foldable-text-teaser">([\s\S]*?)<\/article>\s*<\/div>/gi)) {
    const header = text(match[1].match(/<h[2-4]\b[^>]*content__wrapper__header[^>]*>([\s\S]*?)<\/h[2-4]>/i)?.[1] || '');
    const body = text(match[1].match(/<div\b[^>]*content__foldable-text__content[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
    if (header && body) sections.push({ header, body });
  }
  return sections;
}

function entryRequirements(html) {
  const picked = detailSections(html)
    .filter(({ header }) => /zulassung|voraussetzung|admission|requirement/i.test(header))
    .map(({ header, body }) => `${header}: ${body}`);
  return picked.join(' | ');
}

function monthsFromDuration(value = '') {
  const fullTime = value.match(/(\d+(?:[.,]\d+)?)\s*Semester/i)?.[1];
  return fullTime ? String(Number(fullTime.replace(',', '.')) * 6) : '';
}

function intakeFromApplication(value = '') {
  const parts = [];
  if (/Sommersemester/i.test(value)) parts.push('Summer semester');
  if (/Wintersemester/i.test(value)) parts.push('Winter semester');
  return parts.join(' | ');
}

function isReplacedLegacyCourse(course, application = '') {
  return /\/imiad$/.test(course.url) && /ab 2026 wird der IMIAD .*Master Innenarchitektur/i.test(application);
}

function isEnglishTaught(course) {
  return /^(Photogrammetry and Geoinformatics|Software Technology|International Project Management|Smart City Solutions)$/i.test(course.catalogueName || course.name);
}

async function enrichCourse(course) {
  try {
    const { html, finalUrl } = await fetchHtml(course.url, 'Studiengang Quick-Info');
    const facts = quickInfo(html);
    const degree = facts.abschluss || '';
    const application = facts.bewerbung || '';
    return {
      ...course,
      catalogueName: course.name,
      name: pageTitle(html) || course.name,
      url: canonicalizeProgramUrl(finalUrl) || course.url,
      degree: degree || 'Master',
      duration: monthsFromDuration(facts.regelstudienzeit || ''),
      studyOption: facts.regelstudienzeit || '',
      application,
      entryRequirements: entryRequirements(html),
      intake: intakeFromApplication(application),
      isReplaced: isReplacedLegacyCourse(course, application),
      detailError: '',
      tags: classifyCourse(course.name, degree || 'Master'),
    };
  } catch (error) {
    return {
      ...course,
      degree: 'Master',
      duration: '',
      studyOption: '',
      application: '',
      entryRequirements: '',
      intake: '',
      isReplaced: false,
      detailError: error.message,
      tags: classifyCourse(course.name, 'Master'),
    };
  }
}

async function enrichCourses(courses) {
  const rows = [];
  for (let index = 0; index < courses.length; index += DETAIL_CONCURRENCY) {
    rows.push(...await Promise.all(courses.slice(index, index + DETAIL_CONCURRENCY).map(enrichCourse)));
  }
  return rows;
}

function normalizeRecord(course) {
  const row = Object.fromEntries(COLUMNS.map((column) => [column, '']));
  const remarks = [
    `Checked ${CHECKED_DATE}; official HFT Stuttgart catalogue and programme-detail pages.`,
    course.notes.length ? `Cross-listed: ${course.notes.join(' | ')}` : '',
    course.detailError ? `Detail page fields unavailable: ${course.detailError}` : '',
  ].filter(Boolean);

  row['Course Name'] = course.name;
  row['Course URL'] = course.url;
  row['University \nname'] = UNIVERSITY;
  row['Intake Month'] = course.intake;
  row['Substream/\nSpecialisation'] = course.areas.join(' | ');
  row['Degree Level'] = course.degree;
  row['Study Level'] = 'PG';
  row['Duration\n(in months)'] = course.duration;
  row['Study option'] = [
    course.studyOption,
    `Teaching language: ${isEnglishTaught(course) ? 'English' : 'German'}`,
  ].filter(Boolean).join(' | ');
  row['Program Type'] = 'Master';
  row['Tution fees \n(per year)'] = '€3,000/year for international students outside the EU; not available as a single value on official programme page for other residence statuses';
  row['Total Tution \nFees'] = 'Not available as a single value on official programme page';
  row['IELTS \n(Overall & Subscores)'] = isEnglishTaught(course)
    ? 'Not available as a single value on official programme page'
    : 'Not applicable; programme is taught in German';
  row['Main Entry \nRequirements'] = course.entryRequirements || 'Not available on official HFT programme page';
  row['Status'] = 'Official listing active';
  row['Intake status(open/close)\n(eg: Fall (september)-Open\nSpring(January)- Closed)'] = course.application;
  row['Remarks (if any)'] = [...remarks, 'Application fees, score thresholds, waivers, and MOI acceptance are not available in the official shared or programme pages.'].join(' | ');
  row['Reference Links (if any)'] = `Course: ${course.url} | Catalogue: ${CATALOGUE_URL}#c6490 | Application: ${APPLICATION_URL} | International applicants/fees and language proof: ${INTERNATIONAL_URL}`;
  const unavailable = 'Not available on official HFT shared/programme pages';
  for (const column of [
    'Intake Month',
    'App fees',
    'Partner',
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
  ]) if (!row[column]) row[column] = column === 'Partner' ? 'Not applicable unless listed by official programme source' : unavailable;
  return row;
}

function validateRecord(row) {
  for (const column of ['Course Name', 'Course URL', 'University \nname', 'Degree Level', 'Study Level', 'Reference Links (if any)']) {
    if (!row[column]?.trim()) throw new CommandExecutionError(`HFT row is missing required field: ${column}`);
  }
  if (!/^https:\/\/www\.hft-stuttgart\.de\//.test(row['Course URL'])) {
    throw new CommandExecutionError(`HFT row has invalid course URL: ${row['Course URL']}`);
  }
  if (row['Study Level'] !== 'PG') throw new CommandExecutionError('HFT row Study Level must be PG');
  return row;
}

cli({
  site: 'hft',
  name: 'export-postgraduate-courses',
  description: 'Export HFT Stuttgart postgraduate programs using the official public programme pages.',
  access: 'read',
  example: 'webcmd hft export-postgraduate-courses --degree-level masters --count 10 -f csv',
  domain: 'www.hft-stuttgart.de',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'degree-level', type: 'string', default: 'all', help: 'all, masters, certificate, diploma, professional, or doctorate' },
    { name: 'count', type: 'int', required: false, help: 'Positive maximum number of programs after filtering and deduplication' },
  ],
  columns: OUTPUT_COLUMNS,
  func: async (args) => {
    const { degreeLevel, count } = parseOptions(args);
    const { html } = await fetchHtml(CATALOGUE_URL, '15 Bachelor- und 21 Masterstudiengänge');
    const filtered = parseCatalogue(html)
      .filter((course) => degreeLevel === 'all' || course.tags.includes(degreeLevel));
    const selected = (await enrichCourses(filtered))
      .filter((course) => !course.isReplaced)
      .slice(0, count === null ? undefined : count);
    return selected.map((course) => {
      const row = validateRecord(normalizeRecord(course));
      return CSV_OUTPUT
        ? Object.fromEntries(COLUMNS.map((column, index) => [OUTPUT_COLUMNS[index], row[column]]))
        : row;
    });
  },
});
