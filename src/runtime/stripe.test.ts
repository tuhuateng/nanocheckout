import { describe, expect, it } from 'vitest';
import { verifyStripeWebhook } from './stripe';

const encoder = new TextEncoder();

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('Stripe webhook verification', () => {
  it('accepts a correctly signed event', async () => {
    const timestamp = 1_800_000_000;
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_123' } } });
    const signature = await sign(`${timestamp}.${payload}`, 'whsec_test');
    const event = await verifyStripeWebhook(payload, `t=${timestamp},v1=${signature}`, 'whsec_test', timestamp * 1000);
    expect(event).toEqual({ type: 'checkout.session.completed', paymentSessionId: 'cs_test_123' });
  });

  it('rejects an old or invalid signature', async () => {
    const payload = '{}';
    await expect(verifyStripeWebhook(payload, 't=1,v1=bad', 'secret', 1_800_000_000_000)).rejects.toThrow();
  });
});
