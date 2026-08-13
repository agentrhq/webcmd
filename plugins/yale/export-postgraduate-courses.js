import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  ArgumentError,
  CommandExecutionError,
} from '@agentrhq/webcmd/errors';

const UNIVERSITY = 'Yale University';
const CHECKED_DATE = '2026-08-03';
const REQUEST_TIMEOUT_MS = 20000;
const DETAIL_CONCURRENCY = 8;
const GSAS_PROGRAMS_URL = 'https://gsas.yale.edu/programs-of-study';
const GSAS_CERTIFICATES_URL = 'https://gsas.yale.edu/programs-of-study/certificates';
const GSAS_APPLICATION_URL = 'https://gsas.yale.edu/admissions/phdmasters-application-process';
const GSAS_TESTS_URL = 'https://gsas.yale.edu/admissions/phdmasters-application-process/standardized-testing-requirements';
const GSAS_TUITION_URL = 'https://gsas.yale.edu/resources/graduate-financial-aid/tuition-and-fees';
const YALE_GRAD_PROF_URL = 'https://www.yale.edu/academics/graduate-professional-study';
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

const PROFESSIONAL_PROGRAMS = [
  ['Master of Architecture I', 'https://catalog.yale.edu/architecture/master-architecture-i-degree-program/', 'School of Architecture', 'Master of Architecture I', ['masters', 'professional']],
  ['Master of Architecture II', 'https://catalog.yale.edu/architecture/master-architecture-ii-degree-program/', 'School of Architecture', 'Master of Architecture II', ['masters', 'professional']],
  ['Master of Environmental Design', 'https://catalog.yale.edu/architecture/master-environmental-design-degree-program/', 'School of Architecture', 'Master of Environmental Design', ['masters', 'professional']],
  ['Doctor of Philosophy in Architecture', 'https://catalog.yale.edu/architecture/doctor-philosophy-program/', 'School of Architecture', 'Doctor of Philosophy', ['doctorate']],

  ['Master of Fine Arts in Graphic Design', 'https://catalog.yale.edu/art/degrees-enrollment/', 'School of Art', 'Master of Fine Arts', ['masters', 'professional']],
  ['Master of Fine Arts in Painting/Printmaking', 'https://catalog.yale.edu/art/degrees-enrollment/', 'School of Art', 'Master of Fine Arts', ['masters', 'professional']],
  ['Master of Fine Arts in Photography', 'https://catalog.yale.edu/art/degrees-enrollment/', 'School of Art', 'Master of Fine Arts', ['masters', 'professional']],
  ['Master of Fine Arts in Sculpture', 'https://catalog.yale.edu/art/degrees-enrollment/', 'School of Art', 'Master of Fine Arts', ['masters', 'professional']],

  ['Master of Divinity', 'https://catalog.yale.edu/div/programs-study/master-divinity-degree-requirements/', 'Divinity School', 'Master of Divinity', ['masters', 'professional']],
  ['Master of Arts in Religion', 'https://catalog.yale.edu/div/programs-study/master-arts-religion-degree-requirements/', 'Divinity School', 'Master of Arts in Religion', ['masters']],
  ['Master of Sacred Theology', 'https://catalog.yale.edu/div/programs-study/master-sacred-theology-degree-requirements/', 'Divinity School', 'Master of Sacred Theology', ['masters', 'professional']],

  ['Master in Public Policy in Global Affairs', 'https://catalog.yale.edu/global-affairs/degree-programs/mpp/', 'Jackson School of Global Affairs', 'Master in Public Policy', ['masters', 'professional']],
  ['Master of Advanced Study in Global Affairs', 'https://catalog.yale.edu/global-affairs/degree-programs/mas/', 'Jackson School of Global Affairs', 'Master of Advanced Study', ['masters', 'professional']],
  ['Joint-Degree Programs with Other Yale Schools', 'https://catalog.yale.edu/global-affairs/degree-programs/joint-degree-programs/', 'Jackson School of Global Affairs', 'Joint Degree', ['masters', 'professional']],

  ['Two-Year Master’s Degree Programs in Environmental Management / Forestry / Environmental Science / Forest Science', 'https://catalog.yale.edu/environment/masters-degree-programs/two-year/', 'School of the Environment', 'Master’s Degree Programs', ['masters', 'professional']],
  ['Five-Year Environmental Master’s Program for Yale College and Yale-NUS College Students', 'https://catalog.yale.edu/environment/masters-degree-programs/five-year/', 'School of the Environment', 'Master’s Degree Program', ['masters']],
  ['Joint-Master’s-Degree Programs in Environment', 'https://catalog.yale.edu/environment/masters-degree-programs/joint/', 'School of the Environment', 'Joint Master’s Degree', ['masters', 'professional']],
  ['Doctoral Degree Program in Environment', 'https://catalog.yale.edu/environment/doctoral-degree-program/', 'School of the Environment', 'Doctoral Degree', ['doctorate']],

  ['J.D. Program', 'https://law.yale.edu/study-law-yale/degree-programs', 'Law School', 'Juris Doctor', ['professional']],
  ['LL.M. Program', 'https://law.yale.edu/study-law-yale/degree-programs/graduate-programs', 'Law School', 'Master of Laws', ['masters', 'professional']],
  ['M.S.L. Program', 'https://law.yale.edu/study-law-yale/degree-programs/graduate-programs', 'Law School', 'Master of Studies in Law', ['masters', 'professional']],
  ['J.S.D. Program', 'https://law.yale.edu/study-law-yale/degree-programs/graduate-programs', 'Law School', 'Doctor of the Science of Law', ['doctorate', 'professional']],
  ['Ph.D. Program in Law', 'https://law.yale.edu/study-law-yale/degree-programs', 'Law School', 'Doctor of Philosophy in Law', ['doctorate', 'professional']],
  ['Joint Degree Programs in Law', 'https://law.yale.edu/study-law-yale/degree-programs/joint-degrees', 'Law School', 'Joint Degree', ['masters', 'doctorate', 'professional']],

  ['Full-Time M.B.A.', 'https://catalog.yale.edu/management/full-time-mba/', 'School of Management', 'Master of Business Administration', ['masters', 'professional']],
  ['M.B.A. for Executives', 'https://catalog.yale.edu/management/mba-executives/', 'School of Management', 'Master of Business Administration', ['masters', 'professional']],
  ['Master of Advanced Management', 'https://catalog.yale.edu/management/mam/', 'School of Management', 'Master of Advanced Management', ['masters', 'professional']],
  ['Master of Management Studies', 'https://catalog.yale.edu/management/mms/', 'School of Management', 'Master of Management Studies', ['masters', 'professional']],
  ['Doctoral Degree Program in Management', 'https://catalog.yale.edu/management/doctoral-degree/', 'School of Management', 'Doctoral Degree', ['doctorate']],

  ['MD Program', 'https://medicine.yale.edu/md-program/', 'School of Medicine', 'Doctor of Medicine', ['professional']],
  ['MD-PhD Program', 'https://medicine.yale.edu/mdphd/', 'School of Medicine', 'Doctor of Medicine / Doctor of Philosophy', ['doctorate', 'professional']],
  ['PA Program', 'https://medicine.yale.edu/pa/', 'School of Medicine', 'Physician Associate Program', ['masters', 'professional']],
  ['PA Online Program', 'https://medicine.yale.edu/education/paonline/', 'School of Medicine', 'Physician Associate Program', ['masters', 'professional']],
  ['MHS in Medical Education', 'https://medicine.yale.edu/edu/mhs-degree/medical-education/', 'School of Medicine', 'Master of Health Science', ['masters', 'professional']],
  ['MHS in Health Services, Policy, and Outcomes', 'https://medicine.yale.edu/edu/mhs-degree/health-services-policy-outcomes/', 'School of Medicine', 'Master of Health Science', ['masters', 'professional']],
  ['MHS in Clinical Investigation', 'https://medicine.yale.edu/edu/mhs-degree/clinical-investigation/', 'School of Medicine', 'Master of Health Science', ['masters', 'professional']],
  ['MHS in Clinical Informatics & Data Science', 'https://medicine.yale.edu/edu/mhs-degree/clinical-informatics-data-science/', 'School of Medicine', 'Master of Health Science', ['masters', 'professional']],
  ['MHS in Medical AI', 'https://medicine.yale.edu/edu/mhs-degree/medical-ai/', 'School of Medicine', 'Master of Health Science', ['masters', 'professional']],

  ['Master of Music', 'https://music.yale.edu/degrees-and-programs', 'School of Music', 'Master of Music', ['masters', 'professional']],
  ['Master of Musical Arts', 'https://music.yale.edu/degrees-and-programs', 'School of Music', 'Master of Musical Arts', ['masters', 'professional']],
  ['Doctor of Musical Arts', 'https://music.yale.edu/degrees-and-programs', 'School of Music', 'Doctor of Musical Arts', ['doctorate', 'professional']],
  ['Artist Diploma', 'https://music.yale.edu/degrees-and-programs', 'School of Music', 'Artist Diploma', ['diploma', 'professional']],
  ['Certificate in Performance', 'https://music.yale.edu/degrees-and-programs', 'School of Music', 'Certificate in Performance', ['certificate', 'professional']],
  ['Bachelor of Arts/Master of Music', 'https://music.yale.edu/degrees-and-programs', 'School of Music', 'Bachelor of Arts / Master of Music', ['masters', 'professional']],

  ['Master’s Program (M.S.N.)', 'https://catalog.yale.edu/nursing/masters-program-msn/', 'School of Nursing', 'Master of Science in Nursing', ['masters', 'professional']],
  ['Post-Master’s Certificates in Nursing', 'https://catalog.yale.edu/nursing/post-masters-certificates/', 'School of Nursing', 'Post-Master’s Certificate', ['certificate', 'professional']],
  ['Doctor of Nursing Practice', 'https://catalog.yale.edu/nursing/doctor-nursing-practice-dnp-program/', 'School of Nursing', 'Doctor of Nursing Practice', ['doctorate', 'professional']],
  ['Doctor of Philosophy in Nursing', 'https://catalog.yale.edu/nursing/doctor-philosophy-program/', 'School of Nursing', 'Doctor of Philosophy', ['doctorate']],

  ['Traditional Two-Year M.P.H.', 'https://catalog.yale.edu/ysph/traditional-two-year-mph-program/', 'School of Public Health', 'Master of Public Health', ['masters', 'professional']],
  ['Advanced Professional M.P.H.', 'https://catalog.yale.edu/ysph/advanced-professional-mph-program/', 'School of Public Health', 'Master of Public Health', ['masters', 'professional']],
  ['Executive M.P.H.', 'https://catalog.yale.edu/ysph/executive-mph-program/', 'School of Public Health', 'Master of Public Health', ['masters', 'professional']],
  ['Master of Science in Public Health', 'https://catalog.yale.edu/ysph/master-science-public-health/', 'School of Public Health', 'Master of Science in Public Health', ['masters', 'professional']],
  ['Doctoral Degree in Public Health', 'https://catalog.yale.edu/ysph/doctoral-degree/', 'School of Public Health', 'Doctoral Degree', ['doctorate']],
  ['Public Health Joint-Degree Programs', 'https://catalog.yale.edu/ysph/joint-degree-programs/', 'School of Public Health', 'Joint Degree', ['masters', 'professional']],

  ['Acting', 'https://www.drama.yale.edu/training/acting/', 'David Geffen School of Drama', 'Master of Fine Arts / Certificate in Drama', ['masters', 'certificate', 'professional']],
  ['Design', 'https://www.drama.yale.edu/training/design/', 'David Geffen School of Drama', 'Master of Fine Arts / Certificate in Drama', ['masters', 'certificate', 'professional']],
  ['Directing', 'https://www.drama.yale.edu/training/directing/', 'David Geffen School of Drama', 'Master of Fine Arts / Certificate in Drama', ['masters', 'certificate', 'professional']],
  ['Dramaturgy and Dramatic Criticism', 'https://www.drama.yale.edu/training/dramaturgy-and-dramatic-criticism/', 'David Geffen School of Drama', 'Doctor of Fine Arts / Master of Fine Arts / Certificate in Drama', ['masters', 'doctorate', 'certificate', 'professional']],
  ['Playwriting', 'https://www.drama.yale.edu/training/playwriting/', 'David Geffen School of Drama', 'Master of Fine Arts / Certificate in Drama', ['masters', 'certificate', 'professional']],
  ['Stage Management', 'https://www.drama.yale.edu/training/stage-management/', 'David Geffen School of Drama', 'Master of Fine Arts / Certificate in Drama', ['masters', 'certificate', 'professional']],
  ['Technical Design and Production', 'https://www.drama.yale.edu/training/technical-design-production/', 'David Geffen School of Drama', 'Master of Fine Arts / Certificate in Drama', ['masters', 'certificate', 'professional']],
  ['Theater Management', 'https://www.drama.yale.edu/training/theater-management/', 'David Geffen School of Drama', 'Master of Fine Arts / Certificate in Drama', ['masters', 'certificate', 'professional']],
];

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
  const degreeLevel = String(args['degree-level'] ?? 'all').trim().toLowerCase();
  if (degreeLevel !== '' && !DEGREE_LEVELS.has(degreeLevel)) {
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

function absoluteUrl(value, base) {
  const url = new URL(decodeHtml(value), base);
  url.hash = '';
  return url.href;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Webcmd Yale public data export)' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new CommandExecutionError(`Yale source request failed: HTTP ${response.status} ${url}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      throw new CommandExecutionError(`Yale source returned ${contentType || 'unknown content type'} instead of HTML: ${url}`);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof CommandExecutionError) throw error;
    throw new CommandExecutionError(`Yale source request failed for ${url}: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function sectionText(html, id) {
  const section = html.match(new RegExp(`<section[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)(?=<section[^>]+id=|</main>|</article>|$)`, 'i'))?.[1] || '';
  return text(section);
}

function tagsFromDegree(degree) {
  const tags = new Set();
  if (/master|M\.?A\.?|M\.?S\.?|M\.?M\.?|M\.?F\.?A\.?|M\.?P\.?H\.?|M\.?B\.?A\.?|M\.?D[iiv]|M\.?A\.?M\.?|M\.?M\.?S\.?/i.test(degree)) tags.add('masters');
  if (/certificate/i.test(degree)) tags.add('certificate');
  if (/diploma/i.test(degree)) tags.add('diploma');
  if (/doctor|PhD|Ph\.D|D\.?N\.?P|D\.?M\.?A|D\.?F\.?A|J\.?S\.?D/i.test(degree)) tags.add('doctorate');
  return [...tags];
}

function parseGsasPrograms(html) {
  if (!html.includes('program-listing__item')) {
    throw new CommandExecutionError('Yale GSAS program page structure changed: missing program list marker');
  }
  const rows = [];
  const itemPattern = /<li class=["']program-listing__item["'][^>]*>([\s\S]*?)<\/li>\s*(?=<li class=["']program-listing__item["']|<\/ol>)/gi;
  for (const item of html.matchAll(itemPattern)) {
    const block = item[1];
    const link = block.match(/<a\s+href=["']([^"']+)["'][^>]*class=["'][^"']*arrow-link[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const degreesBlock = block.match(/<div class=["']program-listing__degree["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
    const degrees = [...degreesBlock.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => text(m[1])).filter(Boolean);
    if (!degrees.length) continue;
    const deadline = text(block.match(/<span class=["']date["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    const division = text(block.match(/<em>([\s\S]*?)<\/em>/i)?.[1] || '');
    const tags = [...new Set(degrees.flatMap(tagsFromDegree))];
    rows.push({
      name: text(link[2]),
      url: absoluteUrl(link[1], GSAS_PROGRAMS_URL),
      school: 'Graduate School of Arts and Sciences',
      degree: degrees.join(' | '),
      substream: division,
      tags,
      note: deadline ? `Application deadline: ${deadline}.` : '',
      source: GSAS_PROGRAMS_URL,
    });
  }
  if (!rows.length) throw new CommandExecutionError('Yale GSAS parser found no graduate programs');
  return rows;
}

function parseGsasCertificates(html) {
  if (!html.includes('Current certificates:')) {
    throw new CommandExecutionError('Yale GSAS certificates page structure changed: missing certificate marker');
  }
  const rows = [];
  const current = html.match(/<strong>Current certificates:<\/strong><\/p><ul>([\s\S]*?)<\/ul><h2>Certificates in Training<\/h2>/i)?.[1] || '';
  const training = html.match(/<h2>Certificates in Training<\/h2>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i)?.[1] || '';
  for (const block of [current, training]) {
    for (const match of block.matchAll(/<li>(?:<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>|([^<]+))/gi)) {
      const name = text(match[2] || match[3] || '');
      const url = match[1] ? absoluteUrl(match[1], GSAS_CERTIFICATES_URL) : GSAS_CERTIFICATES_URL;
      if (!name || /African Studies|European and Russian|Latin American|Middle East/i.test(name)) continue;
      rows.push({
        name,
        url,
        school: 'Graduate School of Arts and Sciences',
        degree: 'Graduate Certificate',
        substream: 'Certificate',
        tags: ['certificate'],
        note: 'GSAS certificate program.',
        source: GSAS_CERTIFICATES_URL,
      });
    }
  }
  return rows;
}

function professionalRows() {
  return PROFESSIONAL_PROGRAMS.map(([name, url, school, degree, tags]) => ({
    name,
    url,
    school,
    degree,
    substream: school,
    tags,
    note: 'Official Yale school/catalog program page.',
    source: YALE_GRAD_PROF_URL,
  }));
}

function greRequirement(admissionText = '') {
  if (/GRE is not accepted|GRE General Test scores will not be considered/i.test(admissionText)) return 'No';
  if (/GRE is required|must submit GRE/i.test(admissionText)) return 'Yes';
  if (/GRE is optional|may submit GRE/i.test(admissionText)) return 'Optional';
  if (/GRE/i.test(admissionText)) return 'See requirements';
  return '';
}

function pageSummary(html, programName = '') {
  const value = text(String(html)
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<h[1-6]\b[^>]*>/gi, ' | ')
    .replace(/<\/(?:p|li|h[1-6]|div|section)>/gi, ' | '));
  const needle = programName.split(/\s+/).slice(0, 3).join(' ');
  const at = needle ? value.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  return (at >= 0 ? value.slice(at) : value).replace(/\s*\|\s*/g, ' | ').slice(0, 1800).trim();
}

async function enrichProgram(program) {
  try {
    const html = await fetchHtml(program.url);
    if (program.school !== 'Graduate School of Arts and Sciences' || !program.url.startsWith(`${GSAS_PROGRAMS_URL}/`)) {
      return {
        ...program,
        admissionText: pageSummary(html, program.name),
        greRequired: greRequirement(pageSummary(html, program.name)),
        englishRequirement: '',
        detailError: '',
      };
    }
    const admissionText = sectionText(html, 'admission-requirements');
    return {
      ...program,
      admissionText,
      greRequired: greRequirement(admissionText),
      englishRequirement: admissionText.match(/TOEFL iBT or IELTS Academic[^.]+\.[\s\S]*?(?=Academic Information|Financial Information|$)/i)?.[0]?.replace(/\s+/g, ' ').trim() || '',
      detailError: '',
    };
  } catch (error) {
    return { ...program, admissionText: '', greRequired: '', englishRequirement: '', detailError: error.message };
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
  const isGsas = program.school === 'Graduate School of Arts and Sciences';
  const refs = [`Course: ${program.url}`, `Source: ${program.source}`];
  const remarks = [
    `Checked ${CHECKED_DATE}; official Yale source.`,
    program.note,
    program.detailError ? `Detail page fields unavailable: ${program.detailError}` : '',
    isGsas ? 'GSAS fee, tuition, test, and admissions values are enriched from official GSAS detail/shared pages.' : 'Professional-school fields without a page value are marked unavailable for that official program page.',
  ].filter(Boolean);

  row['Course Name'] = program.name;
  row['Course URL'] = program.url;
  row['University \nname'] = UNIVERSITY;
  row['Substream/\nSpecialisation'] = program.substream;
  row['Degree Level'] = program.degree;
  row['Study Level'] = 'PG';
  row['Program Type'] = program.school;
  row['Status'] = 'Official listing active';
  if (isGsas) {
    refs.push(`Application fee: ${GSAS_APPLICATION_URL}`, `Standardized tests: ${GSAS_TESTS_URL}`, `Tuition: ${GSAS_TUITION_URL}`);
    row['App fees'] = 'USD 105';
    row['Tution fees \n(per year)'] = 'USD 52,400 full-time GSAS tuition for 2026-2027';
    row['Total Tution \nFees'] = 'Not available as a fixed total on official GSAS tuition page';
    row['IELTS \n(Overall & Subscores)'] = 'IELTS Academic required for most applicants whose native language is not English; minimum score not available on official GSAS page';
    row['TOEFL\n(Overall & Subscores)'] = 'TOEFL iBT required for most applicants whose native language is not English; minimum score not available on official GSAS page';
    row['Is Waiver \nProvided?'] = 'Yes';
    row['Waiver Info'] = 'English test exemption may apply with an undergraduate degree from an institution where English is the primary language of instruction and at least three years in residence';
    row['GRE Required'] = program.greRequired;
    row['GMAT Required'] = /Management/i.test(program.name) ? 'GMAT accepted in lieu of GRE for Management PhD' : 'No';
    row['GRE/GMAT Scores'] = program.greRequired === 'No' ? 'GRE not accepted' : program.greRequired ? 'Minimum score not available on official GSAS page' : '';
    row['Main Entry \nRequirements'] = program.admissionText;
  } else if (program.admissionText) {
    row['Main Entry \nRequirements'] = program.admissionText;
    row['GRE Required'] = program.greRequired || '';
  }
  row['Remarks (if any)'] = remarks.join(' ');
  row['Reference Links (if any)'] = refs.join(' | ');
  return applyBlankPolicy(row, isGsas ? 'GSAS' : 'school/program');
}

function applyBlankPolicy(row, scope) {
  const unavailable = `Not available as a fixed value on official ${scope} page`;
  for (const column of [
    'Intake Month',
    'Duration\n(in months)',
    'Study option',
    'Partner',
    'PTE\n(Overall & Subscores)',
    'Duolingo\n(Overall & Subscores)',
    'Is MOI \naccepted?',
    'Share list, if any',
    '15 years of\nEducation Allowed?',
    'Gap Years',
    'Backlogs',
    'Work \nExperience \nRequired?',
    'Intake status(open/close)\n(eg: Fall (september)-Open\nSpring(January)- Closed)',
  ]) {
    if (!row[column]) row[column] = column === 'Partner' ? 'Not applicable unless listed by official program page' : unavailable;
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
    if (!row[column]) row[column] = `Not available on official ${scope} page`;
  }
  if (!row['App fees']) row['App fees'] = unavailable;
  if (!row['Tution fees \n(per year)']) row['Tution fees \n(per year)'] = unavailable;
  if (!row['Total Tution \nFees']) row['Total Tution \nFees'] = unavailable;
  if (!row['IELTS \n(Overall & Subscores)']) row['IELTS \n(Overall & Subscores)'] = unavailable;
  if (!row['TOEFL\n(Overall & Subscores)']) row['TOEFL\n(Overall & Subscores)'] = unavailable;
  if (!row['Is Waiver \nProvided?']) row['Is Waiver \nProvided?'] = unavailable;
  if (!row['Waiver Info']) row['Waiver Info'] = unavailable;
  if (!row['GRE Required']) row['GRE Required'] = unavailable;
  if (!row['GMAT Required']) row['GMAT Required'] = unavailable;
  if (!row['12th scores']) row['12th scores'] = 'Not applicable for postgraduate admission';
  if (!row['Main Entry \nRequirements']) row['Main Entry \nRequirements'] = unavailable;
  return row;
}

function validateRecord(row) {
  for (const column of ['Course Name', 'Course URL', 'University \nname', 'Degree Level', 'Study Level', 'Reference Links (if any)']) {
    if (!row[column]?.trim()) throw new CommandExecutionError(`Yale row is missing required field: ${column}`);
  }
  if (!/^https:\/\/(?:[a-z0-9-]+\.)*yale\.edu\//i.test(row['Course URL'])) {
    throw new CommandExecutionError(`Yale row has non-official course URL: ${row['Course URL']}`);
  }
  if (row['Study Level'] !== 'PG') throw new CommandExecutionError('Yale row Study Level must be PG');
  return row;
}

function dedupe(programs) {
  const seen = new Set();
  const rows = [];
  for (const program of programs) {
    const key = `${program.name}\n${program.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(program);
  }
  return rows;
}

cli({
  site: 'yale',
  name: 'export-postgraduate-courses',
  description: 'Export Yale University postgraduate and professional programs from official Yale sources.',
  access: 'read',
  example: 'webcmd yale export-postgraduate-courses --degree-level masters --count 10 -f csv',
  domain: 'yale.edu',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'degree-level', type: 'string', default: 'all', help: 'all, masters, certificate, diploma, professional, or doctorate' },
    { name: 'count', type: 'int', required: false, help: 'Positive maximum number of programs after filtering and deduplication' },
  ],
  columns: OUTPUT_COLUMNS,
  func: async (args) => {
    const { degreeLevel, count } = parseOptions(args);
    const [gsasProgramsHtml, gsasCertificatesHtml] = await Promise.all([
      fetchHtml(GSAS_PROGRAMS_URL),
      fetchHtml(GSAS_CERTIFICATES_URL),
    ]);
    const programs = dedupe([
      ...parseGsasPrograms(gsasProgramsHtml),
      ...parseGsasCertificates(gsasCertificatesHtml),
      ...professionalRows(),
    ]).filter((program) => degreeLevel === 'all' || program.tags.includes(degreeLevel));
    const selected = await enrichPrograms(count === null ? programs : programs.slice(0, count));
    return selected.map((program) => {
      const row = validateRecord(normalizeRecord(program));
      return CSV_OUTPUT
        ? Object.fromEntries(COLUMNS.map((column, index) => [OUTPUT_COLUMNS[index], row[column]]))
        : row;
    });
  },
});
