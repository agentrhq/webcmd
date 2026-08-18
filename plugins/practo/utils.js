import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const SLOT_TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
export const PRACTO = 'https://www.practo.com';
export const DRIVE = 'https://drive.practo.com';

export function slugifyPathPart(value, label) {
  const out = String(value ?? '').trim().toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!out) throw new ArgumentError(`${label} is required`);
  return out;
}

export function normalizeLimit(value, defaultValue = 10, max = 25) {
  const n = Number(value ?? defaultValue);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new ArgumentError(`limit must be an integer from 1 to ${max}`);
  }
  return n;
}

export function normalizePracticeDoctorId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d+$/.test(id)) {
    throw new ArgumentError('practice_doctor_id must be numeric', 'Use `webcmd practo search ...` or `webcmd practo slots <practice_doctor_id>` first.');
  }
  return id;
}

export function normalizeAppointmentId(value) {
  const id = String(value ?? '').trim();
  if (!id) throw new ArgumentError('appointment_id is required');
  return id;
}

export function normalizeSlotTime(value) {
  const raw = String(value ?? '').trim();
  if (!SLOT_TIME_RE.test(raw)) {
    throw new ArgumentError('time must be YYYY-MM-DD HH:mm:ss', 'Example: --time "2026-07-10 10:30:00"');
  }
  return raw;
}

export function normalizeConfirm(value) {
  return value === true || value === 'true';
}

export function unwrapBrowserResult(value) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data') && Object.prototype.hasOwnProperty.call(value, 'session')) {
    return value.data;
  }
  return value;
}

export async function evalJson(page, url, init = {}) {
  const result = unwrapBrowserResult(await page.evaluate(`(async () => {
    try {
      const res = await fetch(${JSON.stringify(url)}, {
        credentials: 'include',
        method: ${JSON.stringify(init.method || 'GET')},
        headers: ${JSON.stringify(init.headers || { Accept: 'application/json' })},
        body: ${init.body == null ? 'undefined' : JSON.stringify(init.body)}
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { text }; }
      if (!res.ok) return { __error: 'HTTP ' + res.status, status: res.status, data };
      return data;
    } catch (e) {
      return { __error: String(e && e.message || e) };
    }
  })()`));
  return assertJsonOk(result, url);
}

export async function practoJson(page, pathOrUrl) {
  await page.goto(PRACTO);
  return evalJson(page, pathOrUrl.startsWith('http') ? pathOrUrl : `${PRACTO}${pathOrUrl}`);
}

export async function driveJson(page, path, init = {}) {
  await page.goto(`${DRIVE}/appointments`);
  return evalJson(page, `${DRIVE}${path}`, init);
}

function displayName(user) {
  return String(user?.name || user?.user?.name || user?.profile?.name || user?.logged_in_user?.name || '').trim();
}

export async function probeIdentity(page) {
  let user;
  try {
    user = await practoJson(page, '/logged_in_user');
  } catch (error) {
    if (/HTTP 401|HTTP 403/.test(error?.message || '')) {
      throw new AuthRequiredError('www.practo.com', 'Practo /logged_in_user rejected the current browser session');
    }
    throw error;
  }
  if (!user || user.__error) throw new AuthRequiredError('www.practo.com');
  return [{ logged_in: true, site: 'practo', name: displayName(user) }];
}

export function buildSearchUrl({ city, specialty, locality }) {
  const parts = [
    'https://www.practo.com',
    slugifyPathPart(city, 'city'),
    slugifyPathPart(specialty, 'specialty'),
  ];
  if (String(locality ?? '').trim()) parts.push(slugifyPathPart(locality, 'locality'));
  return parts.join('/');
}

export function buildSlotsUrl(practiceDoctorId) {
  return `https://www.practo.com/health/api/practicedoctors/${normalizePracticeDoctorId(practiceDoctorId)}/slots?mobile=true&group_by_hour=true&logged_in_api=false&first_available=true&`;
}

export async function rowsForSlots(page, practiceDoctorId) {
  const payload = await practoJson(page, buildSlotsUrl(practiceDoctorId));
  const rows = rowsFromSlotsPayload(payload);
  if (rows.length === 0) throw new EmptyResultError('practo slots', 'No available slots were returned for that practice_doctor_id.');
  return rows;
}

function slugFromProfileUrl(profileUrl) {
  const raw = text(profileUrl);
  if (!raw) return 'doctor';
  try {
    const url = new URL(raw, 'https://www.practo.com');
    const parts = url.pathname.split('/').filter(Boolean);
    const doctorIndex = parts.indexOf('doctor');
    return doctorIndex >= 0 && parts[doctorIndex + 1] ? parts[doctorIndex + 1] : 'doctor';
  } catch {
    return 'doctor';
  }
}

