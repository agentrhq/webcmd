import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { CloakNetworkCapture } from './network.js';

class FakePage extends EventEmitter {
  off(event: string, listener: (...args: any[]) => void) {
    this.removeListener(event, listener);
    return this;
  }
}

describe('CloakNetworkCapture', () => {
  it('captures matching request and response metadata with a bounded buffer', async () => {
    const page = new FakePage();
    const capture = new CloakNetworkCapture(2);
    capture.start('api.example', page as any);

    const req = {
      url: () => 'https://api.example/items',
      method: () => 'POST',
      headers: () => ({ accept: 'application/json' }),
      postData: () => '{"x":1}',
    };
    const res = {
      url: () => 'https://api.example/items',
      status: () => 200,
      headers: () => ({ 'content-type': 'application/json' }),
      text: async () => '{"ok":true}',
    };

    page.emit('request', req);
    page.emit('response', res);

    expect(await capture.read(page as any)).toEqual([expect.objectContaining({
      kind: 'cdp',
      url: 'https://api.example/items',
      method: 'POST',
      responseStatus: 200,
      responsePreview: '{"ok":true}',
    })]);
  });

  it('matches same-url responses to their exact request identity', async () => {
    const page = new FakePage();
    const capture = new CloakNetworkCapture(10);
    capture.start('api.example', page as any);

    const firstReq = {
      url: () => 'https://api.example/items',
      method: () => 'POST',
      headers: () => ({ 'x-request': 'first' }),
      postData: () => 'first',
    };
    const secondReq = {
      url: () => 'https://api.example/items',
      method: () => 'PUT',
      headers: () => ({ 'x-request': 'second' }),
      postData: () => 'second',
    };
    const firstRes = {
      url: () => 'https://api.example/items',
      request: () => firstReq,
      status: () => 201,
      headers: () => ({ 'content-type': 'application/json' }),
      text: async () => '{"first":true}',
    };

    page.emit('request', firstReq);
    page.emit('request', secondReq);
    page.emit('response', firstRes);

    const entries = await capture.read(page as any);
    expect(entries).toEqual([
      expect.objectContaining({
        method: 'POST',
        requestBodyPreview: 'first',
        responseStatus: 201,
        responsePreview: '{"first":true}',
      }),
      expect.objectContaining({
        method: 'PUT',
        requestBodyPreview: 'second',
      }),
    ]);
    expect(entries[1]).not.toHaveProperty('responseStatus');
    expect(entries[1]).not.toHaveProperty('responsePreview');
  });

  it('skips response body previews for non-text content types', async () => {
    const page = new FakePage();
    const capture = new CloakNetworkCapture(10);
    capture.start('api.example', page as any);

    const req = {
      url: () => 'https://api.example/image.png',
      method: () => 'GET',
      headers: () => ({}),
      postData: () => null,
    };
    const text = vi.fn(async () => 'binary-ish body');
    const res = {
      url: () => 'https://api.example/image.png',
      request: () => req,
      status: () => 200,
      headers: () => ({ 'content-type': 'image/png', 'content-length': '15' }),
      text,
    };

    page.emit('request', req);
    page.emit('response', res);

    expect(await capture.read(page as any)).toEqual([expect.objectContaining({
      responseContentType: 'image/png',
      responseBodyFullSize: 15,
      responseBodyTruncated: undefined,
      responsePreview: undefined,
    })]);
    expect(text).not.toHaveBeenCalled();
  });

  it('evicts older entries when the bounded buffer limit is exceeded', async () => {
    const page = new FakePage();
    const capture = new CloakNetworkCapture(2);
    capture.start('api.example', page as any);

    for (const id of ['one', 'two', 'three']) {
      page.emit('request', {
        url: () => `https://api.example/${id}`,
        method: () => 'GET',
        headers: () => ({}),
        postData: () => null,
      });
    }

    expect(await capture.read(page as any)).toEqual([
      expect.objectContaining({ url: 'https://api.example/two' }),
      expect.objectContaining({ url: 'https://api.example/three' }),
    ]);
  });
});
