import { test, afterAll as after } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import {
  parseVideoId,
  parseSamplingOptions,
  selectPositions,
  formatMilliseconds,
} from '../frames-core.js';

const originalCacheDir = process.env.WEBCMD_CACHE_DIR;
const testCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcmd-youtube-frames-test-'));
process.env.WEBCMD_CACHE_DIR = testCacheDir;
after(async () => {
  if (originalCacheDir === undefined) delete process.env.WEBCMD_CACHE_DIR;
  else process.env.WEBCMD_CACHE_DIR = originalCacheDir;
  await fs.rm(testCacheDir, { recursive: true, force: true });
});

function mockPage(states = [], cdpResults = []) {
  const calls = [];
  let index = 0;
  let cdpIndex = 0;
  return {
    calls,
    goto: async (url, options) => calls.push(['goto', url, options]),
    wait: async (seconds) => calls.push(['wait', seconds]),
    evaluate: async (script) => {
      calls.push(['evaluate', script]);
      return states[Math.min(index++, states.length - 1)];
    },
    cdp: async (method, params) => {
      calls.push(['cdp', method, params]);
      const result = cdpResults[cdpIndex++];
      if (result instanceof Error) throw result;
      return result ?? { data: Buffer.from('png').toString('base64') };
    },
    screenshot: async () => {
      throw new Error('full-page screenshot fallback is forbidden');
    },
  };
}

function captureStates(duration, actualTimes) {
  const content = {
    videoId: 'HQqX4rF1nDM', duration, readyState: 4,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: 'OK', playabilityReason: '',
    rect: { x: 10, y: 20, width: 640, height: 360 },
  };
  return [
    content,
    ...actualTimes.flatMap((actualTime) => [
      content,
      { actualTime, rect: { x: 10, y: 20, width: 640, height: 360, scale: 1 } },
      content,
      true,
      true,
    ]),
  ];
}

function seekScriptHarness({
  activeVideoId = 'HQqX4rF1nDM',
  currentTime = 0,
  readyState = 4,
  rects = [{ x: 10, y: 20, width: 640, height: 360 }],
  emitSeeked = true,
  clockStep = 0,
} = {}) {
  const assignedTimes = [];
  const addedListeners = [];
  const removedListeners = [];
  const listeners = new Map();
  const timers = new Set();
  let clearedTimers = 0;
  let pauseCalls = 0;
  let scrollCalls = 0;
  let rectIndex = 0;
  let now = 0;
  let storedCurrentTime = currentTime;

  const emit = (name) => {
    const entry = listeners.get(name);
    if (!entry) return;
    if (entry.once) listeners.delete(name);
    entry.handler();
  };
  const video = {
    readyState,
    muted: false,
    pause() { pauseCalls += 1; },
    scrollIntoView() { scrollCalls += 1; },
    getBoundingClientRect() {
      return rects[Math.min(rectIndex++, rects.length - 1)];
    },
    addEventListener(name, handler, options) {
      addedListeners.push(name);
      listeners.set(name, { handler, once: Boolean(options?.once) });
    },
    removeEventListener(name, handler) {
      removedListeners.push(name);
      if (listeners.get(name)?.handler === handler) listeners.delete(name);
    },
  };
  Object.defineProperty(video, 'currentTime', {
    get: () => storedCurrentTime,
    set: (value) => {
      assignedTimes.push(value);
      storedCurrentTime = value;
      if (emitSeeked) queueMicrotask(() => emit('seeked'));
    },
  });

  const context = {
    URL,
    location: { href: `https://www.youtube.com/watch?v=${activeVideoId}` },
    document: { querySelectorAll: () => [video] },
    Date: { now: () => { now += clockStep; return now; } },
    requestAnimationFrame: (callback) => { callback(); return 1; },
    setTimeout: (callback, delay) => {
      const token = { callback, delay };
      timers.add(token);
      return token;
    },
    clearTimeout: (token) => {
      if (timers.delete(token)) clearedTimers += 1;
    },
  };
  return {
    page: {
      evaluate: async (script) => JSON.parse(JSON.stringify(await runInNewContext(script, context))),
    },
    video,
    assignedTimes,
    addedListeners,
    removedListeners,
    get activeListenerCount() { return listeners.size; },
    get activeTimerCount() { return timers.size; },
    get clearedTimerCount() { return clearedTimers; },
    get pauseCalls() { return pauseCalls; },
    get scrollCalls() { return scrollCalls; },
    emit,
    fireTimer(delay) {
      const timer = [...timers].find((entry) => entry.delay === delay);
      assert.ok(timer, `expected active ${delay}ms timer`);
      timer.callback();
    },
  };
}

