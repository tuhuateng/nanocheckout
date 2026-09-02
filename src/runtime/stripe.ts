import { constantTimeEqual } from './crypto';
import type { StripeLike, StripeSessionInput, VerifiedStripeEvent } from './types';

const encoder = new TextEncoder();

function append(params: URLSearchParams, key: string, value: string | number) {
  params.append(key, String(value));
}

export function createStripeClient(secretKey: string): StripeLike {
  return {
    async createCheckoutSession(input: StripeSessionInput) {
      const params = new URLSearchParams();
      append(params, 'mode', 'payment');
      append(params, 'client_reference_id', input.orderId);
      append(params, 'customer_email', input.customerEmail);
      append(params, 'success_url', input.successUrl);
      append(params, 'cancel_url', input.cancelUrl);
      append(params, 'locale', 'ja');
      append(params, 'metadata[order_id]', input.orderId);
      append(params, 'line_items[0][quantity]', input.quantity);
      append(params, 'line_items[0][price_data][currency]', input.orderSpec.product.currency);
      append(params, 'line_items[0][price_data][unit_amount]', input.orderSpec.product.unitAmount);
      append(params, 'line_items[0][price_data][product_data][name]', input.orderSpec.product.name);
      append(params, 'line_items[0][price_data][product_data][description]', input.orderSpec.product.edition);

      if (input.orderSpec.shippingAmount > 0) {
        append(params, 'shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
        append(params, 'shipping_options[0][shipping_rate_data][fixed_amount][amount]', input.orderSpec.shippingAmount);
        append(params, 'shipping_options[0][shipping_rate_data][fixed_amount][currency]', input.orderSpec.product.currency);
        append(params, 'shipping_options[0][shipping_rate_data][display_name]', '通常配送');
      }

      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          'idempotency-key': input.idempotencyKey,
          'stripe-version': '2025-07-30.basil',
        },
        body: params,
      });
      const body = (await response.json()) as { id?: string; url?: string; error?: { message?: string } };
      if (!response.ok || !body.id || !body.url) {
        throw new Error(body.error?.message || 'Stripe Checkout session creation failed');
      }
      return { id: body.id, url: body.url };
    },

    async verifyWebhook(payload: string, signature: string, secret: string) {
      return verifyStripeWebhook(payload, signature, secret);
    },
  };
}

export function createDemoStripeClient(): StripeLike {
  return {
    async createCheckoutSession(input) {
      return {
        id: `cs_demo_${input.orderId}`,
        url: `${input.successUrl.split('?')[0]}?demo=1&order=${encodeURIComponent(input.orderId)}`,
      };
    },
    async verifyWebhook() {
      throw new Error('Webhooks are unavailable in demo mode');
    },
  };
}

async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyStripeWebhook(
  payload: string,
  signatureHeader: string,
  secret: string,
  now = Date.now(),
): Promise<VerifiedStripeEvent> {
  const parts = signatureHeader.split(',').map((part) => part.trim().split('=', 2));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || signatures.length === 0) throw new Error('Invalid Stripe-Signature header');

  const ageSeconds = Math.abs(now / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) throw new Error('Stripe webhook timestamp is outside tolerance');

  const expected = await hmacHex(`${timestamp}.${payload}`, secret);
  if (!signatures.some((candidate) => constantTimeEqual(candidate, expected))) {
    throw new Error('Stripe webhook signature mismatch');
  }

  const event = JSON.parse(payload) as { type?: string; data?: { object?: { id?: string } } };
  const paymentSessionId = event.data?.object?.id;
  if (!event.type || !paymentSessionId) throw new Error('Unsupported Stripe event payload');
  return { type: event.type, paymentSessionId };
}
