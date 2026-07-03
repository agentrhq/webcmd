import type { Page, Request, Response } from 'playwright-core';

export interface NetworkCaptureEntry {
  kind: 'cdp';
  url: string;
  method: string;
  requestHeaders?: Record<string, string>;
  requestBodyKind?: string;
  requestBodyPreview?: string;
  requestBodyFullSize?: number;
  requestBodyTruncated?: boolean;
  responseStatus?: number;
  responseContentType?: string;
  responseHeaders?: Record<string, string>;
  responsePreview?: string;
  responseBodyFullSize?: number;
  responseBodyTruncated?: boolean;
  timestamp: number;
}

type CaptureState = {
  pattern: string;
  entries: NetworkCaptureEntry[];
  byRequest: WeakMap<Request, NetworkCaptureEntry>;
  pending: Set<Promise<void>>;
  onRequest: (request: Request) => void;
  onResponse: (response: Response) => void;
};

const BODY_LIMIT = 8 * 1024 * 1024;

export class CloakNetworkCapture {
  private readonly states = new WeakMap<Page, CaptureState>();

  constructor(private readonly limit = 200) {}

  start(pattern: string, page: Page): void {
    this.stop(page);
    const entries: NetworkCaptureEntry[] = [];
    const byRequest = new WeakMap<Request, NetworkCaptureEntry>();
    const pending = new Set<Promise<void>>();
    const state: CaptureState = {
      pattern,
      entries,
      byRequest,
      pending,
      onRequest: (request) => {
        const url = request.url();
        if (pattern && !url.includes(pattern)) return;
        const body = request.postData() ?? undefined;
        const entry = {
          kind: 'cdp',
          url,
          method: request.method(),
          requestHeaders: request.headers(),
          requestBodyKind: body === undefined ? undefined : 'text',
          requestBodyPreview: body === undefined ? undefined : body.slice(0, BODY_LIMIT),
          requestBodyFullSize: body?.length,
          requestBodyTruncated: body ? body.length > BODY_LIMIT : undefined,
          timestamp: Date.now(),
        } satisfies NetworkCaptureEntry;
        entries.push(entry);
        byRequest.set(request, entry);
        this.bound(entries);
      },
      onResponse: (response) => {
        const capture = this.captureResponse(response, pattern, entries, byRequest)
          .finally(() => pending.delete(capture));
        pending.add(capture);
      },
    };
    page.on('request', state.onRequest);
    page.on('response', state.onResponse);
    this.states.set(page, state);
  }

  async read(page: Page): Promise<NetworkCaptureEntry[]> {
    const state = this.states.get(page);
    if (!state) return [];
    await Promise.allSettled([...state.pending]);
    return [...state.entries];
  }

  stop(page: Page): void {
    const state = this.states.get(page);
    if (!state) return;
    page.off('request', state.onRequest);
    page.off('response', state.onResponse);
    this.states.delete(page);
  }

  private async captureResponse(
    response: Response,
    pattern: string,
    entries: NetworkCaptureEntry[],
    byRequest: WeakMap<Request, NetworkCaptureEntry>,
  ): Promise<void> {
    const url = response.url();
    if (pattern && !url.includes(pattern)) return;
    const headers = response.headers();
    const contentType = headers['content-type'];
    let preview: string | undefined;
    let fullSize: number | undefined;
    let truncated: boolean | undefined;
    const contentLength = Number(headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength >= 0) fullSize = contentLength;
    if (isTextLikeContentType(contentType)) {
      try {
        const text = await response.text();
        fullSize = text.length;
        truncated = text.length > BODY_LIMIT;
        preview = text.slice(0, BODY_LIMIT);
      } catch {
        preview = undefined;
      }
    }
    const responseRequest = typeof response.request === 'function' ? response.request() : undefined;
    const existing = responseRequest
      ? byRequest.get(responseRequest)
      : [...entries].reverse().find((entry) => entry.url === url && entry.responseStatus === undefined);
    const target = existing ?? {
      kind: 'cdp' as const,
      url,
      method: 'GET',
      timestamp: Date.now(),
    };
    target.responseStatus = response.status();
    target.responseContentType = contentType;
    target.responseHeaders = headers;
    target.responsePreview = preview;
    target.responseBodyFullSize = fullSize;
    target.responseBodyTruncated = truncated;
    if (!existing) entries.push(target);
    this.bound(entries);
  }

  private bound(entries: NetworkCaptureEntry[]): void {
    while (entries.length > this.limit) entries.shift();
  }
}

function isTextLikeContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase();
  return normalized.startsWith('text/')
    || normalized.includes('json')
    || normalized.includes('javascript')
    || normalized.includes('xml')
    || normalized.includes('x-www-form-urlencoded');
}
