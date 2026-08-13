import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  parseVideoId,
  parseSamplingOptions,
  selectPositions,
  formatMilliseconds,
} from './frames-core.js';

export const FRAME_COLUMNS = [
  'video_id', 'duration_seconds', 'timestamp_seconds', 'actual_timestamp_seconds',
  'path', 'status', 'error', 'requested_count', 'selected_count',
  'captured_count', 'failed_count',
];

export async function readPlayerState(page, expectedVideoId, allowMissingVideo = false) {
  const state = await page.evaluate(`(() => {
    const url = new URL(location.href);
    const shorts = url.pathname.match(/^\\/shorts\\/([A-Za-z0-9_-]{11})/);
    const videoId = url.searchParams.get('v') || shorts?.[1] || '';
    const candidates = [...document.querySelectorAll('video')]
      .map((video) => ({ video, rect: video.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
    const chosen = candidates[0];
    const player = chosen?.video.closest('.html5-video-player');
    const skip = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button');
    const skipRect = skip?.getBoundingClientRect();
    const errorNode = document.querySelector(
      '.ytp-error-content-wrap, #reason, yt-playability-error-supported-renderers'
    );
    const duration = chosen?.video?.duration;
    const playerResponse = player?.getPlayerResponse?.()
      || globalThis.ytInitialPlayerResponse
      || {};
    const responseVideoId = String(playerResponse?.videoDetails?.videoId || '');
    const playability = responseVideoId === videoId
      ? playerResponse?.playabilityStatus || {}
      : {};
    const memberBadge = player?.querySelector(
      '[aria-label*="members only" i], [aria-label*="members-only" i], '
      + '[title*="members only" i], [title*="members-only" i], .ytp-members-only'
    );
    const membershipText = [playability.reason, ...(playability.messages || [])]
      .map((value) => String(value || ''))
      .join(' ');
    const membersOnly = Boolean(memberBadge)
      || /members?[ -]?only|channel members|membership required/i.test(membershipText);
    return {
      videoId,
      duration: Number.isFinite(duration) ? duration : null,
      readyState: chosen?.video?.readyState ?? 0,
      adShowing: Boolean(player?.classList.contains('ad-showing')),
      canSkipAd: Boolean(skip && !skip.disabled && skipRect?.width > 0 && skipRect?.height > 0),
      errorText: String(errorNode?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300),
      isLive: playerResponse?.videoDetails?.isLiveContent === true || duration === Infinity,
      membersOnly,
      playabilityStatus: String(playability.status || ''),
      playabilityReason: String(playability.reason || '').replace(/\\s+/g, ' ').trim().slice(0, 300),
      rect: chosen ? {
        x: chosen.rect.x, y: chosen.rect.y,
        width: chosen.rect.width, height: chosen.rect.height,
      } : null,
    };
  })()`);
  if (!state || typeof state !== 'object') {
    throw new CommandExecutionError('YouTube player state was unavailable');
  }
  if (state.videoId !== expectedVideoId) {
    throw new CommandExecutionError(
      `Requested video ${expectedVideoId} but the active video is ${state.videoId || '(missing)'}`,
    );
  }
  if (state.membersOnly) {
    throw new CommandExecutionError('Members-only videos are unsupported for frame capture');
  }
  if (state.playabilityStatus && state.playabilityStatus !== 'OK') {
    throw new CommandExecutionError(
      `YouTube video is not playable: ${state.playabilityReason || state.playabilityStatus}`,
    );
  }
  if (!state.rect && !allowMissingVideo) {
    throw new CommandExecutionError(
      state.errorText || 'No visible YouTube video element was available',
      'Open the video in the current YouTube session and confirm that it is playable.',
    );
  }
  return state;
}

export async function waitForRequestedContent(
  page,
  expectedVideoId,
  timeoutSeconds = 30,
  { allowMissingVideo = false, onAdObserved } = {},
) {
  for (let elapsed = 0; elapsed <= timeoutSeconds; elapsed += 1) {
    const state = await readPlayerState(page, expectedVideoId, allowMissingVideo);
    if (state.errorText && !state.adShowing) {
      throw new CommandExecutionError(`YouTube cannot play this video: ${state.errorText}`);
    }
    if (!state.adShowing) return state;
    onAdObserved?.();
    if (state.canSkipAd) {
      await page.evaluate(`(() => {
        const button = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button');
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`);
    }
    if (elapsed === timeoutSeconds) break;
    await page.wait(1);
  }
  throw new CommandExecutionError(
    'An advertisement prevented deterministic frame capture',
    'Retry after the requested video content begins playing.',
  );
}

