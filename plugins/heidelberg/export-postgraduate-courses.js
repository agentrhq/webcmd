import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  ArgumentError,
  CommandExecutionError,
} from '@agentrhq/webcmd/errors';
import { resolve4 } from 'node:dns/promises';
import { Agent } from 'undici';

const BASE = 'https://www.uni-heidelberg.de';
const CATALOGUE_URL = `${BASE}/en/study/all-subjects`;
const UNIVERSITY = 'Heidelberg University';
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
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

async function fetchHtml(url, marker = '<html') {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Webcmd Heidelberg public data export)' },
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
          throw new CommandExecutionError(`Heidelberg page structure changed for ${url}: missing ${marker}`);
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
  throw new CommandExecutionError(`Heidelberg request failed for ${url}: ${lastError?.message || 'unknown network error'}`);
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

function extractWindowData(html) {
  const marker = 'window.__DATA__ = ';
  const start = html.indexOf(marker);
  if (start === -1) throw new CommandExecutionError('Heidelberg catalogue changed: missing window.__DATA__');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start + marker.length; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(start + marker.length, index + 1));
    }
  }
  throw new CommandExecutionError('Heidelberg catalogue changed: unterminated window.__DATA__ JSON');
}

function catalogueTable(data) {
  const root = data.ROOT_QUERY || {};
  const key = Object.keys(root).find((candidate) => candidate.startsWith('studyFinderTable('));
  const table = key ? root[key] : null;
  if (!table?.tableRows?.length) throw new CommandExecutionError('Heidelberg catalogue changed: missing studyFinderTable rows');
  return table;
}

function canonicalizeProgramUrl(value) {
  const url = new URL(value, BASE);
  if (url.hostname !== 'www.uni-heidelberg.de' || !url.pathname.startsWith('/en/study/all-subjects/')) {
    return '';
  }
  url.protocol = 'https:';
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

function officialHeidelbergUrl(value, base = BASE) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.uni-heidelberg.de')) return '';
    if (/\/download(?:$|[/?#])/.test(url.pathname)) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function officialCourseLinks(html, baseUrl) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = text(match[2]);
    const url = officialHeidelbergUrl(match[1], baseUrl);
    if (
      url
      && !url.includes('/en/study/all-subjects/')
      && !/^(University|Research|Study|Transfer|Home|Facebook|Instagram|LinkedIn|YouTube)$/i.test(label)
      && !links.some((link) => link.url === url)
    ) {
      links.push({ label, url });
    }
  }
  return links
    .sort((a, b) => Number(/admission|center|centre|institute|department|programme|program/i.test(b.label)) - Number(/admission|center|centre|institute|department|programme|program/i.test(a.label)))
    .slice(0, 3);
}

function sectionByHeading(html, headingPattern) {
  const heading = html.match(/<h[2-3]\b[^>]*>([\s\S]*?)<\/h[2-3]>/gi)?.find((candidate) => headingPattern.test(text(candidate)));
  if (!heading) return '';
  const start = html.indexOf(heading);
  const next = html.slice(start + heading.length).search(/<h[2-3]\b/i);
  const block = next === -1 ? html.slice(start) : html.slice(start, start + heading.length + next);
  return text(block).replace(/\s+/g, ' ').trim();
}

async function linkedAdmissionInfo(html, baseUrl) {
  for (const link of officialCourseLinks(html, baseUrl)) {
    try {
      const { html: linkedHtml, finalUrl } = await fetchHtml(link.url, '<html');
      const admission = sectionByHeading(linkedHtml, /admission|application/i);
      if (/\b(BA|Bachelor|TOEFL|IELTS|credit|transcript|degree|deadline)\b/i.test(admission)) {
        return { text: admission, url: finalUrl, label: link.label };
      }
    } catch {
      // Ignore auxiliary-page misses; the main programme page remains the source of truth.
    }
  }
  return { text: '', url: '', label: '' };
}

function classifyVariant(variantName, degree = '') {
  const haystack = `${variantName} ${degree}`.toLowerCase();
  const tags = new Set();
  if (haystack.includes('master') || haystack.includes('magister') || haystack.includes('ll.m')) tags.add('masters');
  if (haystack.includes('certificate')) tags.add('certificate');
  if (haystack.includes('diploma')) tags.add('diploma');
  if (haystack.includes('doctor') || haystack.includes('ph.d') || haystack.includes('phd')) tags.add('doctorate');
  return [...tags];
}

function startFromVariant(variant) {
  if (variant.winterSemester === '1' && variant.summerSemester === '1') return 'Winter semester | Summer semester';
  if (variant.winterSemester === '1') return 'Winter semester only';
  if (variant.summerSemester === '1') return 'Summer semester only';
  return '';
}

function parseCatalogue(html) {
  const table = catalogueTable(extractWindowData(html));
  const programs = [];
  const seen = new Set();
  for (const row of table.tableRows) {
    const cells = (row.rowCells || []).map((cell) => cell.rowCellData || '');
    const [subject, subjectPath, variantsJson, scienceArea,,,, faculty] = cells;
    if (!subject || !variantsJson) continue;
    let variants;
    try {
      variants = JSON.parse(variantsJson);
    } catch {
      continue;
    }
    for (const variant of variants) {
      const tags = classifyVariant(variant.name);
      if (!tags.length) continue;
      const url = canonicalizeProgramUrl(variant.path);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      programs.push({
        subject: text(subject),
        subjectUrl: canonicalizeProgramUrl(subjectPath),
        url,
        variantName: text(variant.name),
        tags,
        scienceArea: text(scienceArea),
        faculty: text(faculty),
        properties: variant.furtherProperties || [],
        start: startFromVariant(variant),
      });
    }
  }
  if (!programs.length) throw new CommandExecutionError('Heidelberg catalogue parser found no non-bachelor programs');
  return programs;
}

function extractFacts(html) {
  const facts = {};
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => text(match[1]));
    if (cells.length >= 2) facts[cells[0].toLowerCase()] = cells[1];
  }
  return facts;
}

