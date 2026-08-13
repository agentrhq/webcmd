import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import * as checkout from '../checkout.js';

describe('district checkout payment handoff', () => {
  it('selects Scan QR to pay before reporting the UPI scanner ready', async () => {
    const dom = new JSDOM('<payment-checkout></payment-checkout>', {
      url: 'https://www.district.in/movies/order-review/demo',
      runScripts: 'outside-only',
    });
    const host = dom.window.document.querySelector('payment-checkout') as HTMLElement;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<section role="dialog"><label><span>Scan QR to pay</span></label></section>';
    const qrOption = shadow.querySelector('label') as HTMLElement;
    const clicks: string[] = [];

    host.scrollIntoView = () => {};
    qrOption.scrollIntoView = () => {};
    host.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 40 }) as DOMRect;
    qrOption.getBoundingClientRect = () => ({ left: 120, top: 40, width: 160, height: 40 }) as DOMRect;
    qrOption.addEventListener('click', () => {
      clicks.push('qr');
      shadow.innerHTML = [
        '<section role="dialog">',
        '<div>UPI QR</div>',
        '<div>Scan the QR using any UPI App</div>',
        '<div>To pay: ₹1164.43</div>',
        '<img alt="UPI QR Code">',
        '</section>',
      ].join('');
    });

    const page = {
      evaluate: async (script: string) => dom.window.eval(script),
      nativeClick: async (x: number) => {
        if (x < 100) {
          clicks.push('checkout');
          host.click();
        } else {
          qrOption.click();
        }
      },
      wait: async () => {},
    };

    const result = await checkout.__test__.openUpiQrScanner(page, {
      status: 'payment_handoff',
      total: '₹1164.43',
      paymentUrl: dom.window.location.href,
    }, 0.02);

    expect(clicks).toEqual(['checkout', 'qr']);
    expect(result).toMatchObject({
      status: 'upi_qr_ready',
      paymentMethod: 'UPI QR',
      paymentState: 'qr_scanner_visible',
      upiQrVisible: 'true',
      paymentAmount: '₹1164.43',
    });
  });
});