function playerStateHarness({
  activeVideoId = 'HQqX4rF1nDM',
  duration = 120,
  isLive = false,
  activeMembersBadge = false,
  responseVideoId = activeVideoId,
  playabilityStatus = 'OK',
  playabilityReason = '',
  documentHtml = '',
  liveBadgePresent = false,
} = {}) {
  const rect = { x: 10, y: 20, width: 640, height: 360 };
  const memberBadge = activeMembersBadge ? { textContent: 'Members only' } : null;
  const playerResponse = {
    videoDetails: { videoId: responseVideoId, isLiveContent: isLive },
    playabilityStatus: { status: playabilityStatus, reason: playabilityReason },
  };
  const player = {
    classList: { contains: () => false },
    getPlayerResponse: () => playerResponse,
    querySelector: () => memberBadge,
  };
  const video = {
    duration: isLive ? Infinity : duration,
    readyState: 4,
    getBoundingClientRect: () => rect,
    closest: () => player,
  };
  const context = {
    URL,
    location: {
      href: activeVideoId
        ? `https://www.youtube.com/watch?v=${activeVideoId}`
        : 'https://www.youtube.com/watch',
    },
    document: {
      documentElement: { innerHTML: documentHtml },
      querySelectorAll: (selector) => selector === 'video' ? [video] : [],
      querySelector: (selector) => selector.includes('ytp-live-badge') && (isLive || liveBadgePresent)
        ? { hidden: false }
        : null,
    },
    ytInitialPlayerResponse: playerResponse,
  };
  return {
    page: {
      evaluate: async (script) => JSON.parse(JSON.stringify(await runInNewContext(script, context))),
    },
  };
}

function overlayScriptHarness() {
  const keep = {
    style: { visibility: '' },
    isConnected: true,
    contains: (candidate) => candidate === video,
  };
  const overlay = {
    style: { visibility: 'collapse' },
    isConnected: true,
    contains: () => false,
  };
  const player = { children: [keep, overlay] };
  const video = {
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 640, height: 360 }),
    closest: () => player,
  };
  const context = {
    document: { querySelectorAll: (selector) => selector === 'video' ? [video] : [] },
  };
  return {
    page: { evaluate: async (script) => runInNewContext(script, context) },
    context,
    keep,
    overlay,
    player,
  };
}

function assertSeekResourcesClean(harness, expectedLifecycle = true) {
  assert.equal(harness.activeListenerCount, 0);
  assert.equal(harness.activeTimerCount, 0);
  if (expectedLifecycle) {
    assert.deepEqual(harness.addedListeners, ['seeked', 'error']);
    assert.deepEqual(harness.removedListeners, ['seeked', 'error']);
    assert.equal(harness.clearedTimerCount, 1);
  }
}

function assertOverlayIsolationAroundEveryCapture(page, expectedCaptures) {
  const events = page.calls.flatMap((call, index) => {
    if (call[0] === 'cdp') return [{ type: 'capture', index }];
    if (call[0] !== 'evaluate') return [];
    if (call[1].includes('__webcmdYoutubeFrameHidden =')) return [{ type: 'hide', index }];
    if (call[1].includes('delete globalThis.__webcmdYoutubeFrameHidden')) {
      return [{ type: 'restore', index }];
    }
    return [];
  });
  assert.equal(events.filter(({ type }) => type === 'hide').length, expectedCaptures);
  assert.equal(events.filter(({ type }) => type === 'capture').length, expectedCaptures);
  assert.equal(events.filter(({ type }) => type === 'restore').length, expectedCaptures);
  assert.deepEqual(
    events.map(({ type }) => type),
    Array.from({ length: expectedCaptures }, () => ['hide', 'capture', 'restore']).flat(),
  );
  assert.equal(events.every(({ index }) => index >= 0), true);
}

test('parseVideoId accepts watch URLs, Shorts URLs, and bare IDs', () => {
  assert.equal(parseVideoId('https://www.youtube.com/watch?v=HQqX4rF1nDM'), 'HQqX4rF1nDM');
  assert.equal(parseVideoId('https://youtu.be/HQqX4rF1nDM?t=30'), 'HQqX4rF1nDM');
  assert.equal(parseVideoId('https://www.youtube.com/shorts/HQqX4rF1nDM'), 'HQqX4rF1nDM');
  assert.equal(parseVideoId('HQqX4rF1nDM'), 'HQqX4rF1nDM');
});

test('parseVideoId rejects missing and malformed IDs', () => {
  for (const value of ['', 'https://example.com/watch?v=HQqX4rF1nDM', 'not an id']) {
    assert.throws(() => parseVideoId(value), /YouTube video/i);
  }
});

test('sampling defaults to count five and rejects combined modes', () => {
  assert.deepEqual(parseSamplingOptions({}), { mode: 'count', count: 5, requestedCount: 5 });
  assert.throws(
    () => parseSamplingOptions({ timestamps: '30,90', count: 5 }),
    /mutually exclusive/i,
  );
});

