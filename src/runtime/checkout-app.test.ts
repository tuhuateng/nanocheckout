import { describe, expect, it, vi } from 'vitest';
import { orderSpec } from '../config/order-spec';
import { hashAdminPassword } from './admin-auth';
import { createCheckoutApp } from './checkout-app';
import { createRandomBase64Key } from './crypto';
import { MemoryCheckoutDatabase } from './memory-database';
import type { CheckoutDatabase, ProductRecord, StripeLike } from './types';

const validOrder = {
  email: 'buyer@example.com',
  familyName: '山田',
  givenName: '花子',
  postalCode: '150-0001',
  prefecture: '東京都',
  city: '渋谷区神宮前',
  addressLine1: '1-2-3',
  addressLine2: '',
  phone: '090-1234-5678',
  quantity: 2,
};

function createDefaultProduct(): ProductRecord {
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

async function loginAsAdmin(app: ReturnType<typeof createCheckoutApp>, password: string) {
  const login = await app.request('/api/admin/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return login.headers.get('set-cookie')!.split(';', 1)[0];
}

function setup(options: { adminPasswordHash?: string; db?: CheckoutDatabase; stripeFailure?: boolean } = {}) {
  const createCheckoutSession = vi.fn(async () => {
    if (options.stripeFailure) throw new Error('Stripe unavailable');
    return { id: 'cs_test_123', url: 'https://checkout.stripe.test/session' };
  });
  const stripe: StripeLike = {
    createCheckoutSession,
    verifyWebhook: vi.fn(async () => ({ type: 'checkout.session.completed', paymentSessionId: 'cs_test_123' })),
  };
  const db = options.db || new MemoryCheckoutDatabase([createDefaultProduct()]);
  const app = createCheckoutApp({
    db,
    stripe,
    orderSpec,
    secrets: {
      piiKey: createRandomBase64Key(),
      lookupPepper: 'test-pepper',
      webhookSecret: 'whsec_test',
      adminPasswordHash: options.adminPasswordHash || 'pbkdf2$210000$invalid$invalid',
      adminSessionSecret: 'test-admin-session-secret',
    },
    appUrl: 'https://shop.example.com',
  });
  return { app, db, createCheckoutSession };
}

describe('checkout app', () => {
  it('creates an order and calculates price from the server-side spec', async () => {
    const { app, createCheckoutSession } = setup();
    const response = await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ ...validOrder, unitAmount: 1 }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ checkoutUrl: 'https://checkout.stripe.test/session' });
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      quantity: 2,
      orderSpec: expect.objectContaining({ product: expect.objectContaining({ unitAmount: 4200 }) }),
    }));
  });

  it('rejects malformed buyer details', async () => {
    const { app, createCheckoutSession } = setup();
    const response = await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ ...validOrder, email: 'not-an-email', quantity: 99 }),
    });
    expect(response.status).toBe(422);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('accepts a verified Stripe webhook', async () => {
    const { app } = setup();
    const response = await app.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'test-signature' },
      body: JSON.stringify({ id: 'evt_test' }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
  });

  it('protects the merchant dashboard with a signed HttpOnly session', async () => {
    const adminPassword = 'admin-password-test';
    const { app } = setup({ adminPasswordHash: await hashAdminPassword(adminPassword, 100_000) });

    const unauthorized = await app.request('/api/admin/summary');
    expect(unauthorized.status).toBe(401);

    await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(validOrder),
    });

    const login = await app.request('/api/admin/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: adminPassword }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie')!;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');

    const cookie = setCookie.split(';', 1)[0];
    const summary = await app.request('/api/admin/summary', { headers: { cookie } });
    expect(summary.status).toBe(200);
    const body = await summary.json() as { stats: { totalOrders: number }; orders: Array<{ buyer: { email: string }; encryptedPii?: string }> };
    expect(body.stats.totalOrders).toBe(1);
    expect(body.orders[0].buyer.email).toBe(validOrder.email);
    expect(body.orders[0].encryptedPii).toBeUndefined();
  });

  it('uses the database product price and reserves inventory by SKU', async () => {
    const now = new Date();
    const product: ProductRecord = {
      id: 'product-test',
      sku: 'test-sku',
      name: 'Database Product',
      edition: 'Blue',
      description: 'From the product catalog',
      unitAmount: 9900,
      currency: 'jpy',
      shippingAmount: 500,
      imageUrl: '/product-tray.svg',
      status: 'active',
      inventory: 3,
      createdAt: now,
      updatedAt: now,
    };
    const database = new MemoryCheckoutDatabase([product]);
    const { app, createCheckoutSession } = setup({ db: database });
    const response = await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ ...validOrder, sku: product.sku }),
    });
    expect(response.status).toBe(201);
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      orderSpec: expect.objectContaining({
        product: expect.objectContaining({ name: product.name, unitAmount: 9900 }),
        shippingAmount: 500,
      }),
    }));
    await expect(database.getProductBySku(product.sku)).resolves.toMatchObject({ inventory: 1 });
  });

  it('creates and publishes products through authenticated admin APIs', async () => {
    const adminPassword = 'admin-product-password';
    const { app } = setup({ adminPasswordHash: await hashAdminPassword(adminPassword, 100_000) });
    const cookie = await loginAsAdmin(app, adminPassword);

    const create = await app.request('/api/admin/products', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        sku: 'new-product', name: 'New Product', edition: '', description: '', unitAmount: 1800,
        currency: 'jpy', shippingAmount: 0, imageUrl: '/product-tray.svg', status: 'draft', inventory: 10,
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { product: ProductRecord };

    const hidden = await app.request('/api/storefront/products/new-product');
    expect(hidden.status).toBe(404);

    const publish = await app.request(`/api/admin/products/${created.product.id}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    expect(publish.status).toBe(200);
    const published = await publish.json() as { product: ProductRecord };
    expect(published.product).toMatchObject({
      name: 'New Product',
      unitAmount: 1800,
      shippingAmount: 0,
      inventory: 10,
      status: 'active',
    });
    const visible = await app.request('/api/storefront/products/new-product');
    expect(visible.status).toBe(200);
  });

  it('returns reserved inventory when Stripe session creation fails', async () => {
    const now = new Date();
    const product: ProductRecord = {
      id: 'rollback-product', sku: 'rollback-sku', name: 'Rollback Product', edition: '', description: '',
      unitAmount: 2500, currency: 'jpy', shippingAmount: 0, imageUrl: '/product-tray.svg', status: 'active',
      inventory: 5, createdAt: now, updatedAt: now,
    };
    const database = new MemoryCheckoutDatabase([product]);
    const { app } = setup({ db: database, stripeFailure: true });
    const response = await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ ...validOrder, sku: product.sku }),
    });
    expect(response.status).toBe(502);
    await expect(database.getProductBySku(product.sku)).resolves.toMatchObject({ inventory: 5 });
  });

  it('keeps the LINE or app user id with the order for later notifications', async () => {
    const adminPassword = 'admin-channel-password';
    const { app } = setup({ adminPasswordHash: await hashAdminPassword(adminPassword, 100_000) });
    const lineUserId = 'U4af4980629a0f1d1a8b2c3d4e5f60718';
    const created = await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ ...validOrder, externalUserId: lineUserId }),
    });
    expect(created.status).toBe(201);
    const { orderId } = await created.json() as { orderId: string };

    const cookie = await loginAsAdmin(app, adminPassword);
    const detail = await app.request(`/api/admin/orders/${orderId}`, { headers: { cookie } });
    await expect(detail.json()).resolves.toMatchObject({ order: { externalUserId: lineUserId } });

    const exported = await app.request('/api/admin/orders.csv', { headers: { cookie } });
    expect(await exported.text()).toContain(lineUserId);
  });

  it('accepts an order without any external user id', async () => {
    const { app } = setup();
    const response = await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(validOrder),
    });
    expect(response.status).toBe(201);
  });

  it('refuses checkout when the catalog has no published product', async () => {
    const { app, createCheckoutSession } = setup({ db: new MemoryCheckoutDatabase() });
    const response = await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(validOrder),
    });
    expect(response.status).toBe(409);
    expect(createCheckoutSession).not.toHaveBeenCalled();
    const storefront = await app.request('/api/storefront/products');
    await expect(storefront.json()).resolves.toEqual({ products: [] });
  });

  it('records fulfillment only after the order is paid', async () => {
    const adminPassword = 'admin-fulfillment-pass';
    const { app } = setup({ adminPasswordHash: await hashAdminPassword(adminPassword, 100_000) });
    const created = await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(validOrder),
    });
    const { orderId } = await created.json() as { orderId: string };
    const cookie = await loginAsAdmin(app, adminPassword);

    const tooEarly = await app.request(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ shipped: true }),
    });
    expect(tooEarly.status).toBe(409);

    await app.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'test-signature' },
      body: JSON.stringify({ id: 'evt_test' }),
    });

    const shipped = await app.request(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ shipped: true, trackingNumber: '1234-5678' }),
    });
    expect(shipped.status).toBe(200);
    const body = await shipped.json() as { order: { shippedAt: string | null; trackingNumber: string | null; encryptedPii?: string } };
    expect(body.order.shippedAt).toBeTruthy();
    expect(body.order.trackingNumber).toBe('1234-5678');
    expect(body.order.encryptedPii).toBeUndefined();
  });

  it('exports orders as CSV for the authenticated merchant only', async () => {
    const adminPassword = 'admin-export-password';
    const { app } = setup({ adminPasswordHash: await hashAdminPassword(adminPassword, 100_000) });
    await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(validOrder),
    });

    const anonymous = await app.request('/api/admin/orders.csv');
    expect(anonymous.status).toBe(401);

    const cookie = await loginAsAdmin(app, adminPassword);
    const exported = await app.request('/api/admin/orders.csv', { headers: { cookie } });
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toContain('text/csv');
    const csv = await exported.text();
    expect(csv).toContain(validOrder.email);
    expect(csv).toContain('150-0001');
  });

  it('finds an older order by email through the server side search', async () => {
    const adminPassword = 'admin-search-password';
    const { app } = setup({ adminPasswordHash: await hashAdminPassword(adminPassword, 100_000) });
    await app.request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(validOrder),
    });
    const cookie = await loginAsAdmin(app, adminPassword);

    const hit = await app.request(`/api/admin/orders?q=${encodeURIComponent(validOrder.email)}`, { headers: { cookie } });
    await expect(hit.json()).resolves.toMatchObject({ orders: [{ buyer: { email: validOrder.email } }] });

    const miss = await app.request('/api/admin/orders?q=nobody@example.com', { headers: { cookie } });
    await expect(miss.json()).resolves.toEqual({ orders: [] });
  });

  it('blocks repeated failed admin logins', async () => {
    const adminPassword = 'admin-throttle-password';
    const { app } = setup({ adminPasswordHash: await hashAdminPassword(adminPassword, 100_000) });
    const attempt = (password: string) => app.request('/api/admin/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    for (let index = 0; index < 8; index += 1) {
      expect((await attempt('wrong-password')).status).toBe(401);
    }
    const blocked = await attempt('wrong-password');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();

    const correctButBlocked = await attempt(adminPassword);
    expect(correctButBlocked.status).toBe(429);
  });
});
