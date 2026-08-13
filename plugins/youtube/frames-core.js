const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseVideoId(input) {
  const raw = String(input ?? '').trim();
  if (VIDEO_ID.test(raw)) return raw;

  let parsed;
  try { parsed = new URL(raw); } catch {
    throw new Error('A YouTube video URL or 11-character video ID is required');
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let candidate = '';
  if (host === 'youtu.be') candidate = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (parsed.pathname === '/watch') candidate = parsed.searchParams.get('v') ?? '';
    if (parsed.pathname.startsWith('/shorts/')) candidate = parsed.pathname.split('/')[2] ?? '';
  }
  if (!VIDEO_ID.test(candidate)) {
    throw new Error('A valid YouTube video watch URL, Shorts URL, or 11-character video ID is required');
  }
  return candidate;
}

export function parseSamplingOptions({ timestamps, count } = {}) {
  const hasTimestamps = timestamps !== undefined && timestamps !== null;
  const hasCount = count !== undefined && count !== null;
  if (hasTimestamps && hasCount) throw new Error('--timestamps and --count are mutually exclusive');
  if (!hasTimestamps && !hasCount) return { mode: 'count', count: 5, requestedCount: 5 };

  if (hasTimestamps) {
    const tokens = String(timestamps).split(',');
    if (!tokens.length || tokens.some((token) => token.trim() === '')) {
      throw new Error('--timestamps must be a comma-separated list of seconds');
    }
    const parsed = tokens.map((token) => Number(token.trim()));
    if (parsed.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error('Every timestamp must be a finite non-negative number of seconds');
    }
    return {
      mode: 'timestamps',
      positions: [...new Set(parsed)].sort((a, b) => a - b),
      requestedCount: parsed.length,
    };
  }

  const parsedCount = Number(count);
  if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 20) {
    throw new Error('--count must be an integer from 1 through 20');
  }
  return { mode: 'count', count: parsedCount, requestedCount: parsedCount };
}

export function selectPositions(request, durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Video duration must be finite and greater than zero');
  }
  const positions = request.mode === 'timestamps'
    ? request.positions
    : request.count === 1
      ? [durationSeconds * 0.5]
      : Array.from({ length: request.count }, (_, index) =>
          durationSeconds * (0.1 + (0.8 * index) / (request.count - 1)));
  if (positions.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Every timestamp must be a finite non-negative number of seconds');
  }
  if (positions.some((value) => value >= durationSeconds)) {
    throw new Error('Every timestamp must be less than the confirmed video duration');
  }
  if (request.mode === 'timestamps') return positions;
  const latestSafeMillisecond = Math.max(0, Math.floor(durationSeconds * 1000 - 1) / 1000);
  return [...new Set(positions.map((value) =>
    Math.min(Number(value.toFixed(3)), latestSafeMillisecond),
  ))].sort((a, b) => a - b);
}

export function formatMilliseconds(seconds) {
  return String(Math.round(seconds * 1000)).padStart(6, '0');
}