test('timestamps become ascending unique finite positions', () => {
  assert.deepEqual(
    parseSamplingOptions({ timestamps: '90,30,30,150' }),
    { mode: 'timestamps', positions: [30, 90, 150], requestedCount: 4 },
  );
  for (const timestamps of ['', '30,,90', '-1,30', 'NaN,30', 'Infinity']) {
    assert.throws(() => parseSamplingOptions({ timestamps }), /timestamp/i);
  }
});

test('count accepts only integers from one through twenty', () => {
  for (const count of [0, 21, 1.5, 'abc']) {
    assert.throws(() => parseSamplingOptions({ count }), /count/i);
  }
});

test('automatic sampling uses midpoint or inclusive ten-to-ninety-percent span', () => {
  assert.deepEqual(selectPositions({ mode: 'count', count: 1 }, 120), [60]);
  assert.deepEqual(selectPositions({ mode: 'count', count: 2 }, 120), [12, 108]);
  assert.deepEqual(selectPositions({ mode: 'count', count: 5 }, 600), [60, 180, 300, 420, 540]);
});

test('explicit positions must be strictly inside duration', () => {
  assert.deepEqual(
    selectPositions({ mode: 'timestamps', positions: [0, 30, 90] }, 120),
    [0, 30, 90],
  );
  assert.throws(
    () => selectPositions({ mode: 'timestamps', positions: [30, 120] }, 120),
    /less than.*duration/i,
  );
});

test('explicit positions reject negative and non-finite direct-call values', () => {
  for (const position of [-1, NaN, Infinity]) {
    assert.throws(
      () => selectPositions({ mode: 'timestamps', positions: [position] }, 120),
      /finite non-negative/i,
    );
  }
});

test('artifact timestamp formatting is deterministic', () => {
  assert.equal(formatMilliseconds(30), '030000');
  assert.equal(formatMilliseconds(1.25), '001250');
});

const {
  readPlayerState,
  hidePlayerOverlays,
  restorePlayerOverlays,
  seekVideo,
  waitForFiniteVodState,
  waitForRequestedContent,
} = await import('../frames.js');

test('youtube frames registers the exact read-only command contract', () => {
  const command = getRegistry().get('youtube/frames');
  assert.ok(command);
  assert.equal(command.access, 'read');
  assert.equal(command.browser, true);
  assert.equal(command.siteSession, 'ephemeral');
  assert.deepEqual(command.args.map((arg) => arg.name), ['url', 'timestamps', 'count', 'output']);
  assert.deepEqual(command.columns, [
    'video_id', 'duration_seconds', 'timestamp_seconds', 'actual_timestamp_seconds',
    'path', 'status', 'error', 'requested_count', 'selected_count',
    'captured_count', 'failed_count',
  ]);
});

test('youtube frames disables framework pre-navigation so arguments validate first', () => {
  const command = getRegistry().get('youtube/frames');
  assert.equal(command.navigateBefore, false);
});

test('combined sampling flags fail before browser navigation', async () => {
  const command = getRegistry().get('youtube/frames');
  let navigated = false;
  const page = { goto: async () => { navigated = true; } };
  await assert.rejects(
    () => command.func(page, {
      url: 'HQqX4rF1nDM', timestamps: '30,90', count: 5,
    }),
    /mutually exclusive/i,
  );
  assert.equal(navigated, false);
});

test('navigation failures become actionable structured command errors', async () => {
  const command = getRegistry().get('youtube/frames');
  const page = {
    goto: async () => {
      throw new Error('page.goto: Target page, context or browser has been closed');
    },
  };
  await assert.rejects(
    () => command.func(page, { url: 'HQqX4rF1nDM', count: 1 }),
    (error) => error instanceof CommandExecutionError
      && /Target page, context or browser has been closed/.test(error.message)
      && /restart.*browser|browser.*retry/i.test(error.hint || ''),
  );
});

test('player state requires a non-empty exact active video ID', async () => {
  await assert.rejects(
    () => readPlayerState(playerStateHarness({ activeVideoId: '' }).page, 'HQqX4rF1nDM'),
    /requested video.*active video/i,
  );
});

test('player state ignores unrelated document membership markup', async () => {
  const state = await readPlayerState(playerStateHarness({
    documentHtml: '<script>BADGE_STYLE_TYPE_MEMBERS_ONLY</script>',
  }).page, 'HQqX4rF1nDM');
  assert.equal(state.membersOnly, false);
});

test('player state rejects members-only evidence from the active player', async () => {
  await assert.rejects(
    () => readPlayerState(playerStateHarness({ activeMembersBadge: true }).page, 'HQqX4rF1nDM'),
    /members-only/i,
  );
});