function fact(facts, startsWith) {
  const wanted = startsWith.toLowerCase();
  const key = Object.keys(facts).find((candidate) => candidate.startsWith(wanted));
  return key ? facts[key] : '';
}

function durationMonths(standardPeriod) {
  const semesters = standardPeriod.match(/(\d+(?:\.\d+)?)\s+semesters?/i)?.[1];
  return semesters ? String(Number(semesters) * 6) : '';
}

function totalFees(fees = '', duration = '') {
  const perSemester = fees.match(/(\d+(?:[.,]\d+)?)\s*€\s*\/\s*semester/i)?.[1];
  const months = Number(duration);
  if (!perSemester || !Number.isFinite(months) || months <= 0) return '';
  const total = Number(perSemester.replace(',', '.')) * (months / 6);
  return `${total.toFixed(2)} € (official semester contribution over standard period)`;
}

function languageScores(source = '') {
  const ielts = source.match(/IELTS:?\s*([0-9.]+)[^|.]*?(?:at least|minimum)\s*([0-9.]+)/i);
  const toefl = source.match(/TOEFL iBT:?\s*([0-9]+)[^|.]*?(?:at least|minimum)\s*([0-9]+)/i);
  return {
    ieltsOverall: ielts?.[1] || '',
    ieltsSub: ielts?.[2] || '',
    toeflOverall: toefl?.[1] || '',
    toeflSub: toefl?.[2] || '',
  };
}

