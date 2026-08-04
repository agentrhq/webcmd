import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  ArgumentError,
  CommandExecutionError,
} from '@agentrhq/webcmd/errors';

const BASE = 'https://www.iit.edu';
const CATALOGUE_URL = `${BASE}/academics/programs`;
const UNIVERSITY = 'Illinois Institute of Technology';
const CHECKED_DATE = '2026-08-03';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1000;
const SOURCES = {
  admission: `${BASE}/admissions-aid/graduate-admission`,
  howToApply: `${BASE}/admissions-aid/graduate-admission/how-apply`,
  applicationFee: `${BASE}/admissions-aid/graduate-admission/domestic-students/admission-requirements-and-checklist`,
  english: `${BASE}/admissions-aid/graduate-admission/international-students/admission-and-english-language-requirements`,
  tuition: `${BASE}/student-accounting/tuition-and-fees/future-tuition-and-fees/mies-campus-graduate`,
  deadlines: `${BASE}/admissions-aid/graduate-admission/admission-dates-and-deadlines`,
  law: 'https://kentlaw.iit.edu/law/admissions/jd-admissions/application-process',
  architecture: 'https://arch.iit.edu/admissions/graduate/',
  design: 'https://id.iit.edu/graduate-school/apply/',
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

function sectionHtmlAfterLabel(block, label) {
  const match = block.match(new RegExp(`<h3[^>]*>\\s*${label}\\s*<\\/h3>([\\s\\S]*?)(?=<div class=['"]cell|<div class=['"]program-large-list|$)`, 'i'));
  return match?.[1] || '';
}

function sectionAfterLabel(block, label) {
  return text(sectionHtmlAfterLabel(block, label));
}

function sectionListAfterLabel(block, label) {
  const raw = sectionHtmlAfterLabel(block, label);
  const items = [...raw.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => text(match[1])).filter(Boolean);
  return items.length ? items : [text(raw)].filter(Boolean);
}

async function fetchHtml(url, marker = '<html') {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Webcmd IIT public data export)' },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
      await pause(attempt * RETRY_DELAY_MS);
      continue;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/html')) {
      clearTimeout(timeout);
      lastError = new Error(`HTTP ${response.status}, ${contentType || 'unknown content type'}`);
      if (!([429].includes(response.status) || response.status >= 500) || attempt === MAX_ATTEMPTS) break;
      await pause(attempt * RETRY_DELAY_MS);
      continue;
    }
    let html;
    try {
      html = await response.text();
      clearTimeout(timeout);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
      await pause(attempt * RETRY_DELAY_MS);
      continue;
    }
    if (marker && !html.includes(marker)) {
      throw new CommandExecutionError(`IIT page structure changed for ${url}: missing ${marker}`);
    }
    return { html, finalUrl: response.url };
  }
  throw new CommandExecutionError(`IIT request failed for ${url}: ${lastError?.message || 'unknown network error'}`);
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (url.hostname !== 'www.iit.edu' || !url.pathname.startsWith('/academics/programs/')) {
    return '';
  }
  url.protocol = 'https:';
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

function classifyDegree(program) {
  const type = program.programType.toLowerCase();
  const degree = program.degree.toLowerCase();
  const tags = new Set();
  if (type.includes('master')) tags.add('masters');
  if (type.includes('certificate') || degree.includes('certificate')) tags.add('certificate');
  if (type.includes('diploma') || degree.includes('diploma')) tags.add('diploma');
  if (degree.includes('j.d.') && type.includes('master')) {
    tags.add('professional');
    tags.add('masters');
  } else if (/^j\.d\.?$/.test(degree)) {
    tags.add('professional');
  } else if (type.includes('doctoral')) {
    tags.add('doctorate');
  }
  return [...tags];
}