test('an inactive live badge in normal VOD markup does not classify the video as live', async () => {
  const state = await readPlayerState(playerStateHarness({
    duration: 434,
    isLive: false,
    liveBadgePresent: true,
  }).page, 'HQqX4rF1nDM');
  assert.equal(state.isLive, false);
  assert.equal(state.duration, 434);
});

test('stale active video never produces frame evidence', async () => {
  const command = getRegistry().get('youtube/frames');
  const page = mockPage([{
    videoId: 'aaaaaaaaaaa', duration: 120, readyState: 4,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: 'OK', playabilityReason: '',
    rect: { x: 0, y: 0, width: 640, height: 360 },
  }]);
  await assert.rejects(
    () => command.func(page, { url: 'HQqX4rF1nDM', count: 1 }),
    /requested video.*active video/i,
  );
  assert.deepEqual(page.calls[0], [
    'goto',
    'https://www.youtube.com/watch?v=HQqX4rF1nDM',
    { waitUntil: 'none' },
  ]);
  assert.equal(page.calls[1][0], 'evaluate');
  assert.equal(
    page.calls.some((call) => call[0] === 'wait' && call[1] === 3),
    false,
  );
  assert.equal(page.calls.some((call) => call[0] === 'cdp'), false);
});

test('live or non-finite video duration is rejected before screenshot', async () => {
  const command = getRegistry().get('youtube/frames');
  const page = mockPage([{
    videoId: 'HQqX4rF1nDM', duration: null, readyState: 4,
    adShowing: false, canSkipAd: false, errorText: '', isLive: true,
    membersOnly: false, playabilityStatus: 'OK', playabilityReason: '',
    rect: { x: 0, y: 0, width: 640, height: 360 },
  }]);
  await assert.rejects(
    () => command.func(page, { url: 'HQqX4rF1nDM', count: 1 }),
    /live|finite duration/i,
  );
  assert.equal(
    page.calls.some((call) => call[0] === 'wait' && call[1] === 0.25),
    false,
  );
  assert.equal(page.calls.some((call) => call[0] === 'cdp'), false);
});

test('slow VOD metadata is polled until finite duration becomes available', async () => {
  const command = getRegistry().get('youtube/frames');
  const loading = {
    videoId: 'HQqX4rF1nDM', duration: null, readyState: 0,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: 'OK', playabilityReason: '',
    rect: { x: 10, y: 20, width: 640, height: 360 },
  };
  const content = { ...loading, duration: 120, readyState: 4 };
  const page = mockPage([
    loading,
    loading,
    content,
    content,
    { actualTime: 60, rect: { x: 10, y: 20, width: 640, height: 360, scale: 1 } },
    content,
    { actualTime: 60, rect: { x: 10, y: 20, width: 640, height: 360, scale: 1 } },
    true,
    true,
  ]);

  const rows = await command.func(page, { url: 'HQqX4rF1nDM', count: 1 });
  assert.equal(rows[0].status, 'captured');
  assert.equal(
    page.calls.filter((call) => call[0] === 'wait' && call[1] === 0.25).length >= 2,
    true,
  );
});

test('an initially absent video element can mount during the metadata window and capture', async () => {
  const command = getRegistry().get('youtube/frames');
  const mounting = {
    videoId: 'HQqX4rF1nDM', duration: null, readyState: 0,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: '', playabilityReason: '',
    rect: null,
  };
  const content = {
    ...mounting,
    duration: 120,
    readyState: 4,
    playabilityStatus: 'OK',
    rect: { x: 10, y: 20, width: 640, height: 360 },
  };
  const page = mockPage([
    mounting,
    content,
    content,
    { actualTime: 60, rect: { x: 10, y: 20, width: 640, height: 360, scale: 1 } },
    content,
    true,
    true,
  ]);

  const rows = await command.func(page, { url: 'HQqX4rF1nDM', count: 1 });
  assert.equal(rows[0].status, 'captured');
  assert.equal(rows[0].actual_timestamp_seconds, 60);
  assert.equal(page.calls.some((call) => call[0] === 'cdp'), true);
});

test('an absent video element exhausts the metadata window with an actionable structured error', async () => {
  const mounting = {
    videoId: 'HQqX4rF1nDM', duration: null, readyState: 0,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: '', playabilityReason: '',
    rect: null,
  };
  const page = mockPage([mounting]);

  await assert.rejects(
    () => waitForFiniteVodState(page, 'HQqX4rF1nDM', 0.5),
    (error) => error instanceof CommandExecutionError
      && /within 0\.5 seconds/i.test(error.message)
      && /confirm.*available.*on-demand.*retry/i.test(error.hint || ''),
  );
  assert.equal(page.calls.filter((call) => call[0] === 'wait').length, 2);
  assert.equal(page.calls.filter((call) => call[0] === 'evaluate').length, 3);
  assert.equal(page.calls.some((call) => call[0] === 'cdp'), false);
});