export function buildBookingUrl({ practiceDoctorId, slotTime, appointmentToken = '', amount = '', prepaid = false, profileUrl = '' }) {
  const params = new URLSearchParams();
  params.set('type', 'abs');
  params.set('doctor_id', normalizePracticeDoctorId(practiceDoctorId));
  params.set('appointment_time', normalizeSlotTime(slotTime));
  if (appointmentToken) params.set('appointment_token', String(appointmentToken));
  params.set('prepaid', String(Boolean(prepaid)));
  if (amount !== '' && amount != null) params.set('amount', String(amount));
  return `https://www.practo.com/appointment/${slugFromProfileUrl(profileUrl)}/${practiceDoctorId}/book?${params.toString()}`;
}

export function bookingPreviewFromPageData(data, context) {
  const text = String(data?.text || '');
  const confirmText = data?.confirmText || '';
  const paymentMode = context.paymentMode || data?.paymentMode || (/pay at clinic/i.test(text) ? 'Pay At Clinic' : '');
  return [{
    practice_doctor_id: context.practiceDoctorId,
    time: context.slotTime,
    amount: context.amount,
    prepaid: context.prepaid,
    payment_mode: paymentMode,
    requires_payment: Boolean(paymentMode && !/pay at clinic/i.test(paymentMode)),
    confirm_button: confirmText,
    booking_url: context.url,
  }];
}

export async function prepareBookingPage(page, kwargs) {
  const practiceDoctorId = normalizePracticeDoctorId(kwargs.practice_doctor_id ?? kwargs.practiceDoctorId);
  const slotTime = normalizeSlotTime(kwargs.time);
  const slots = await rowsForSlots(page, practiceDoctorId);
  const slot = findSlot(slots, slotTime);
  let paymentMode = '';
  try {
    const summary = await practoJson(page, `/health/api/appointment/payment/summary?appointment_type=abs&platform=web&practice_doctor_id=${practiceDoctorId}`);
    const modes = summary?.payment_mode_details || summary?.data?.payment_mode_details || [];
    paymentMode = String(modes?.[0]?.mode || modes?.[0]?.payment_mode || '').trim();
  } catch {
    paymentMode = '';
  }
  const url = buildBookingUrl({
    practiceDoctorId,
    slotTime,
    appointmentToken: slot.appointment_token,
    amount: slot.amount,
    prepaid: slot.prepaid,
    profileUrl: kwargs['profile-url'] ?? kwargs.profile_url ?? kwargs.profileUrl,
  });
  await page.goto(url);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const readyNow = unwrapBrowserResult(await page.evaluate(`(() => /Confirm Clinic Visit|Enter your mobile number|sign in|login/i.test(document.body?.innerText || ''))()`));
    if (readyNow) {
      ready = true;
      break;
    }
    await page.wait(0.5);
  }
  const data = unwrapBrowserResult(await page.evaluate(`(() => {
    const text = document.body?.innerText || '';
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
      .map((el) => (el.innerText || el.value || el.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter(Boolean);
    return {
      url: location.href,
      text,
      buttons,
      confirmText: buttons.find((label) => /confirm clinic visit|confirm/i.test(label)) || '',
      paymentMode: (/pay at clinic/i.test(text) && 'Pay At Clinic') || (/pay online/i.test(text) && 'Pay Online') || ''
    };
  })()`));
  if (/enter your mobile number|login|sign in/i.test(String(data?.text || ''))) {
    throw new AuthRequiredError('www.practo.com', 'Booking page requires a logged-in Practo session');
  }
  if (!ready || !data?.confirmText) {
    throw new CommandExecutionError(
      `Practo booking page did not expose a confirm button at ${data?.url || 'unknown URL'}`,
      'Pass --profile-url from `webcmd practo search ...` so the adapter can build Practo\'s canonical booking URL.',
    );
  }
  return { slot, data, context: { practiceDoctorId, slotTime, amount: slot.amount, prepaid: slot.prepaid, paymentMode, url } };
}