export async function waitForFiniteVodState(page, expectedVideoId, timeoutSeconds = 10) {
  const pollSeconds = 0.25;
  for (let elapsed = 0; elapsed <= timeoutSeconds; elapsed += pollSeconds) {
    const state = await waitForRequestedContent(page, expectedVideoId, 30, {
      allowMissingVideo: true,
    });
    if (state.isLive) return requireFiniteVodState(state);
    if (Number.isFinite(state.duration) && state.duration > 0) return state;
    if (elapsed === timeoutSeconds) break;
    await page.wait(pollSeconds);
  }
  throw new CommandExecutionError(
    `YouTube video duration metadata did not become finite within ${timeoutSeconds} seconds`,
    'Confirm the requested video is an available on-demand recording, then retry.',
  );
}

export async function seekVideo(page, expectedVideoId, timestampSeconds) {
  const body = `(() => new Promise((resolve) => {
    const url = new URL(location.href);
    const activeVideoId = url.searchParams.get('v')
      || url.pathname.match(/^\\/shorts\\/([A-Za-z0-9_-]{11})/)?.[1]
      || '';
    const candidates = [...document.querySelectorAll('video')]
      .map((video) => ({ video, rect: video.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
    const video = candidates[0]?.video;
    if (activeVideoId !== expectedVideoId) {
      resolve({ error: 'Active video changed before seek' }); return;
    }
    if (!video) { resolve({ error: 'Visible video element disappeared before seek' }); return; }
    let timer;
    let correctiveSeeks = 0;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    const finish = (value) => { cleanup(); resolve(value); };
    const onError = () => finish({ error: 'Video player reported an error while seeking' });
    const onSeeked = async () => {
      if (Math.abs(video.currentTime - timestampSeconds) > 0.25) {
        if (correctiveSeeks < 2) {
          correctiveSeeks += 1;
          video.currentTime = timestampSeconds;
        }
        return;
      }
      const deadline = Date.now() + 10000;
      while (video.readyState < 2 && Date.now() < deadline) {
        await new Promise((next) => setTimeout(next, 50));
      }
      if (video.readyState < 2) {
        finish({ error: 'Video frame did not become ready after seek' }); return;
      }
      video.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise((next) => requestAnimationFrame(() => requestAnimationFrame(next)));
      const rect = video.getBoundingClientRect();
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
          || !(rect.width > 0 && rect.height > 0)) {
        finish({ error: 'Video element became hidden or zero-sized after seek' }); return;
      }
      finish({
        actualTime: video.currentTime,
        rect: {
          x: rect.x + scrollX,
          y: rect.y + scrollY,
          width: rect.width,
          height: rect.height,
          scale: 1,
        },
      });
    };
    video.pause();
    video.muted = true;
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError, { once: true });
    timer = setTimeout(() => finish({ error: 'Seek timed out after 10 seconds' }), 10000);
    if (Math.abs(video.currentTime - timestampSeconds) < 0.001) onSeeked();
    else video.currentTime = timestampSeconds;
  }))()`;
  const result = typeof page.evaluateWithArgs === 'function'
    ? await page.evaluateWithArgs(body, { expectedVideoId, timestampSeconds })
    : await page.evaluate(`(() => {
        const expectedVideoId = ${JSON.stringify(expectedVideoId)};
        const timestampSeconds = ${JSON.stringify(timestampSeconds)};
        return ${body};
      })()`);
  if (!result || result.error) throw new Error(result?.error || 'Seek returned no result');
  return result;
}

export async function hidePlayerOverlays(page) {
  const hidden = await page.evaluate(`(() => {
    const videos = [...document.querySelectorAll('video')]
      .map((video) => ({ video, rect: video.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
    const video = videos[0]?.video;
    const player = video?.closest('.html5-video-player');
    if (!video || !player) return false;
    const keep = [...player.children].find((child) => child === video || child.contains(video));
    if (!keep) return false;
    globalThis.__webcmdYoutubeFrameHidden = [...player.children]
      .filter((child) => child !== keep)
      .map((element) => ({ element, visibility: element.style.visibility }));
    for (const entry of globalThis.__webcmdYoutubeFrameHidden) {
      entry.element.style.visibility = 'hidden';
    }
    return true;
  })()`);
  if (!hidden) throw new Error('Could not isolate the active video layer from player overlays');
  return true;
}

export async function restorePlayerOverlays(page) {
  await page.evaluate(`(() => {
    for (const entry of (globalThis.__webcmdYoutubeFrameHidden || [])) {
      if (entry.element?.style) entry.element.style.visibility = entry.visibility;
    }
    delete globalThis.__webcmdYoutubeFrameHidden;
    return true;
  })()`);
}

export async function capturePng(page, clip, outputPath) {
  const absolutePath = path.resolve(outputPath);
  await hidePlayerOverlays(page);
  try {
    await page.wait(0.05);
    const shot = await page.cdp('Page.captureScreenshot', {
      format: 'png',
      clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 },
      captureBeyondViewport: true,
    });
    const base64 = typeof shot === 'string' ? shot : shot?.data;
    if (!base64) throw new Error('CDP screenshot returned no image data');
    await fs.writeFile(absolutePath, base64, 'base64');
    return absolutePath;
  } finally {
    await restorePlayerOverlays(page);
  }
}