test('playability failure observed while the video is mounting fails immediately', async () => {
  const mounting = {
    videoId: 'HQqX4rF1nDM', duration: null, readyState: 0,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: '', playabilityReason: '',
    rect: null,
  };
  const unavailable = {
    ...mounting,
    errorText: 'Video unavailable',
    playabilityStatus: 'ERROR',
    playabilityReason: 'Video unavailable',
  };
  const page = mockPage([mounting, unavailable]);

  await assert.rejects(
    () => waitForFiniteVodState(page, 'HQqX4rF1nDM', 0.5),
    /not playable|unavailable/i,
  );
  assert.equal(page.calls.filter((call) => call[0] === 'wait').length, 1);
  assert.equal(page.calls.filter((call) => call[0] === 'evaluate').length, 2);
});

test('mismatched identity observed while the video is mounting fails immediately', async () => {
  const mounting = {
    videoId: 'HQqX4rF1nDM', duration: null, readyState: 0,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: '', playabilityReason: '',
    rect: null,
  };
  const page = mockPage([mounting, { ...mounting, videoId: 'aaaaaaaaaaa' }]);

  await assert.rejects(
    () => waitForFiniteVodState(page, 'HQqX4rF1nDM', 0.5),
    /requested video.*active video/i,
  );
  assert.equal(page.calls.filter((call) => call[0] === 'wait').length, 1);
  assert.equal(page.calls.filter((call) => call[0] === 'evaluate').length, 2);
});

test('missing VOD metadata polling stops at its configured bound', async () => {
  const loading = {
    videoId: 'HQqX4rF1nDM', duration: null, readyState: 0,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: 'OK', playabilityReason: '',
    rect: { x: 10, y: 20, width: 640, height: 360 },
  };
  const page = mockPage([loading]);
  await assert.rejects(
    () => waitForFiniteVodState(page, 'HQqX4rF1nDM', 0.5),
    /within 0\.5 seconds/i,
  );
  assert.equal(page.calls.filter((call) => call[0] === 'wait').length, 2);
  assert.equal(page.calls.filter((call) => call[0] === 'evaluate').length, 3);
});

test('explicit unavailable state fails without metadata polling', async () => {
  const command = getRegistry().get('youtube/frames');
  const page = mockPage([{
    videoId: 'HQqX4rF1nDM', duration: null, readyState: 0,
    adShowing: false, canSkipAd: false, errorText: 'Video unavailable', isLive: false,
    membersOnly: false, playabilityStatus: 'ERROR', playabilityReason: 'Video unavailable',
    rect: { x: 10, y: 20, width: 640, height: 360 },
  }]);
  await assert.rejects(
    () => command.func(page, { url: 'HQqX4rF1nDM', count: 1 }),
    /not playable|unavailable/i,
  );
  assert.equal(
    page.calls.some((call) => call[0] === 'wait' && call[1] === 0.25),
    false,
  );
});

test('duration-relative explicit timestamp errors are structured argument errors', async () => {
  const command = getRegistry().get('youtube/frames');
  const page = mockPage([{
    videoId: 'HQqX4rF1nDM', duration: 120, readyState: 4,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: 'OK', playabilityReason: '',
    rect: { x: 10, y: 20, width: 640, height: 360 },
  }]);
  await assert.rejects(
    () => command.func(page, { url: 'HQqX4rF1nDM', timestamps: '120' }),
    (error) => error instanceof ArgumentError && /less than.*duration/i.test(error.message),
  );
});

test('a live transition immediately before seek prevents frame capture', async () => {
  const command = getRegistry().get('youtube/frames');
  const content = {
    videoId: 'HQqX4rF1nDM', duration: 120, readyState: 4,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: 'OK', playabilityReason: '',
    rect: { x: 10, y: 20, width: 640, height: 360 },
  };
  const page = mockPage([
    content,
    { ...content, duration: null, isLive: true },
    { actualTime: 60, rect: { x: 10, y: 20, width: 640, height: 360, scale: 1 } },
    content,
    true,
    true,
  ]);

  await assert.rejects(
    () => command.func(page, { url: 'HQqX4rF1nDM', count: 1 }),
    (error) => /every selected frame failed/i.test(error.message)
      && /live|finite.*greater than zero/i.test(error.hint || ''),
  );
  assert.equal(page.calls.some((call) => call[0] === 'cdp'), false);
});

