import { readFile } from 'node:fs/promises';
import path from 'node:path';

const EVENT_ID_PATTERN = /^evt-[A-Za-z0-9_-]+$/;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const QUESTION_TYPES = new Set([
  'text',
  'long-text',
  'dropdown',
  'multi-select',
  'company',
  'checkbox',
  'terms',
  'phone',
  'website',
  'instagram',
  'linkedin',
  'twitter',
  'youtube',
  'github',
  'telegram',
]);
const SELECTABLE_QUESTION_TYPES = new Set(['dropdown', 'multi-select']);
const VISIBILITY_VALUES = new Set(['public', 'private', 'members-only']);

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function requiredText(value, optionName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${optionName} must be non-empty text`);
  }
  return value.trim();
}

function optionalText(value, optionName) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${optionName} must be text`);
  return value.trim() || null;
}

function getArgument(args, camelCaseName, kebabCaseName = camelCaseName) {
  if (hasOwn(args, camelCaseName)) return args[camelCaseName];
  if (hasOwn(args, kebabCaseName)) return args[kebabCaseName];
  return undefined;
}

function validateIsoTimestamp(value, optionName) {
  const text = requiredText(value, optionName);
  const match = ISO_TIMESTAMP_PATTERN.exec(text);
  if (!match) throw new TypeError(`${optionName} must be an ISO-8601 timestamp with a timezone offset`);

  const [, year, month, day, hour, minute, second = '0'] = match;
  const calendarDate = new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second),
  ));
  if (
    calendarDate.getUTCFullYear() !== Number(year)
    || calendarDate.getUTCMonth() !== Number(month) - 1
    || calendarDate.getUTCDate() !== Number(day)
    || calendarDate.getUTCHours() !== Number(hour)
    || calendarDate.getUTCMinutes() !== Number(minute)
    || calendarDate.getUTCSeconds() !== Number(second)
  ) {
    throw new TypeError(`${optionName} must be a valid ISO-8601 timestamp`);
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${optionName} must be a valid ISO-8601 timestamp`);
  return date;
}

function normalizeQuestions(questions, optionName, requireNonEmpty = false, allowNormalizedEmptyOptions = false) {
  if (!Array.isArray(questions) || (requireNonEmpty && questions.length === 0)) {
    throw new TypeError(`${optionName} must be a${requireNonEmpty ? ' non-empty' : 'n'} array`);
  }
  const normalized = questions.map((question, index) => {
    if (
      question
      && typeof question === 'object'
      && !Array.isArray(question)
      && !SELECTABLE_QUESTION_TYPES.has(question.type)
      && allowNormalizedEmptyOptions
      && Array.isArray(question.options)
      && question.options.length === 0
    ) {
      const { options, ...questionWithoutOptions } = question;
      return normalizeQuestion(questionWithoutOptions, index);
    }
    return normalizeQuestion(question, index);
  });
  const labels = new Set();
  for (const question of normalized) {
    const labelKey = question.label.toLocaleLowerCase();
    if (labels.has(labelKey)) throw new TypeError('Question labels must be unique (case-insensitively)');
    labels.add(labelKey);
  }
  return normalized;
}

export function normalizeBoolean(value, optionName) {
  if (value === undefined) return false;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new TypeError(`${optionName} must be true or false`);
}

export function requireConfirmation(value) {
  if (!normalizeBoolean(value, 'confirm')) {
    throw new TypeError('Refusing to continue without --confirm true');
  }
  return true;
}

export function validateEventId(value) {
  const eventId = requiredText(value, 'eventId');
  if (!EVENT_ID_PATTERN.test(eventId)) throw new TypeError('eventId must match the Luma evt-... format');
  return eventId;
}

export function validateTimezone(value) {
  const timezone = requiredText(value, 'timezone');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new TypeError(`timezone is not a recognized IANA timezone: ${timezone}`);
  }
  return timezone;
}

export function validateHttpsUrl(value, optionName) {
  const text = requiredText(value, optionName);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new TypeError(`${optionName} must be a valid HTTPS URL`);
  }
  if (url.protocol !== 'https:' || !url.hostname) {
    throw new TypeError(`${optionName} must be a valid HTTPS URL`);
  }
  return text;
}

export function normalizeCreateEventArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Event arguments must be an object');

  const start = validateIsoTimestamp(getArgument(args, 'start'), 'start');
  const end = validateIsoTimestamp(getArgument(args, 'end'), 'end');
  if (end <= start) throw new TypeError('end must be later than start');

  const location = optionalText(getArgument(args, 'location'), 'location');
  const rawVirtualUrl = getArgument(args, 'virtualUrl', 'virtual-url');
  const virtualUrl = rawVirtualUrl === undefined || rawVirtualUrl === null || rawVirtualUrl === ''
    ? null
    : validateHttpsUrl(rawVirtualUrl, 'virtual-url');
  if (location && virtualUrl) throw new TypeError('location and virtual-url cannot both be supplied');

  const rawCapacity = getArgument(args, 'capacity');
  let capacity = null;
  if (rawCapacity !== undefined && rawCapacity !== null && rawCapacity !== '') {
    if (!(typeof rawCapacity === 'number' || (typeof rawCapacity === 'string' && /^\d+$/.test(rawCapacity)))) {
      throw new TypeError('capacity must be a positive integer');
    }
    capacity = Number(rawCapacity);
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new TypeError('capacity must be a positive integer');
  }

  const rawVisibility = getArgument(args, 'visibility');
  const visibility = rawVisibility === undefined ? 'public' : requiredText(rawVisibility, 'visibility');
  if (!VISIBILITY_VALUES.has(visibility)) throw new TypeError('visibility must be public, private, or members-only');

  const calendar = optionalText(getArgument(args, 'calendar'), 'calendar');
  const rawDescription = getArgument(args, 'description');
  if (rawDescription !== undefined && rawDescription !== null && typeof rawDescription !== 'string') {
    throw new TypeError('description must be text');
  }

  return {
    name: requiredText(getArgument(args, 'name'), 'name'),
    start,
    end,
    timezone: validateTimezone(getArgument(args, 'timezone')),
    calendar,
    description: rawDescription ?? '',
    location,
    virtualUrl,
    visibility,
    capacity,
    requireApproval: normalizeBoolean(getArgument(args, 'requireApproval', 'require-approval'), 'require-approval'),
    confirm: requireConfirmation(getArgument(args, 'confirm')),
  };
}

export function normalizeQuestion(question, index) {
  if (!question || typeof question !== 'object' || Array.isArray(question)) {
    throw new TypeError(`Question ${index + 1} must be an object`);
  }
  const label = requiredText(question.label, `Question ${index + 1} label`);
  const type = requiredText(question.type, `Question ${index + 1} type`);
  if (!QUESTION_TYPES.has(type)) throw new TypeError(`Question ${index + 1} has an unsupported type: ${type}`);

  let options = [];
  if (SELECTABLE_QUESTION_TYPES.has(type)) {
    if (!hasOwn(question, 'options') || !Array.isArray(question.options) || question.options.length === 0) {
      throw new TypeError(`Question ${index + 1} ${type} options must be a non-empty array`);
    }
    const optionValues = new Set();
    options = question.options.map((option) => {
      const value = requiredText(option, `Question ${index + 1} option`);
      if (optionValues.has(value)) throw new TypeError(`Question ${index + 1} options must be unique`);
      optionValues.add(value);
      return value;
    });
  } else if (hasOwn(question, 'options')) {
    throw new TypeError(`Question ${index + 1} type ${type} does not accept options`);
  }

  return {
    label,
    type,
    required: normalizeBoolean(question.required, `Question ${index + 1} required`),
    options,
  };
}

export function parseQuestionsJson(text) {
  if (typeof text !== 'string') throw new TypeError('Questions document must be JSON text');
  let questions;
  try {
    questions = JSON.parse(text);
  } catch {
    throw new TypeError('Questions document must be valid JSON');
  }
  return normalizeQuestions(questions, 'Questions document', true);
}

export async function loadQuestionsFile(filePath, cwd = process.cwd()) {
  const resolvedPath = path.resolve(cwd, filePath);
  let text;
  try {
    text = await readFile(resolvedPath, 'utf8');
  } catch {
    throw new TypeError(`Could not read questions file: ${resolvedPath}`);
  }
  return parseQuestionsJson(text);
}

export function mergeQuestions(existing, incoming, mode) {
  const normalizedExisting = normalizeQuestions(existing, 'Existing questions', false, true);
  const normalizedIncoming = normalizeQuestions(incoming, 'Incoming questions');
  if (mode === 'replace') return normalizedIncoming;
  if (mode !== 'append') throw new TypeError('mode must be append or replace');

  const existingLabels = new Set(normalizedExisting.map((question) => question.label.toLocaleLowerCase()));
  for (const question of normalizedIncoming) {
    if (existingLabels.has(question.label.toLocaleLowerCase())) {
      throw new TypeError(`Question label already exists: ${question.label}`);
    }
  }
  return [...normalizedExisting, ...normalizedIncoming];
}
