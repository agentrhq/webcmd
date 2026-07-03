import { describe, expect, it } from 'vitest';
import { ArgumentError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { createPageMock } from '../test-utils.js';
import { __test__ as utils } from './utils.js';
import { __test__ as status } from './status.js';
import { __test__ as station } from './station.js';
import { __test__ as schedule } from './schedule.js';
import { __test__ as between } from './between.js';

describe('ntes utils', () => {
    it('validates train numbers and station codes', () => {
        expect(utils.requireTrainNumber('12951')).toBe('12951');
        expect(utils.stationInput('MMCT')).toBe('MMCT - MUMBAI CENTRAL');
        expect(utils.parseLimit(5, 'ntes status')).toBe(5);
        expect(() => utils.requireTrainNumber('abc')).toThrow(ArgumentError);
    });
});

describe('ntes commands', () => {
    it('schedule returns station stop rows', async () => {
        const page = createPageMock([{ ok: true }, { ok: true, rows: [{ station: 'MUMBAI CENTRAL', code: 'MMCT', day: '1', arrival: 'SRC', departure: '17:00', halt: '', distanceKm: '0' }] }]);
        const rows = await schedule.command.func(page, { train: '12951', limit: 1 });
        expect(page.goto).toHaveBeenCalledWith('https://enquiry.indianrail.gov.in/mntes/');
        expect(rows[0]).toMatchObject({ rank: 1, trainNumber: '12951', station: 'MUMBAI CENTRAL', code: 'MMCT' });
    });

    it('status returns visible running status rows', async () => {
        const page = createPageMock([{ ok: true }, { ok: true }, { ok: true, rows: [{ station: 'BORIVALI', code: 'BVI', arrival: '17:20 03-Jul', departure: '17:22 03-Jul', status: 'On Time', distanceKm: '30' }] }]);
        const rows = await status.command.func(page, { train: '12951', station: 'MMCT', limit: 1 });
        expect(rows[0]).toMatchObject({ trainNumber: '12951', station: 'BORIVALI', status: 'On Time' });
    });

    it('station returns live station rows', async () => {
        const page = createPageMock([{ ok: true }, { ok: true }, { ok: true, rows: [{ trainNumber: '22961', trainName: 'VANDE BHARAT EXP', arrival: 'Source', departure: '15:45', platform: '4', status: 'On Time' }] }]);
        const rows = await station.command.func(page, { station: 'MMCT', hours: 2, limit: 1 });
        expect(rows[0]).toMatchObject({ rank: 1, station: 'MMCT', trainNumber: '22961' });
    });

    it('between returns trains between two stations', async () => {
        const page = createPageMock([{ ok: true }, { ok: true }, { ok: true, rows: [{ trainNumber: '12951', trainName: 'NDLS TEJAS RAJ', days: 'Daily', type: 'Rajdhani', departTime: '17:00', departStation: 'Mumbai Central', departCode: 'MMCT', duration: '15:32 Hrs.', arriveTime: '08:32', arriveStation: 'New Delhi', arriveCode: 'NDLS', classes: '1A,2A,3A' }] }]);
        const rows = await between.command.func(page, { from: 'MMCT', to: 'NDLS', limit: 1 });
        expect(rows[0]).toMatchObject({ trainNumber: '12951', from: 'MMCT', to: 'NDLS' });
    });

    it('throws EmptyResultError for empty extraction', async () => {
        const page = createPageMock([{ ok: true }, { ok: true }, { ok: true, rows: [] }]);
        await expect(station.command.func(page, { station: 'MMCT', hours: 2, limit: 1 })).rejects.toBeInstanceOf(EmptyResultError);
    });
});