test('a non-finite transition immediately before screenshot prevents frame capture', async () => {
  const command = getRegistry().get('youtube/frames');
  const content = {
    videoId: 'HQqX4rF1nDM', duration: 120, readyState: 4,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: 'OK', playabilityReason: '',
    rect: { x: 10, y: 20, width: 640, height: 360 },
  };
  const page = mockPage([
    content,
    content,
    { actualTime: 60, rect: { x: 10, y: 20, width: 640, height: 360, scale: 1 } },
    { ...content, duration: null },
    true,
    true,
  ]);

  await assert.rejects(
    () => command.func(page, { url: 'HQqX4rF1nDM', count: 1 }),
    (error) => /every selected frame failed/i.test(error.message)
      && /live|finite.*greater than zero/i.test(error.hint || ''),
  );
  assert.equal(page.calls.some((call) => call[0] === 'cdp'), false);
});

test('an active skippable ad is skipped before content state is returned', async () => {
  const contentState = {
    videoId: 'HQqX4rF1nDM', duration: 120, readyState: 4,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: 'OK', playabilityReason: '',
    rect: { x: 0, y: 0, width: 640, height: 360 },
  };
  const page = mockPage([
    { ...contentState, duration: 30, adShowing: true, canSkipAd: true },
    { skipped: true },
    contentState,
  ]);

  assert.deepEqual(
    await waitForRequestedContent(page, 'HQqX4rF1nDM'),
    contentState,
  );
  assert.equal(
    page.calls.some((call) => call[0] === 'evaluate' && call[1].includes('button.click()')),
    true,
  );
});

test('an advertisement still active after bounded polling prevents screenshots', async () => {
  const command = getRegistry().get('youtube/frames');
  const page = mockPage([{
    videoId: 'HQqX4rF1nDM', duration: 30, readyState: 4,
    adShowing: true, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: 'OK', playabilityReason: '',
    rect: { x: 0, y: 0, width: 640, height: 360 },
  }]);
  await assert.rejects(
    () => command.func(page, { url: 'HQqX4rF1nDM', count: 1 }),
    /advertisement/i,
  );
  assert.equal(page.calls.filter((call) => call[0] === 'wait' && call[1] === 1).length, 30);
  assert.equal(page.calls.some((call) => call[0] === 'cdp'), false);
});

test('seek browser script assigns currentTime and returns the ready video rectangle', async () => {
  const harness = seekScriptHarness();
  assert.deepEqual(await seekVideo(harness.page, 'HQqX4rF1nDM', 42), {
    actualTime: 42,
    rect: { x: 10, y: 20, width: 640, height: 360, scale: 1 },
  });
  assert.deepEqual(harness.assignedTimes, [42]);
  assert.equal(harness.video.muted, true);
  assert.equal(harness.pauseCalls, 1);
  assert.equal(harness.scrollCalls, 1);
  assertSeekResourcesClean(harness);
});

test('seek browser script takes the immediate path when already at target time', async () => {
  const harness = seekScriptHarness({ currentTime: 42, emitSeeked: false });
  assert.equal((await seekVideo(harness.page, 'HQqX4rF1nDM', 42)).actualTime, 42);
  assert.deepEqual(harness.assignedTimes, []);
  assertSeekResourcesClean(harness);
});

test('seek browser script rejects a stale active video without installing resources', async () => {
  const harness = seekScriptHarness({ activeVideoId: 'aaaaaaaaaaa' });
  await assert.rejects(
    () => seekVideo(harness.page, 'HQqX4rF1nDM', 42),
    /active video changed before seek/i,
  );
  assert.deepEqual(harness.assignedTimes, []);
  assert.deepEqual(harness.addedListeners, []);
  assertSeekResourcesClean(harness, false);
});

test('seek browser script rejects an empty active video ID without installing resources', async () => {
  const harness = seekScriptHarness({ activeVideoId: '' });
  await assert.rejects(
    () => seekVideo(harness.page, 'HQqX4rF1nDM', 42),
    /active video changed before seek/i,
  );
  assert.deepEqual(harness.assignedTimes, []);
  assert.deepEqual(harness.addedListeners, []);
  assertSeekResourcesClean(harness, false);
});

test('overlay scripts restore each layer previous inline visibility', async () => {
  const harness = overlayScriptHarness();
  await hidePlayerOverlays(harness.page);
  assert.equal(harness.keep.style.visibility, '');
  assert.equal(harness.overlay.style.visibility, 'hidden');

  await restorePlayerOverlays(harness.page);
  assert.equal(harness.overlay.style.visibility, 'collapse');
  assert.equal(harness.context.__webcmdYoutubeFrameHidden, undefined);
});

