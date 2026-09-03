import { describe, expect, it, vi } from 'vitest';
import { orderSpec } from '../config/order-spec';
import { createCheckoutApp } from './checkout-app';
import { createRandomBase64Key } from './crypto';
import { MemoryCheckoutDatabase } from './memory-database';
import type { ProductRecord, StripeLike } from './types';

const mcpToken = 'mcp-token-for-tests-0123456789abcdef';

const buyer = {
  email: 'buyer@example.com',
  familyName: '山田',
  givenName: '花子',
  postalCode: '150-0001',
  prefecture: '東京都',
  city: '渋谷区神宮前',
  addressLine1: '1-2-3',
  addressLine2: '',
  phone: '090-1234-5678',
  quantity: 1,
};

function seedProduct(): ProductRecord {
  const now = new Date();
  return {
    id: 'product-default-tray',
    sku: 'everyday-tray-01',
    name: orderSpec.product.name,
    edition: orderSpec.product.edition,
    description: orderSpec.product.description,
    unitAmount: orderSpec.product.unitAmount,
    currency: 'jpy',
    shippingAmount: orderSpec.shippingAmount,
    imageUrl: orderSpec.product.image,
    status: 'active',
    inventory: null,
    createdAt: now,
    updatedAt: now,
  };
}

function setup(options: { token?: string | undefined; allowPii?: boolean } = {}) {
  const stripe: StripeLike = {
    createCheckoutSession: vi.fn(async () => ({ id: 'cs_test_123', url: 'https://checkout.stripe.test/session' })),
    verifyWebhook: vi.fn(async () => ({ type: 'checkout.session.completed', paymentSessionId: 'cs_test_123' })),
  };
  const db = new MemoryCheckoutDatabase([seedProduct()]);
  const app = createCheckoutApp({
    db,
    stripe,
    orderSpec,
    secrets: {
      piiKey: createRandomBase64Key(),
      lookupPepper: 'test-pepper',
      webhookSecret: 'whsec_test',
      adminPasswordHash: 'pbkdf2$210000$invalid$invalid',
      adminSessionSecret: 'test-admin-session-secret',
      mcpToken: 'token' in options ? options.token : mcpToken,
    },
    appUrl: 'https://shop.example.com',
    mcpAllowPii: options.allowPii,
  });

  const call = (body: unknown, token: string | null = mcpToken) => app.request('/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const callTool = async (name: string, args: unknown = {}) => {
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    return response.json() as Promise<{ result: { content: Array<{ text: string }>; isError?: boolean }; error?: { code: number } }>;
  };

  const placeOrder = () => app.request('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify(buyer),
  });

  return { app, db, call, callTool, placeOrder };
}

describe('mcp endpoint', () => {
  it('stays hidden when no token is configured', async () => {
    const { call } = setup({ token: undefined });
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'initialize' }, null);
    expect(response.status).toBe(404);
  });

  it('rejects a missing or wrong bearer token', async () => {
    const { call } = setup();
    const anonymous = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toContain('Bearer');

    const wrong = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'mcp-token-for-tests-0123456789abcdee');
    expect(wrong.status).toBe(401);
  });

  it('completes the initialize handshake and lists tools', async () => {
    const { call } = setup();
    const handshake = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    await expect(handshake.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-06-18', serverInfo: { name: 'nano-checkout' } },
    });

    const notification = await call({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notification.status).toBe(202);

    const listed = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const body = await listed.json() as { result: { tools: Array<{ name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }> } };
    const names = body.result.tools.map((tool) => tool.name);
    expect(names).toContain('get_sales_summary');
    expect(names).toContain('mark_shipped');
    expect(body.result.tools.every((tool) => tool.inputSchema.type === 'object')).toBe(true);
    expect(body.result.tools.find((tool) => tool.name === 'list_orders')!.annotations.readOnlyHint).toBe(true);
  });

  it('reports sales through a tool call', async () => {
    const { callTool, placeOrder } = setup();
    await placeOrder();
    const body = await callTool('get_sales_summary');
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({ totalOrders: 1, pendingOrders: 1 });
  });

  it('redacts buyer details by default', async () => {
    const { callTool, placeOrder } = setup();
    await placeOrder();
    const body = await callTool('list_orders');
    const [order] = JSON.parse(body.result.content[0].text) as Array<Record<string, unknown>>;
    expect(order.buyer).toEqual({ familyName: '山田', email: 'b***@example.com', prefecture: '東京都' });
    expect(order.piiRedacted).toBe(true);
    expect(JSON.stringify(order)).not.toContain(buyer.phone);
    expect(JSON.stringify(order)).not.toContain(buyer.addressLine1);
  });

  it('returns full buyer details once the store opts in', async () => {
    const { callTool, placeOrder } = setup({ allowPii: true });
    await placeOrder();
    const body = await callTool('list_orders');
    const [order] = JSON.parse(body.result.content[0].text) as Array<{ buyer: Record<string, string> }>;
    expect(order.buyer).toMatchObject({ email: buyer.email, phone: buyer.phone, addressLine1: buyer.addressLine1 });
  });

  it('finds orders by exact email and ignores anything else', async () => {
    const { callTool, placeOrder } = setup();
    await placeOrder();
    const hit = await callTool('find_orders_by_email', { email: buyer.email });
    expect(JSON.parse(hit.result.content[0].text)).toHaveLength(1);
    const miss = await callTool('find_orders_by_email', { email: 'someone@example.com' });
    expect(JSON.parse(miss.result.content[0].text)).toHaveLength(0);
  });

  it('publishes a product and refuses to ship an unpaid order', async () => {
    const { app, callTool, placeOrder } = setup();
    const created = await callTool('create_product', {
      sku: 'mcp-pouch-01', name: 'Pouch', edition: '', description: '', unitAmount: 3200,
      currency: 'jpy', shippingAmount: 0, imageUrl: '/product-tray.svg', status: 'draft', inventory: 4,
    });
    const product = JSON.parse(created.result.content[0].text) as { id: string };
    expect((await app.request('/api/storefront/products/mcp-pouch-01')).status).toBe(404);

    await callTool('update_product', { productId: product.id, status: 'active', unitAmount: 3600 });
    const published = await app.request('/api/storefront/products/mcp-pouch-01');
    expect(published.status).toBe(200);
    await expect(published.json()).resolves.toMatchObject({ product: { unitAmount: 3600 } });

    const order = await placeOrder();
    const { orderId } = await order.json() as { orderId: string };
    const tooEarly = await callTool('mark_shipped', { orderId, shipped: true });
    expect(tooEarly.result.isError).toBe(true);
    expect(tooEarly.result.content[0].text).toContain('only paid orders');

    await app.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'test-signature' },
      body: JSON.stringify({ id: 'evt_test' }),
    });
    const shipped = await callTool('mark_shipped', { orderId, shipped: true, trackingNumber: 'TRACK-1' });
    expect(shipped.result.isError).toBeUndefined();
    expect(JSON.parse(shipped.result.content[0].text)).toMatchObject({ trackingNumber: 'TRACK-1' });
  });

  it('rejects unknown tools and invalid arguments', async () => {
    const { call, callTool } = setup();
    const unknown = await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_everything' } });
    await expect(unknown.json()).resolves.toMatchObject({ error: { code: -32602 } });

    const badArgs = await callTool('get_order', { orderId: '' });
    expect(badArgs.result.isError).toBe(true);

    const badMethod = await call({ jsonrpc: '2.0', id: 2, method: 'resources/list' });
    await expect(badMethod.json()).resolves.toMatchObject({ error: { code: -32601 } });
  });
});
