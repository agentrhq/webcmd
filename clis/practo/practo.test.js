import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import './appointment.js';
import './appointments.js';
import './book-confirm.js';
import './book-preview.js';
import './booking-link.js';
import './cancel.js';
import './contact.js';
import './login.js';
import './profile.js';
import './search.js';
import './slots.js';
import './whoami.js';
import { __test__ } from './utils.js';

const {
  buildSearchUrl,
  buildBookingUrl,
  normalizeConfirm,
  normalizeLimit,
  normalizePracticeDoctorId,
  normalizeSlotTime,
  rowsFromSearchState,
  rowsFromSlotsPayload,
} = __test__;

describe('practo helpers', () => {
  it('builds city/specialty search URLs', () => {
    expect(buildSearchUrl({ city: 'Bangalore', specialty: 'Orthopedist' })).toBe('https://www.practo.com/bangalore/orthopedist');
    expect(buildSearchUrl({ city: 'New Delhi', specialty: 'Dentist', locality: 'South Extension' })).toBe('https://www.practo.com/new-delhi/dentist/south-extension');
  });

  it('validates identity, limits, slot times, and confirmations', () => {
    expect(normalizePracticeDoctorId('859054')).toBe('859054');
    expect(normalizeLimit('3')).toBe(3);
    expect(normalizeSlotTime('2026-07-10 10:30:00')).toBe('2026-07-10 10:30:00');
    expect(normalizeConfirm(true)).toBe(true);
    expect(normalizeConfirm('true')).toBe(true);
    expect(() => normalizePracticeDoctorId('abc')).toThrow(ArgumentError);
    expect(() => normalizeLimit(0)).toThrow(ArgumentError);
    expect(() => normalizeSlotTime('tomorrow')).toThrow(ArgumentError);
  });

  it('maps listing redux doctors into stable search rows', () => {
    const rows = rowsFromSearchState({
      listingV2: {
        doctors: {
          entities: {
            1: {
              id: 859054,
              doctor_id: 1056089,
              practice_id: 776696,
              doctor_name: 'Dr. Nithin Patel',
              specialization: 'Orthopedist',
              experience_years: 12,
              locality: 'Koramangala',
              city: 'Bangalore',
              practice: { name: 'Practo Clinic' },
              consultation_fees: 1000,
              profile_url: '/bangalore/doctor/dr-nithin-patel-orthopedist',
              next_available_timestamp: '2026-07-10T10:30:00+05:30',
            },
          },
        },
      },
    }, 1);
    expect(rows).toEqual([{
      rank: 1,
      practice_doctor_id: '859054',
      doctor_id: '1056089',
      practice_id: '776696',
      name: 'Dr. Nithin Patel',
      specialty: 'Orthopedist',
      experience_years: 12,
      locality: 'Koramangala',
      city: 'Bangalore',
      clinic: 'Practo Clinic',
      fee: 1000,
      next_available: '2026-07-10T10:30:00+05:30',
      profile_url: 'https://www.practo.com/bangalore/doctor/dr-nithin-patel-orthopedist',
    }]);
  });

  it('maps slot payloads into rows and booking URLs', () => {
    const rows = rowsFromSlotsPayload({
      practice_doctor_id: 859054,
      amount: 1000,
      prepaid: false,
      appointment_token: 'abc',
      slots: [{
        datestamp: '2026-07-10',
        slots: [{ time: '10:00', timeslots: [{ ts: '2026-07-10 10:30:00', available: true }] }],
      }],
    });
    expect(rows).toEqual([{
      practice_doctor_id: '859054',
      time: '2026-07-10 10:30:00',
      available: true,
      amount: 1000,
      prepaid: false,
      appointment_token: 'abc',
    }]);
    expect(buildBookingUrl({ practiceDoctorId: '859054', slotTime: rows[0].time, appointmentToken: 'abc', amount: 1000, prepaid: false }))
      .toContain('/appointment/doctor/859054/book?');
  });
});

describe('practo command registry', () => {
  it('registers the approved command surface', () => {
    for (const name of ['whoami', 'login', 'search', 'profile', 'slots', 'contact', 'booking-link', 'appointments', 'appointment', 'book-preview', 'book-confirm', 'cancel']) {
      expect(getRegistry().get(`practo/${name}`)).toBeDefined();
    }
    expect(getRegistry().get('practo/auth-status')).toBe(getRegistry().get('practo/whoami'));
  });

  it('marks writes as explicit confirm commands', () => {
    const book = getRegistry().get('practo/book-confirm');
    const cancel = getRegistry().get('practo/cancel');
    expect(book.access).toBe('write');
    expect(cancel.access).toBe('write');
    expect(book.args.find((arg) => arg.name === 'confirm')?.type).toBe('boolean');
    expect(cancel.args.find((arg) => arg.name === 'confirm')?.type).toBe('boolean');
  });

  it('waits for manual login to complete', async () => {
    const login = getRegistry().get('practo/login');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce({ __error: 'HTTP 401', status: 401 })
        .mockResolvedValueOnce({ name: 'Ada' }),
    };

    await expect(login.func(page, { timeout: 1 })).resolves.toEqual([{
      status: 'login_complete',
      logged_in: true,
      site: 'practo',
      name: 'Ada',
    }]);
  });

  it('refuses real booking without --confirm true', async () => {
    const book = getRegistry().get('practo/book-confirm');
    await expect(book.func({}, { practice_doctor_id: '859054', time: '2026-07-10 10:30:00' })).rejects.toThrow(ArgumentError);
  });

  it('refuses cancellation without --confirm true', async () => {
    const cancel = getRegistry().get('practo/cancel');
    await expect(cancel.func({}, { appointment_id: 'abc' })).rejects.toThrow(ArgumentError);
  });
});