test('overlay restore cleans a replaced disconnected layer without styling its replacement', async () => {
  const harness = overlayScriptHarness();
  await hidePlayerOverlays(harness.page);
  harness.overlay.isConnected = false;
  const replacement = {
    style: { visibility: 'visible' },
    isConnected: true,
    contains: () => false,
  };
  harness.player.children[1] = replacement;

  await restorePlayerOverlays(harness.page);
  assert.equal(harness.overlay.style.visibility, 'collapse');
  assert.equal(replacement.style.visibility, 'visible');
});

test('seek browser script reports readiness timeout and cleans resources', async () => {
  const harness = seekScriptHarness({ readyState: 1, clockStep: 10001 });
  await assert.rejects(
    () => seekVideo(harness.page, 'HQqX4rF1nDM', 42),
    /frame did not become ready/i,
  );
  assertSeekResourcesClean(harness);
});

test('seek browser script rejects a zero-sized final rectangle and cleans resources', async () => {
  const harness = seekScriptHarness({
    rects: [
      { x: 10, y: 20, width: 640, height: 360 },
      { x: 0, y: 0, width: 0, height: 0 },
    ],
  });
  await assert.rejects(
    () => seekVideo(harness.page, 'HQqX4rF1nDM', 42),
    /hidden or zero-sized/i,
  );
  assertSeekResourcesClean(harness);
});

test('seek browser script cleans resources when its seek timer expires', async () => {
  const harness = seekScriptHarness({ emitSeeked: false });
  const pending = seekVideo(harness.page, 'HQqX4rF1nDM', 42);
  harness.fireTimer(10000);
  await assert.rejects(() => pending, /seek timed out/i);
  assertSeekResourcesClean(harness);
});

test('seek browser script cleans resources when the video emits an error', async () => {
  const harness = seekScriptHarness({ emitSeeked: false });
  const pending = seekVideo(harness.page, 'HQqX4rF1nDM', 42);
  harness.emit('error');
  await assert.rejects(() => pending, /reported an error while seeking/i);
  assertSeekResourcesClean(harness);
});

test('successful capture uses only a clipped CDP screenshot and an absolute PNG path', async () => {
  const command = getRegistry().get('youtube/frames');
  const page = mockPage(captureStates(120, [60]));

  const rows = await command.func(page, { url: 'HQqX4rF1nDM', count: 1 });
  const shotIndex = page.calls.findIndex((call) => call[0] === 'cdp');
  const shot = page.calls[shotIndex];
  assert.equal(shot[1], 'Page.captureScreenshot');
  assert.deepEqual(shot[2], {
    format: 'png',
    clip: { x: 10, y: 20, width: 640, height: 360, scale: 1 },
    captureBeyondViewport: false,
  });
  assert.equal(path.isAbsolute(rows[0].path), true);
  assert.match(rows[0].path, /frame-001-060000ms\.png$/);
  assert.equal(rows[0].actual_timestamp_seconds, 60);
  assert.equal(await fs.readFile(rows[0].path, 'utf8'), 'png');

  const hideIndex = page.calls.findIndex(
    (call) => call[0] === 'evaluate' && call[1].includes('__webcmdYoutubeFrameHidden ='),
  );
  const restoreIndex = page.calls.findIndex(
    (call) => call[0] === 'evaluate' && call[1].includes('delete globalThis.__webcmdYoutubeFrameHidden'),
  );
  assert.equal(hideIndex >= 0, true);
  assert.equal(restoreIndex >= 0, true);
  assert.equal(hideIndex < shotIndex, true);
  assert.equal(restoreIndex > shotIndex, true);
  assertOverlayIsolationAroundEveryCapture(page, 1);
});

test('capture re-seeks and uses the final active video time and rectangle after an ad settles', async () => {
  const command = getRegistry().get('youtube/frames');
  const content = {
    videoId: 'HQqX4rF1nDM', duration: 120, readyState: 4,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: 'OK', playabilityReason: '',
    rect: { x: 30, y: 40, width: 800, height: 450 },
  };
  const page = mockPage([
    content,
    content,
    { actualTime: 59, rect: { x: 10, y: 20, width: 640, height: 360, scale: 1 } },
    { ...content, duration: 30, adShowing: true },
    content,
    { actualTime: 60, rect: { x: 30, y: 40, width: 800, height: 450, scale: 1 } },
    content,
    true,
    true,
  ]);

  const rows = await command.func(page, { url: 'HQqX4rF1nDM', count: 1 });
  const shot = page.calls.find((call) => call[0] === 'cdp');
  assert.equal(rows[0].actual_timestamp_seconds, 60);
  assert.deepEqual(shot[2].clip, {
    x: 30, y: 40, width: 800, height: 450, scale: 1,
  });
  assert.equal(page.calls.filter(
    (call) => call[0] === 'evaluate' && call[1].includes('return (() => new Promise'),
  ).length, 2);
});