export async function submitBookingPage(page) {
  const result = unwrapBrowserResult(await page.evaluate(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
    const button = buttons.find((el) => /confirm clinic visit|confirm/i.test(el.innerText || el.value || el.textContent || ''));
    if (!button) return { ok: false, message: 'Confirm Clinic Visit button not found' };
    button.click();
    await sleep(3000);
    return { ok: true, url: location.href, text: document.body?.innerText || '' };
  })()`));
  if (!result?.ok) throw new CommandExecutionError(result?.message || 'Failed to click Practo confirmation button');
  return result;
}

export async function cancelAppointment(page, appointmentId) {
  await page.goto(`${DRIVE}/appointments`);
  const result = unwrapBrowserResult(await page.evaluate(`(async () => {
    const token = decodeURIComponent((document.cookie.split('; ').find((c) => c.startsWith('X-Genesis-Token=')) || '').split('=')[1] || '');
    if (!token) return { ok: false, message: 'X-Genesis-Token cookie missing' };
    const res = await fetch(${JSON.stringify(`${DRIVE}/api/record/v2/cancel_appointment/${appointmentId}`)}, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'X-Genesis-Token': token }
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  })()`));
  if (!result?.ok) {
    if (result?.status === 401 || result?.status === 403) throw new AuthRequiredError('drive.practo.com', `Practo Drive cancel returned HTTP ${result.status}`);
    throw new CommandExecutionError(`Practo cancel failed: ${result?.message || result?.status || 'unknown'}`);
  }
}

function text(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    return text(firstDefined(value.name, value.practice_name, value.establishment_name, value.clinic_name, value.locality));
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function asAbsPractoUrl(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    return new URL(raw, 'https://www.practo.com').toString();
  } catch {
    return raw;
  }
}

function doctorsFromState(state) {
  const doctors = state?.listingV2?.doctors?.entities ?? state?.doctors?.entities ?? state?.doctors;
  if (Array.isArray(doctors)) return doctors;
  if (doctors && typeof doctors === 'object') return Object.values(doctors);
  return [];
}

export function rowsFromSearchState(state, limit = 10) {
  return doctorsFromState(state).slice(0, limit).map((doctor, i) => {
    const practiceDoctorId = firstDefined(doctor.practice_doctor_id, doctor.relation_id, doctor.id);
    const name = firstDefined(doctor.doctor_name, doctor.name, doctor.display_name);
    if (!practiceDoctorId || !name) return null;
    return {
      rank: i + 1,
      practice_doctor_id: String(practiceDoctorId),
      doctor_id: text(firstDefined(doctor.doctor_id, doctor.provider_id)),
      practice_id: text(firstDefined(doctor.practice_id, doctor.establishment_id)),
      name: text(name),
      specialty: text(firstDefined(doctor.specialization, doctor.speciality, doctor.specialty)),
      experience_years: firstDefined(doctor.experience_years, doctor.experience),
      locality: text(firstDefined(doctor.locality, doctor.locality_name)),
      city: text(doctor.city),
      clinic: text(firstDefined(doctor.practice, doctor.practice_name, doctor.clinic_name)),
      fee: firstDefined(doctor.consultation_fees, doctor.fees, doctor.fee),
      next_available: text(firstDefined(doctor.next_available_timestamp, doctor.next_available, doctor.first_available_day_slots?.[0]?.time)),
      profile_url: asAbsPractoUrl(firstDefined(doctor.profile_url, doctor.url, doctor.translated_new_slug)),
    };
  }).filter(Boolean);
}

function flattenSlots(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) flattenSlots(item, out);
    return out;
  }
  if (typeof value !== 'object') return out;
  const time = firstDefined(value.ts, value.start_time, value.appointment_time, value.slot_time);
  if (time) out.push(value);
  else if (value.time && !value.timeslots && !value.slots) out.push(value);
  for (const key of ['timeslots', 'slots', 'items', 'available_slots', 'hour_slots']) {
    if (value[key]) flattenSlots(value[key], out);
  }
  return out;
}

export function rowsFromSlotsPayload(payload) {
  const data = payload?.data ?? payload;
  const practiceDoctorId = text(firstDefined(data?.practice_doctor_id, data?.practiceDoctorId));
  const amount = firstDefined(data?.amount, data?.appointment_payment_details?.amount, data?.fee);
  const prepaid = Boolean(firstDefined(data?.prepaid, data?.appointment_payment_details?.prepaid, false));
  const appointmentToken = text(firstDefined(data?.appointment_token, data?.appointmentToken));
  return flattenSlots(data?.slots ?? data).map((slot) => ({
    practice_doctor_id: text(firstDefined(slot.practice_doctor_id, practiceDoctorId)),
    time: text(firstDefined(slot.ts, slot.time, slot.start_time, slot.appointment_time, slot.slot_time)),
    available: firstDefined(slot.available, slot.is_available, true) !== false,
    amount: firstDefined(slot.amount, amount),
    prepaid: Boolean(firstDefined(slot.prepaid, prepaid)),
    appointment_token: text(firstDefined(slot.appointment_token, appointmentToken)),
  })).filter((row) => row.practice_doctor_id && row.time);
}

export function findSlot(slots, slotTime) {
  const wanted = normalizeSlotTime(slotTime);
  const slot = slots.find((row) => row.time === wanted);
  if (!slot) {
    throw new EmptyResultError('practo slots', `No Practo slot matched ${wanted}. Run \`webcmd practo slots <practice_doctor_id>\` first.`);
  }
  if (slot.available === false) {
    throw new EmptyResultError('practo slots', `Practo slot ${wanted} is not available.`);
  }
  return slot;
}

export function assertJsonOk(result, label) {
  if (!result || typeof result !== 'object') {
    throw new CommandExecutionError(`${label} returned no data`);
  }
  if (result.__error) {
    throw new CommandExecutionError(`${label} failed: ${result.__error}`);
  }
  return result;
}

export const __test__ = {
  buildSearchUrl,
  buildSlotsUrl,
  buildBookingUrl,
  normalizeConfirm,
  normalizeLimit,
  normalizePracticeDoctorId,
  normalizeAppointmentId,
  normalizeSlotTime,
  rowsFromSearchState,
  rowsFromSlotsPayload,
  findSlot,
};