function parseCatalogue(html) {
  const rows = [];
  const seen = new Set();
  const blocks = html.match(/<article class=['"][^'"]*program-large-list[^'"]*['"][^>]*>[\s\S]*?<\/article>/gi) || [];
  for (const block of blocks) {
    const link = block.match(/<h2[^>]*>[\s\S]*?<a\s+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const programUrl = canonicalizeProgramUrl(link[1]);
    if (!programUrl) continue;
    const program = {
      url: programUrl,
      name: text(link[2]),
      programType: sectionAfterLabel(block, 'Program Type'),
      degree: sectionAfterLabel(block, 'Degree'),
      college: sectionAfterLabel(block, 'College/School'),
      locations: sectionListAfterLabel(block, 'Program Location'),
    };
    program.tags = classifyDegree(program);
    if (!program.name || !program.programType || !program.degree || !program.tags.length || seen.has(program.url)) continue;
    seen.add(program.url);
    rows.push(program);
  }
  if (!blocks.length || !rows.length) {
    throw new CommandExecutionError('IIT catalogue parser found no postgraduate program cards');
  }
  return rows;
}

async function discoverPrograms(degreeLevel) {
  const { html } = await fetchHtml(CATALOGUE_URL, 'program-large-list');
  const programs = parseCatalogue(html);
  const filtered = degreeLevel === 'all' ? programs : programs.filter((program) => program.tags.includes(degreeLevel));
  return filtered;
}

function extractMeta(html, label) {
  const match = html.match(new RegExp(`<dt[^>]*>\\s*${label}\\s*<\\/dt>\\s*<dd[^>]*>([\\s\\S]*?)<\\/dd>`, 'i'));
  return text(match?.[1]);
}

function extractMetaList(html, label) {
  const match = html.match(new RegExp(`<dt[^>]*>\\s*${label}\\s*<\\/dt>\\s*<dd[^>]*>([\\s\\S]*?)<\\/dd>`, 'i'));
  const raw = match?.[1] || '';
  const items = [...raw.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((item) => text(item[1])).filter(Boolean);
  return items.length ? items : [text(raw)].filter(Boolean);
}

function extractCatalogueDetailUrl(html) {
  const match = html.match(/href=['"](https:\/\/catalog\.iit\.edu\/graduate\/[^'"]+)['"]/i);
  return match ? decodeHtml(match[1]) : '';
}

function extractCredits(html) {
  const plain = text(html);
  const candidates = [
    plain.match(/Minimum Credits Required\s+(\d{1,3})/i),
    plain.match(/Minimum Degree Credits\s+(\d{1,3})/i),
    plain.match(/Total Credit Hours\s+(\d{1,3})/i),
    plain.match(/(?:degree program|program|degree)\s+(?:requires?|consists? of)\s+(?:at least\s+)?(\d{1,3})\s+credit hours/i),
  ];
  return Number(candidates.find(Boolean)?.[1] || 0);
}

function extractDurationMonths(plain) {
  const months = plain.match(/(?:program|degree|complete|completion|duration)[^.]{0,80}?(\d{1,2})\s+months?/i);
  if (months) return String(Number(months[1]));
  const years = plain.match(/(?:program|degree|complete|completion|duration)[^.]{0,80}?(\d(?:\.5)?)\s+years?/i);
  return years ? String(Number(years[1]) * 12) : '';
}

function extractProgramOverrides(plain) {
  const gpa = plain.match(/(?:grade-point average|GPA)[^\d]{0,30}(\d\.\d(?:\/4\.0)?)/i)?.[1] || '';
  const greRequired = /GRE is required|GRE scores? (?:are|is) required/i.test(plain)
    ? 'Yes'
    : /GRE is optional|GRE scores? (?:are|is) optional|does not require (?:the )?GRE/i.test(plain)
      ? 'No'
      : '';
  const greScore = plain.match(/GRE[^.]{0,100}?(\d{3}\s+combined[^.]{0,60})/i)?.[1]?.trim() || '';
  const studyOptions = [
    /coursework only|traditional coursework/i.test(plain) ? 'Coursework Only' : '',
    /master(?:’|'|&#039;)s project/i.test(plain) ? "Master's Project" : '',
    /master(?:’|'|&#039;)s thesis|thesis conducted/i.test(plain) ? "Master's Thesis" : '',
  ].filter(Boolean);
  const status = /program (?:is|has been) discontinued/i.test(plain)
    ? 'Discontinued'
    : /program (?:is|has been) suspended/i.test(plain)
      ? 'Suspended'
      : '';
  return { gpa, greRequired, greScore, studyOptions, status };
}

async function extractProgram(program) {
  let html;
  let finalUrl;
  try {
    ({ html, finalUrl } = await fetchHtml(program.url, '<h1'));
  } catch (error) {
    return {
      ...program,
      durationMonths: '',
      catalogueDetailUrl: '',
      credits: 0,
      gpa: '',
      greRequired: '',
      greScore: '',
      studyOptions: [],
      status: '',
      detailError: error.message,
    };
  }
  const canonicalFinalUrl = canonicalizeProgramUrl(finalUrl);
  if (!canonicalFinalUrl) return null;
  const mainHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  const h1 = mainHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const name = text(h1?.[1]);
  const degree = extractMeta(mainHtml, 'Degree') || program.degree;
  const programType = extractMeta(mainHtml, 'Program Type') || program.programType;
  if (!name || !degree || !programType) {
    throw new CommandExecutionError(`IIT program parser could not read identity fields from ${program.url}`);
  }
  const plain = text(mainHtml);
  let catalogueDetailUrl = extractCatalogueDetailUrl(mainHtml);
  let credits = 0;
  if (catalogueDetailUrl) {
    try {
      const catalogueDetail = await fetchHtml(catalogueDetailUrl, '<html');
      credits = extractCredits(catalogueDetail.html);
    } catch (error) {
      catalogueDetailUrl = '';
      if (!/HTTP 404/.test(error.message)) {
        program.curriculumError = error.message;
      }
    }
  }
  return {
    ...program,
    name,
    degree,
    programType,
    college: extractMeta(mainHtml, 'College') || program.college,
    locations: extractMetaList(mainHtml, 'Program Location').length
      ? extractMetaList(mainHtml, 'Program Location')
      : program.locations,
    durationMonths: extractDurationMonths(plain),
    catalogueDetailUrl,
    credits,
    curriculumError: program.curriculumError || '',
    ...extractProgramOverrides(plain),
    url: canonicalFinalUrl,
  };
}

async function extractAllPrograms(programs) {
  const details = [];
  for (let index = 0; index < programs.length; index += 64) {
    details.push(...await Promise.all(programs.slice(index, index + 64).map(extractProgram)));
  }
  return details;
}

async function fetchSharedSource(url, requiredMarkers = []) {
  const result = await fetchHtml(url, '<html');
  for (const marker of requiredMarkers) {
    if (!result.html.includes(marker)) {
      throw new CommandExecutionError(`IIT shared source changed for ${url}: missing ${marker}`);
    }
  }
  return result.html;
}

async function extractSharedRequirements() {
  const [admission, howToApply, applicationFee, english, tuition, deadlines, law, architecture, design] = await Promise.all([
    fetchSharedSource(SOURCES.admission, ['3.0', 'GRE']),
    fetchSharedSource(SOURCES.howToApply, ['Official Transcripts', 'GRE Testing']),
    fetchSharedSource(SOURCES.applicationFee, ['$100', 'application fee']),
    fetchSharedSource(SOURCES.english, ['TOEFL iBT', 'IELTS', 'Duolingo English Test']),
    fetchSharedSource(SOURCES.tuition, ['$1,925', '2026–2027']),
    fetchSharedSource(SOURCES.deadlines, ['Fall Term', 'Spring Term', 'June 15', 'November 15']),
    fetchSharedSource(SOURCES.law, ['Priority Application Deadline', 'LSAT or GRE']),
    fetchSharedSource(SOURCES.architecture),
    fetchSharedSource(SOURCES.design, ['$100', 'minimum TOEFL score', 'minimum IELTS']),
  ]);
  return {
    catalogueUrl: CATALOGUE_URL,
    sources: SOURCES,
    tuitionRate: tuition.includes('$1,925') ? 1925 : 0,
    generalAdmission: admission && howToApply && applicationFee,
    generalEnglish: english,
    generalDeadlines: deadlines,
    specialSources: { law, architecture, design },
  };
}

function mergeProgramData(program, shared) {
  return { ...shared, ...program };
}

function normalizeRecord(data) {
  const row = Object.fromEntries(COLUMNS.map((column) => [column, '']));
  const college = data.college.toLowerCase();
  const isLaw = college.includes('law');
  const isArchitecture = college.includes('architecture');
  const isDesign = college.includes('institute of design');
  const designIdentity = `${data.degree} ${data.name}`;
  const isMdes = /M\.Des|Master of Design/i.test(designIdentity);
  const isMsSdl = /Strategic Design Leadership|MS-SDL/i.test(designIdentity);
  const generalProgram = !isLaw && !isDesign;
  const programTags = classifyDegree(data);
  const referenceLinks = [
    `Course: ${data.url}`,
    `Catalogue: ${data.catalogueUrl}`,
    data.catalogueDetailUrl ? `Curriculum: ${data.catalogueDetailUrl}` : '',
    isLaw ? '' : `Fees: ${isDesign ? data.sources.design : data.sources.tuition}`,
    generalProgram ? `English: ${data.sources.english}` : '',
    `Admissions: ${isLaw ? data.sources.law : isDesign ? data.sources.design : isArchitecture ? data.sources.architecture : data.sources.admission}`,
    generalProgram && !isArchitecture ? `Deadlines: ${data.sources.deadlines}` : '',
  ].filter(Boolean);
  const remarks = [];
  if (data.detailError) remarks.push(`Program detail page unavailable on ${CHECKED_DATE}: ${data.detailError}`);
  if (data.curriculumError) remarks.push(`Curriculum page unavailable on ${CHECKED_DATE}: ${data.curriculumError}`);

  row['Course Name'] = data.name;
  row['Course URL'] = data.url;
  row['University \nname'] = UNIVERSITY;
  if (isLaw) {
    row['Intake Month'] = 'Fall (August)';
    row['GRE Required'] = 'No';
    row['Main Entry \nRequirements'] = 'LSAT or GRE taken within five years | CAS report and transcripts | Personal statement | At least one recommendation';
    row['Intake status(open/close)\n(eg: Fall (september)-Open\nSpring(January)- Closed)'] = 'Fall (August) - Priority deadline: January 15 | Suggested regular deadline: March 15';
    remarks.push(`Checked: ${CHECKED_DATE}`);
  } else if (isDesign) {
    row['Intake Month'] = /foundation/i.test(data.name) ? 'Fall (August)' : 'Fall (August) | Spring (January)';
    row['App fees'] = 'USD 100';
    row['IELTS \n(Overall & Subscores)'] = '7.5';
    row['TOEFL\n(Overall & Subscores)'] = '100';
    row['GRE Required'] = isMdes || isMsSdl ? 'No' : '';
    row['GMAT Required'] = isMdes || isMsSdl ? 'No' : '';
    row['Min UG score'] = data.gpa || '3.0/4.0';
    row['15 years of\nEducation Allowed?'] = 'No';
    row['Work \nExperience \nRequired?'] = isMdes ? 'No' : isMsSdl ? 'Yes' : '';
    row['Main Entry \nRequirements'] = `${isMsSdl ? 'Minimum eight years of professional experience | ' : ''}Minimum GPA 3.0/4.0 | Official transcripts | Statement | Three recommenders | Program-specific portfolio requirements`;
  } else {
    row['Intake Month'] = isArchitecture ? '' : 'Fall (August) | Spring (January)';
    row['App fees'] = 'USD 100';
    row['IELTS \n(Overall & Subscores)'] = '6.5 (6.0 each subsection)';
    row['ielts_reading_score'] = '6.0';
    row['ielts_writing_score'] = '6.0';
    row['ielts_listening_score'] = '6.0';
    row['ielts_speaking_score'] = '6.0';
    row['TOEFL\n(Overall & Subscores)'] = '4.5 (4.5 each subsection; tests on/after January 21, 2026)';
    row['toefl_reading_score'] = '4.5';
    row['toefl_writing_score'] = '4.5';
    row['toefl_listening_score'] = '4.5';
    row['toefl_speaking_score'] = '4.5';
    row['Duolingo\n(Overall & Subscores)'] = '115 (110 each subsection)';
    row['duolingo_comprehension_score'] = '110';
    row['duolingo_literacy_score'] = '110';
    row['duolingo_conversation_score'] = '110';
    row['duolingo_production_score'] = '110';
    row['Is Waiver \nProvided?'] = 'Yes';
    row['Waiver Info'] = 'Qualifying intensive English program, recent U.S. study, qualifying English-speaking-country degree, or published India NAAC/MOI route';
    row['Is MOI \naccepted?'] = 'Yes';
    row['Share list, if any'] = 'Antigua | Australia | Bahamas | Barbados | Belize | British Virgin Islands | Canada (except Quebec) | Dominica | Ghana | Grenada | Guyana | Jamaica | Malta | New Zealand | Nigeria | St. Kitts and Nevis | St. Lucia | St. Vincent and the Grenadines | Tobago | Trinidad | United Kingdom | United States | US Virgin Islands';
    row['Min UG score'] = data.gpa || '3.0/4.0';
    row['GRE Required'] = data.greRequired || (programTags.includes('masters') || programTags.includes('certificate') ? 'No' : '');
    row['GMAT Required'] = 'No university-wide GMAT requirement; Institute of Design and Stuart School of Business accept GMAT in addition to GRE';
    row['GRE/GMAT Scores'] = data.greScore;
    row['12th scores'] = 'Not applicable (graduate admission)';
    row['Work \nExperience \nRequired?'] = 'Not available as a single value on official program page';
    row['Main Entry \nRequirements'] = 'Four-year bachelor’s degree or equivalent | Minimum GPA 3.0/4.0 | Official transcripts | Resume/CV | Personal statement | Recommendations vary by program';
    if (!isArchitecture) {
      row['Intake status(open/close)\n(eg: Fall (september)-Open\nSpring(January)- Closed)'] = 'Fall (August) - Deadline: June 15 (international outside U.S.) | Spring (January) - Deadline: November 15';
      remarks.push(`Checked: ${CHECKED_DATE}`);
    }
  }
  row['Degree Level'] = data.degree;
  row['Study Level'] = 'PG';
  row['Duration\n(in months)'] = data.durationMonths;
  row['Study option'] = (data.studyOptions.length ? data.studyOptions : data.locations).join(' | ');
  row['Program Type'] = data.programType;
  row['Status'] = data.status || 'Active (listed in official program catalogue)';
  if (!isLaw && !isDesign && data.tuitionRate) {
    row['Tution fees \n(per year)'] = `USD ${data.tuitionRate.toLocaleString('en-US')} per credit; annual total is not available as a single value`;
  }
  if (data.credits && data.tuitionRate) {
    row['Total Tution \nFees'] = `USD ${(data.credits * data.tuitionRate).toLocaleString('en-US')}`;
    remarks.push(`Calculated base tuition: ${data.credits} credits × USD ${data.tuitionRate.toLocaleString('en-US')}/credit; excludes fees`);
  } else {
    remarks.push('Total tuition is blank because the reviewed official sources do not publish a program credit total or program-specific total tuition');
  }
  if (!isLaw && !isDesign) {
    remarks.push('PTE minimum and test subscores are not available on the reviewed university-wide English requirements page');
  }
  if (!row['GRE/GMAT Scores']) {
    remarks.push('GRE/GMAT score minimum is not available university-wide');
  }
  const unavailable = 'Not available on official program page';
  for (const column of [
    'Substream/\nSpecialisation',
    'Partner',
    'PTE\n(Overall & Subscores)',
    'pte_reading_score',
    'pte_writing_score',
    'pte_listening_score',
    'pte_speaking_score',
    'GRE/GMAT Scores',
    '15 years of\nEducation Allowed?',
    'Gap Years',
    'Backlogs',
  ]) {
    if (!row[column]) row[column] = column === 'Partner' ? 'Not applicable unless listed by official program source' : unavailable;
  }
  if (!row['Duration\n(in months)']) row['Duration\n(in months)'] = 'Not available as a single value on official program page';
  if (!row['Total Tution \nFees']) row['Total Tution \nFees'] = 'Not available as an official total on program page';
  if (!row['GRE Required']) row['GRE Required'] = 'Not available as a single value on official program page';
  row['Remarks (if any)'] = remarks.join(' | ');
  row['Reference Links (if any)'] = referenceLinks.join(' | ');
  return row;
}

function validateRecord(row) {
  for (const column of ['Course Name', 'Course URL', 'University \nname', 'Degree Level', 'Study Level', 'Reference Links (if any)']) {
    if (!row[column]?.trim()) throw new CommandExecutionError(`IIT row is missing required field: ${column}`);
  }
  if (!/^https:\/\/www\.iit\.edu\/academics\/programs\//.test(row['Course URL'])) {
    throw new CommandExecutionError(`IIT row has invalid course URL: ${row['Course URL']}`);
  }
  if (row['Study Level'] !== 'PG') throw new CommandExecutionError('IIT row Study Level must be PG');
  return row;
}

cli({
  site: 'iit',
  name: 'export-postgraduate-courses',
  description: 'Export Illinois Tech postgraduate programs using official public sources.',
  access: 'read',
  example: 'webcmd iit export-postgraduate-courses --degree-level masters --count 10 -f csv',
  domain: 'www.iit.edu',
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
    const shared = await extractSharedRequirements();
    const rows = [];
    const seenFinalUrls = new Set();
    const details = count === null ? await extractAllPrograms(programs) : programs;
    for (const program of details) {
      const detail = count === null ? program : await extractProgram(program);
      if (!detail || seenFinalUrls.has(detail.url)) continue;
      seenFinalUrls.add(detail.url);
      const row = validateRecord(normalizeRecord(mergeProgramData(detail, shared)));
      rows.push(CSV_OUTPUT
        ? Object.fromEntries(COLUMNS.map((column, index) => [OUTPUT_COLUMNS[index], row[column]]))
        : row);
      if (count !== null && rows.length >= count) break;
    }
    return rows;
  },
});