test('a seek-triggered ad is followed by a bounded re-seek, settle, guard, then capture', async () => {
  const command = getRegistry().get('youtube/frames');
  const content = {
    videoId: 'HQqX4rF1nDM', duration: 120, readyState: 4,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: 'OK', playabilityReason: '',
    rect: { x: 30, y: 40, width: 800, height: 450 },
  };
  const page = mockPage([
    content,
    content,
    { actualTime: 59, rect: { x: 10, y: 20, width: 640, height: 360, scale: 1 } },
    { ...content, duration: 30, adShowing: true },
    content,
    { actualTime: 60, rect: { x: 30, y: 40, width: 800, height: 450, scale: 1 } },
    content,
    true,
    true,
  ]);

  const rows = await command.func(page, { url: 'HQqX4rF1nDM', count: 1 });
  assert.equal(rows[0].actual_timestamp_seconds, 60);
  const captureLifecycles = page.calls.flatMap((call) => {
    if (call[0] === 'evaluate' && call[1].includes('return (() => new Promise')) return ['seek'];
    if (call[0] === 'wait' && call[1] === 0.25) return ['settle'];
    if (call[0] === 'evaluate' && call[1].includes('const playerResponse')) return ['guard'];
    if (call[0] === 'cdp') return ['capture'];
    return [];
  });
  const captureIndex = captureLifecycles.lastIndexOf('capture');
  assert.deepEqual(
    captureLifecycles.slice(captureIndex - 3, captureIndex + 1),
    ['seek', 'settle', 'guard', 'capture'],
  );
  assert.equal(
    captureLifecycles.slice(captureLifecycles.lastIndexOf('guard'), captureIndex).includes('seek'),
    false,
  );
});

test('an ad after every seek exhausts three attempts without taking a screenshot', async () => {
  const command = getRegistry().get('youtube/frames');
  const content = {
    videoId: 'HQqX4rF1nDM', duration: 120, readyState: 4,
    adShowing: false, canSkipAd: false, errorText: '', isLive: false,
    membersOnly: false, playabilityStatus: 'OK', playabilityReason: '',
    rect: { x: 30, y: 40, width: 800, height: 450 },
  };
  const seekResult = {
    actualTime: 60,
    rect: { x: 30, y: 40, width: 800, height: 450, scale: 1 },
  };
  const page = mockPage([
    content,
    content,
    seekResult,
    { ...content, duration: 30, adShowing: true },
    content,
    seekResult,
    { ...content, duration: 30, adShowing: true },
    content,
    seekResult,
    { ...content, duration: 30, adShowing: true },
    content,
  ]);

  await assert.rejects(
    () => command.func(page, { url: 'HQqX4rF1nDM', count: 1 }),
    (error) => error instanceof CommandExecutionError
      && /every selected frame failed/i.test(error.message)
      && /advertisement.*3 seek attempts/i.test(error.hint || ''),
  );
  assert.equal(page.calls.filter(
    (call) => call[0] === 'evaluate' && call[1].includes('return (() => new Promise'),
  ).length, 3);
  assert.equal(page.calls.filter((call) => call[0] === 'wait' && call[1] === 0.25).length, 3);
  assert.equal(page.calls.some((call) => call[0] === 'cdp'), false);
});

test('a middle screenshot failure preserves ordered rows and aggregate coverage counts', async () => {
  const command = getRegistry().get('youtube/frames');
  const page = mockPage(
    captureStates(100, [10, 20, 30]),
    [
      undefined,
      new Error(`middle capture failed\n${'x'.repeat(400)}`),
      undefined,
    ],
  );

  const rows = await command.func(page, {
    url: 'HQqX4rF1nDM',
    timestamps: '10,20,30',
  });
  assert.deepEqual(rows.map((row) => row.timestamp_seconds), [10, 20, 30]);
  assert.deepEqual(rows.map((row) => row.status), ['captured', 'failed', 'captured']);
  assert.equal(rows[1].path, '');
  assert.equal(rows[1].actual_timestamp_seconds, '');
  assert.equal(rows[1].error.includes('\n'), false);
  assert.equal(rows[1].error.length <= 300, true);
  for (const row of rows) {
    assert.deepEqual(
      [row.requested_count, row.selected_count, row.captured_count, row.failed_count],
      [3, 3, 2, 1],
    );
  }
  assertOverlayIsolationAroundEveryCapture(page, 3);
});

test('the command rejects when every selected frame fails', async () => {
  const command = getRegistry().get('youtube/frames');
  const page = mockPage(
    captureStates(100, [10, 20, 30]),
    [new Error('one'), new Error('two'), new Error('three')],
  );
  await assert.rejects(
    () => command.func(page, {
      url: 'HQqX4rF1nDM',
      timestamps: '10,20,30',
    }),
    /every selected frame failed/i,
  );
});