async function enrichProgram(program) {
  try {
    const { html, finalUrl } = await fetchHtml(program.url, 'Facts & Formalities');
    const facts = extractFacts(html);
    const degree = fact(facts, 'degree');
    const linkedAdmission = await linkedAdmissionInfo(html, finalUrl);
    return {
      ...program,
      url: canonicalizeProgramUrl(finalUrl) || program.url,
      degree: degree || program.variantName,
      type: fact(facts, 'type of programme'),
      start: fact(facts, 'start of programme') || program.start,
      duration: durationMonths(fact(facts, 'standard period of study')),
      language: fact(facts, 'language(s) of instruction'),
      fees: fact(facts, 'fees and contributions'),
      application: fact(facts, 'application procedure'),
      linkedAdmission,
      deadlines: fact(facts, 'application deadlines'),
      detailError: '',
      tags: classifyVariant(program.variantName, degree || program.variantName),
    };
  } catch (error) {
    return {
      ...program,
      degree: program.variantName,
      type: '',
      duration: '',
      language: '',
      fees: '',
      application: '',
      linkedAdmission: { text: '', url: '', label: '' },
      deadlines: '',
      detailError: error.message,
    };
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
  const remarks = [
    `Checked ${CHECKED_DATE}; official Heidelberg study-finder and programme-detail pages.`,
    program.language ? `Language(s) of instruction: ${program.language}` : '',
    program.application ? `Application procedure: ${program.application}` : '',
    program.detailError ? `Detail page fields unavailable: ${program.detailError}` : '',
  ].filter(Boolean);
  const studyOptions = [
    program.properties.includes('part_time_option') ? 'Part-time option' : '',
    program.properties.includes('subject_completely_in_english') ? 'Can be completed entirely in English' : '',
    program.properties.includes('international_subject') ? 'International degree program' : '',
  ].filter(Boolean);

  row['Course Name'] = `${program.subject} - ${program.variantName}`;
  row['Course URL'] = program.url;
  row['University \nname'] = UNIVERSITY;
  row['Intake Month'] = program.start;
  row['Substream/\nSpecialisation'] = [program.scienceArea, program.faculty].filter(Boolean).join(' | ');
  row['Degree Level'] = program.degree;
  row['Study Level'] = 'PG';
  row['Duration\n(in months)'] = program.duration;
  row['Study option'] = [program.language ? `Teaching language: ${program.language}` : '', ...studyOptions].filter(Boolean).join(' | ');
  row['Program Type'] = program.type || program.variantName;
  row['Tution fees \n(per year)'] = program.fees;
  row['Total Tution \nFees'] = totalFees(program.fees, program.duration);
  row['Main Entry \nRequirements'] = program.linkedAdmission?.text || program.application;
  const scores = languageScores(row['Main Entry \nRequirements']);
  if (scores.ieltsOverall) {
    row['IELTS \n(Overall & Subscores)'] = `Overall ${scores.ieltsOverall}; each subcategory at least ${scores.ieltsSub}`;
    row['ielts_reading_score'] = scores.ieltsSub;
    row['ielts_writing_score'] = scores.ieltsSub;
    row['ielts_listening_score'] = scores.ieltsSub;
    row['ielts_speaking_score'] = scores.ieltsSub;
  }
  if (scores.toeflOverall) {
    row['TOEFL\n(Overall & Subscores)'] = `TOEFL iBT ${scores.toeflOverall}; each subcategory at least ${scores.toeflSub}`;
    row['toefl_reading_score'] = scores.toeflSub;
    row['toefl_writing_score'] = scores.toeflSub;
    row['toefl_listening_score'] = scores.toeflSub;
    row['toefl_speaking_score'] = scores.toeflSub;
  }
  row['Status'] = 'Official listing active';
  row['Intake status(open/close)\n(eg: Fall (september)-Open\nSpring(January)- Closed)'] = program.deadlines;
  row['Remarks (if any)'] = remarks.join(' | ');
  row['Reference Links (if any)'] = [
    `Course: ${program.url}`,
    program.linkedAdmission?.url ? `Admission source: ${program.linkedAdmission.url}` : '',
    `Catalogue: ${CATALOGUE_URL}`,
  ].filter(Boolean).join(' | ');
  const unavailable = 'Not available on official Heidelberg study-finder/detail page';
  for (const column of [
    'Substream/\nSpecialisation',
    'Study option',
    'App fees',
    'Partner',
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
  ]) if (!row[column]) row[column] = column === 'Partner' ? 'Not applicable unless listed by official programme source' : unavailable;
  return row;
}

function validateRecord(row) {
  for (const column of ['Course Name', 'Course URL', 'University \nname', 'Degree Level', 'Study Level', 'Reference Links (if any)']) {
    if (!row[column]?.trim()) throw new CommandExecutionError(`Heidelberg row is missing required field: ${column}`);
  }
  if (!/^https:\/\/www\.uni-heidelberg\.de\/en\/study\/all-subjects\//.test(row['Course URL'])) {
    throw new CommandExecutionError(`Heidelberg row has invalid course URL: ${row['Course URL']}`);
  }
  if (row['Study Level'] !== 'PG') throw new CommandExecutionError('Heidelberg row Study Level must be PG');
  return row;
}

cli({
  site: 'heidelberg',
  name: 'export-postgraduate-courses',
  description: 'Export Heidelberg University non-bachelor/postgraduate programs using the official study finder.',
  access: 'read',
  example: 'webcmd heidelberg export-postgraduate-courses --degree-level masters --count 10 -f csv',
  domain: 'www.uni-heidelberg.de',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'degree-level', type: 'string', default: 'all', help: 'all, masters, certificate, diploma, professional, or doctorate' },
    { name: 'count', type: 'int', required: false, help: 'Positive maximum number of programs after filtering and deduplication' },
  ],
  columns: OUTPUT_COLUMNS,
  func: async (args) => {
    const { degreeLevel, count } = parseOptions(args);
    const { html } = await fetchHtml(CATALOGUE_URL, 'studyFinderTable');
    const filtered = parseCatalogue(html)
      .filter((program) => degreeLevel === 'all' || program.tags.includes(degreeLevel));
    const limited = filtered.slice(0, count === null ? undefined : count);
    const enriched = await enrichPrograms(limited);
    const selected = enriched
      .filter((program) => !/^undergraduate$/i.test(program.type));
    return selected.map((program) => {
      const row = validateRecord(normalizeRecord(program));
      return CSV_OUTPUT
        ? Object.fromEntries(COLUMNS.map((column, index) => [OUTPUT_COLUMNS[index], row[column]]))
        : row;
    });
  },
});