function conciseError(error) {
  return String(error?.message || error || 'Frame capture failed')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function requireFiniteVodState(state) {
  if (state.isLive || !Number.isFinite(state.duration) || state.duration <= 0) {
    throw new CommandExecutionError(
      'Live videos or videos without a finite duration greater than zero are unsupported',
    );
  }
  return state;
}

const POST_SEEK_ATTEMPTS = 3;

async function seekAndConfirmRequestedFrame(page, videoId, timestamp) {
  for (let attempt = 1; attempt <= POST_SEEK_ATTEMPTS; attempt += 1) {
    const seekResult = await seekVideo(page, videoId, timestamp);
    await page.wait(0.25);
    let adObserved = false;
    const postSeekState = await waitForRequestedContent(page, videoId, 30, {
      onAdObserved: () => { adObserved = true; },
    });
    requireFiniteVodState(postSeekState);
    if (!adObserved) return seekResult;
  }
  throw new CommandExecutionError(
    `An advertisement interrupted all ${POST_SEEK_ATTEMPTS} seek attempts`,
    'Retry after the requested video content begins playing without interruption.',
  );
}

cli({
  site: 'youtube',
  name: 'frames',
  access: 'read',
  description: 'Capture timestamped PNG frames from a YouTube video',
  domain: 'www.youtube.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'ephemeral',
  args: [
    { name: 'url', required: true, positional: true, help: 'YouTube watch URL, Shorts URL, or video ID' },
    { name: 'timestamps', required: false, help: 'Comma-separated exact timestamps in seconds' },
    { name: 'count', type: 'int', required: false, help: 'Automatically distribute 1-20 frames; default 5' },
  ],
  columns: FRAME_COLUMNS,
  func: async (page, kwargs) => {
    let videoId;
    let request;
    try {
      videoId = parseVideoId(kwargs.url);
      request = parseSamplingOptions({ timestamps: kwargs.timestamps, count: kwargs.count });
    } catch (error) {
      throw new ArgumentError(error.message,
        'Use --timestamps 30,90,150 or --count 5, but not both.');
    }
    try {
      await page.goto(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
        waitUntil: 'none',
      });
    } catch (error) {
      throw new CommandExecutionError(
        `Could not open the requested YouTube video: ${conciseError(error)}`,
        'Restart the Webcmd browser runtime if it was closed, then retry the command.',
      );
    }
    const state = await waitForFiniteVodState(page, videoId);
    let positions;
    try {
      positions = selectPositions(request, state.duration);
    } catch (error) {
      throw new ArgumentError(
        error.message,
        `Use timestamps from zero up to, but not including, ${state.duration} seconds.`,
      );
    }
    const cacheRoot = process.env.WEBCMD_CACHE_DIR
      ? path.resolve(process.env.WEBCMD_CACHE_DIR)
      : path.join(os.homedir(), '.webcmd', 'cache');
    const videoRoot = path.join(cacheRoot, 'youtube-frames', videoId);
    await fs.mkdir(videoRoot, { recursive: true });
    const runDir = path.join(videoRoot, crypto.randomUUID());
    await fs.mkdir(runDir, { recursive: false });

    const rows = [];
    for (const [index, timestamp] of positions.entries()) {
      const filename = `frame-${String(index + 1).padStart(3, '0')}-${formatMilliseconds(timestamp)}ms.png`;
      try {
        const preSeekState = await waitForRequestedContent(page, videoId);
        requireFiniteVodState(preSeekState);
        const { actualTime, rect } = await seekAndConfirmRequestedFrame(page, videoId, timestamp);
        const outputPath = await capturePng(page, rect, path.join(runDir, filename));
        rows.push({
          video_id: videoId,
          duration_seconds: state.duration,
          timestamp_seconds: timestamp,
          actual_timestamp_seconds: actualTime,
          path: outputPath,
          status: 'captured',
          error: '',
        });
      } catch (error) {
        rows.push({
          video_id: videoId,
          duration_seconds: state.duration,
          timestamp_seconds: timestamp,
          actual_timestamp_seconds: '',
          path: '',
          status: 'failed',
          error: conciseError(error),
        });
      }
    }
    const capturedCount = rows.filter((row) => row.status === 'captured').length;
    const failedCount = rows.length - capturedCount;
    if (capturedCount === 0) {
      throw new CommandExecutionError(
        `Every selected frame failed for ${videoId}`,
        rows.map((row) => row.error).filter(Boolean).slice(0, 3).join('; '),
      );
    }
    return rows.map((row) => ({
      ...row,
      requested_count: request.requestedCount,
      selected_count: positions.length,
      captured_count: capturedCount,
      failed_count: failedCount,
    }));
  },
});
