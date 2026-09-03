import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import type { OrderSpec } from '../config/order-spec';
import { createAdminSession, verifyAdminPassword, verifyAdminSession } from './admin-auth';
import { createLookupDigest, decryptPii, encryptPii } from './crypto';
import { ProductUnavailableError, type AdminOrderRecord, type CheckoutDatabase, type CheckoutSecrets, type FulfillmentPatch, type OrderStatus, type ProductInput, type ProductRecord, type StripeLike } from './types';

const checkoutSchema = z.object({
  email: z.email().max(254),
  familyName: z.string().trim().min(1).max(80),
  givenName: z.string().trim().min(1).max(80),
  postalCode: z.string().trim().regex(/^[0-9０-９-]{7,8}$/),
  prefecture: z.string().trim().min(2).max(4),
  city: z.string().trim().min(1).max(120),
  addressLine1: z.string().trim().min(1).max(120),
  addressLine2: z.string().trim().max(120).default(''),
  phone: z.string().trim().min(8).max(30),
  quantity: z.number().int().min(1).max(5),
  sku: z.string().trim().min(2).max(64).optional(),
});

export type CheckoutAppDependencies = {
  db: CheckoutDatabase;
  stripe: StripeLike;
  orderSpec: OrderSpec;
  secrets: CheckoutSecrets;
  appUrl?: string;
  adminDemoMode?: boolean;
};

const adminLoginSchema = z.object({ password: z.string().min(1).max(256) });
const productSchema = z.object({
  sku: z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().trim().min(1).max(160),
  edition: z.string().trim().max(120),
  description: z.string().trim().max(2_000),
  unitAmount: z.number().int().min(0).max(100_000_000),
  currency: z.literal('jpy'),
  shippingAmount: z.number().int().min(0).max(100_000_000),
  imageUrl: z.string().trim().min(1).max(2_000).refine((value) => value.startsWith('/') || /^https:\/\//.test(value), '画像URLが正しくありません。'),
  status: z.enum(['active', 'draft', 'archived']),
  inventory: z.number().int().min(0).max(10_000_000).nullable(),
});
const fulfillmentSchema = z.object({
  shipped: z.boolean().optional(),
  trackingNumber: z.string().trim().max(120).nullable().optional(),
});
const validStatuses = new Set<OrderStatus>(['pending', 'paid', 'payment_failed', 'cancelled']);
const adminCookie = 'nano_admin_session';
const maxLoginFailures = 8;
const loginBlockMs = 15 * 60 * 1000;

export function createCheckoutApp(deps: CheckoutAppDependencies) {
  const app = new Hono();
  const loginFailures = new Map<string, { count: number; blockedUntil: number }>();
  app.use('*', secureHeaders());
  app.use('/api/admin/*', async (context, next) => {
    await next();
    context.header('cache-control', 'no-store, max-age=0');
    context.header('pragma', 'no-cache');
  });

  app.get('/api/health', (context) => context.json({ ok: true, service: 'nano-checkout' }));

  app.get('/api/storefront/products', async (context) => {
    const products = (await deps.db.listProducts()).filter((product) => product.status === 'active');
    return context.json({ products: products.map(toPublicProduct) });
  });

  app.get('/api/storefront/products/:sku', async (context) => {
    const product = await deps.db.getProductBySku(context.req.param('sku'));
    if (!product || product.status !== 'active') return context.json({ error: 'Product not found' }, 404);
    return context.json({ product: toPublicProduct(product) });
  });

  app.get('/api/admin/session', async (context) => {
    const authenticated = await verifyAdminSession(getCookie(context, adminCookie), deps.secrets.adminSessionSecret);
    return context.json({ authenticated, demoMode: Boolean(deps.adminDemoMode) });
  });

  app.post('/api/admin/session', async (context) => {
    const client = clientKey(context);
    const blockedFor = loginBlockRemaining(client);
    if (blockedFor > 0) {
      context.header('retry-after', String(Math.ceil(blockedFor / 1000)));
      return context.json({ error: '試行回数が上限に達しました。しばらくしてからお試しください。' }, 429);
    }

    let input: z.infer<typeof adminLoginSchema>;
    try {
      input = adminLoginSchema.parse(await context.req.json());
    } catch {
      return context.json({ error: 'パスワードを入力してください。' }, 400);
    }
    if (!(await verifyAdminPassword(input.password, deps.secrets.adminPasswordHash))) {
      recordLoginFailure(client);
      return context.json({ error: 'パスワードが正しくありません。' }, 401);
    }
    loginFailures.delete(client);
    const session = await createAdminSession(deps.secrets.adminSessionSecret);
    setCookie(context, adminCookie, session, {
      httpOnly: true,
      secure: new URL(context.req.url).protocol === 'https:',
      sameSite: 'Strict',
      path: '/',
      maxAge: 8 * 60 * 60,
    });
    return context.json({ authenticated: true });
  });

  app.delete('/api/admin/session', (context) => {
    deleteCookie(context, adminCookie, { path: '/', secure: new URL(context.req.url).protocol === 'https:' });
    return context.json({ authenticated: false });
  });

  app.get('/api/admin/summary', async (context) => {
    if (!(await isAdmin(context))) return context.json({ error: 'Unauthorized' }, 401);
    const [stats, orders] = await Promise.all([
      deps.db.getOrderStats(),
      deps.db.listOrders({ limit: 8 }),
    ]);
    return context.json({ stats, orders: await Promise.all(orders.map(toAdminResponse)) });
  });

  app.get('/api/admin/orders', async (context) => {
    if (!(await isAdmin(context))) return context.json({ error: 'Unauthorized' }, 401);
    const orders = await deps.db.listOrders(await buildOrderQuery(context, 50, 100));
    return context.json({ orders: await Promise.all(orders.map(toAdminResponse)) });
  });

  app.get('/api/admin/orders.csv', async (context) => {
    if (!(await isAdmin(context))) return context.json({ error: 'Unauthorized' }, 401);
    const orders = await deps.db.listOrders(await buildOrderQuery(context, 1_000, 5_000));
    const rows = await Promise.all(orders.map(async (order) => {
      const buyer = await decryptPii<Record<string, string>>(order.encryptedPii, deps.secrets.piiKey);
      return [
        order.id,
        order.status,
        order.shippedAt ? new Date(order.shippedAt).toISOString() : '',
        order.trackingNumber || '',
        new Date(order.createdAt).toISOString(),
        order.productName,
        String(order.quantity),
        String(order.totalAmount),
        order.currency,
        `${buyer.familyName || ''} ${buyer.givenName || ''}`.trim(),
        buyer.email || '',
        buyer.phone || '',
        buyer.postalCode || '',
        buyer.prefecture || '',
        buyer.city || '',
        buyer.addressLine1 || '',
        buyer.addressLine2 || '',
      ];
    }));
    const header = [
      '注文ID', 'ステータス', '発送日時', '追跡番号', '注文日時', '商品名', '数量', '合計金額', '通貨',
      'お名前', 'メール', '電話番号', '郵便番号', '都道府県', '市区町村', '番地', '建物名',
    ];
    const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n');
    const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    context.header('content-type', 'text/csv; charset=utf-8');
    context.header('content-disposition', `attachment; filename="${filename}"`);
    return context.body(`﻿${csv}`);
  });

  app.patch('/api/admin/orders/:id', async (context) => {
    if (!(await isAdmin(context))) return context.json({ error: 'Unauthorized' }, 401);
    let patch: z.infer<typeof fulfillmentSchema>;
    try {
      patch = fulfillmentSchema.parse(await context.req.json());
    } catch (error) {
      if (error instanceof z.ZodError) return context.json({ error: '入力内容を確認してください。', fields: z.flattenError(error).fieldErrors }, 422);
      return context.json({ error: 'JSON の形式が正しくありません。' }, 400);
    }
    if (patch.shipped === undefined && patch.trackingNumber === undefined) {
      return context.json({ error: '変更内容がありません。' }, 400);
    }

    const orderId = context.req.param('id');
    const current = await deps.db.getOrder(orderId);
    if (!current) return context.json({ error: 'Order not found' }, 404);
    if (patch.shipped === true && current.status !== 'paid') {
      return context.json({ error: '決済が完了した注文のみ発送済みにできます。' }, 409);
    }

    const fulfillment: FulfillmentPatch = {};
    if (patch.shipped !== undefined) fulfillment.shippedAt = patch.shipped ? new Date() : null;
    if (patch.trackingNumber !== undefined) fulfillment.trackingNumber = patch.trackingNumber || null;
    const updated = await deps.db.updateFulfillment(orderId, fulfillment);
    if (!updated) return context.json({ error: 'Order not found' }, 404);
    return context.json({ order: await toAdminResponse(updated) });
  });

  app.get('/api/admin/orders/:id', async (context) => {
    if (!(await isAdmin(context))) return context.json({ error: 'Unauthorized' }, 401);
    const order = await deps.db.getOrder(context.req.param('id'));
    if (!order) return context.json({ error: 'Order not found' }, 404);
    return context.json({ order: await toAdminResponse(order) });
  });

  app.get('/api/admin/products', async (context) => {
    if (!(await isAdmin(context))) return context.json({ error: 'Unauthorized' }, 401);
    return context.json({ products: await deps.db.listProducts({ includeArchived: true }) });
  });

  app.post('/api/admin/products', async (context) => {
    if (!(await isAdmin(context))) return context.json({ error: 'Unauthorized' }, 401);
    const parsed = await parseProductInput(context);
    if ('response' in parsed) return parsed.response;
    try {
      const product = await deps.db.createProduct({ id: crypto.randomUUID(), ...parsed.value });
      return context.json({ product }, 201);
    } catch (error) {
      if (isUniqueViolation(error)) return context.json({ error: 'この SKU はすでに使用されています。' }, 409);
      console.error('admin_product_create_failed', error instanceof Error ? error.message : error);
      return context.json({ error: '商品を作成できませんでした。' }, 500);
    }
  });

  app.patch('/api/admin/products/:id', async (context) => {
    if (!(await isAdmin(context))) return context.json({ error: 'Unauthorized' }, 401);
    let value: Partial<ProductInput>;
    try {
      value = productSchema.partial().parse(await context.req.json());
    } catch (error) {
      if (error instanceof z.ZodError) return context.json({ error: '入力内容を確認してください。', fields: z.flattenError(error).fieldErrors }, 422);
      return context.json({ error: 'JSON の形式が正しくありません。' }, 400);
    }
    if (Object.keys(value).length === 0) return context.json({ error: '変更内容がありません。' }, 400);
    try {
      const product = await deps.db.updateProduct(context.req.param('id'), value);
      if (!product) return context.json({ error: 'Product not found' }, 404);
      return context.json({ product });
    } catch (error) {
      if (isUniqueViolation(error)) return context.json({ error: 'この SKU はすでに使用されています。' }, 409);
      console.error('admin_product_update_failed', error instanceof Error ? error.message : error);
      return context.json({ error: '商品を更新できませんでした。' }, 500);
    }
  });

  app.post('/api/orders', async (context) => {
    const idempotencyKey = context.req.header('idempotency-key');
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      return context.json({ error: '有効な Idempotency-Key が必要です。' }, 400);
    }

    let input: z.infer<typeof checkoutSchema>;
    try {
      input = checkoutSchema.parse(await context.req.json());
    } catch (error) {
      if (error instanceof z.ZodError) {
        return context.json({ error: '入力内容を確認してください。', fields: z.flattenError(error).fieldErrors }, 422);
      }
      return context.json({ error: 'JSON の形式が正しくありません。' }, 400);
    }

    const selectedProduct = await resolveProduct(input.sku);
    if (!selectedProduct || selectedProduct.status !== 'active' || selectedProduct.inventory === 0) {
      return context.json({ error: 'この商品は現在購入できません。' }, 409);
    }
    const checkoutSpec: OrderSpec = {
      ...deps.orderSpec,
      product: {
        name: selectedProduct.name,
        edition: selectedProduct.edition,
        description: selectedProduct.description,
        unitAmount: selectedProduct.unitAmount,
        currency: selectedProduct.currency,
        image: selectedProduct.imageUrl,
      },
      shippingAmount: selectedProduct.shippingAmount,
    };
    const orderId = crypto.randomUUID();
    const totalAmount = selectedProduct.unitAmount * input.quantity + selectedProduct.shippingAmount;
    let persistedOrderId: string | undefined;
    try {
      const [encryptedPii, emailLookup] = await Promise.all([
        encryptPii(input, deps.secrets.piiKey),
        createLookupDigest(input.email, deps.secrets.lookupPepper),
      ]);
      const order = await deps.db.createPendingOrder({
        id: orderId,
        idempotencyKey,
        emailLookup,
        encryptedPii,
        quantity: input.quantity,
        unitAmount: selectedProduct.unitAmount,
        shippingAmount: selectedProduct.shippingAmount,
        totalAmount,
        currency: selectedProduct.currency,
        productId: selectedProduct.id,
        productName: selectedProduct.name,
      });
      persistedOrderId = order.id;

      const origin = deps.appUrl || new URL(context.req.url).origin;
      const session = await deps.stripe.createCheckoutSession({
        orderId: order.id,
        idempotencyKey,
        customerEmail: input.email,
        quantity: input.quantity,
        orderSpec: checkoutSpec,
        successUrl: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/?payment=cancelled`,
      });
      await deps.db.attachPaymentSession(order.id, session.id);
      return context.json({ orderId: order.id, checkoutUrl: session.url, product: toPublicProduct(selectedProduct) }, 201);
    } catch (error) {
      if (persistedOrderId) await deps.db.cancelPendingOrder(persistedOrderId).catch(() => undefined);
      if (error instanceof ProductUnavailableError) return context.json({ error: '在庫が不足しています。' }, 409);
      console.error('checkout_order_failed', error instanceof Error ? error.message : error);
      return context.json({ error: '決済を開始できませんでした。時間をおいて再度お試しください。' }, 502);
    }
  });

  app.post('/api/webhooks/stripe', async (context) => {
    const signature = context.req.header('stripe-signature');
    if (!signature || !deps.secrets.webhookSecret) return context.json({ error: 'Missing webhook signature' }, 400);
    const rawBody = await context.req.text();
    try {
      const event = await deps.stripe.verifyWebhook(rawBody, signature, deps.secrets.webhookSecret);
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        await deps.db.transitionPaymentSession(event.paymentSessionId, 'paid');
      } else if (event.type === 'checkout.session.async_payment_failed') {
        await deps.db.transitionPaymentSession(event.paymentSessionId, 'payment_failed');
      } else if (event.type === 'checkout.session.expired') {
        await deps.db.transitionPaymentSession(event.paymentSessionId, 'cancelled');
      }
      return context.json({ received: true });
    } catch (error) {
      console.warn('stripe_webhook_rejected', error instanceof Error ? error.message : error);
      return context.json({ error: 'Invalid webhook' }, 400);
    }
  });

  app.notFound((context) => context.json({ error: 'Not found' }, 404));
  return app;

  async function isAdmin(context: Parameters<typeof getCookie>[0]) {
    return verifyAdminSession(getCookie(context, adminCookie), deps.secrets.adminSessionSecret);
  }

  async function toAdminResponse(order: AdminOrderRecord) {
    const buyer = await decryptPii<Record<string, string | number>>(order.encryptedPii, deps.secrets.piiKey);
    const { encryptedPii: _, ...safeOrder } = order;
    return { ...safeOrder, buyer };
  }

  async function resolveProduct(sku?: string): Promise<ProductRecord | null> {
    if (sku) return deps.db.getProductBySku(sku);
    return (await deps.db.listProducts()).find((product) => product.status === 'active') || null;
  }

  async function buildOrderQuery(context: Parameters<typeof getCookie>[0], fallbackLimit: number, maxLimit: number) {
    const rawStatus = context.req.query('status');
    const status = rawStatus && validStatuses.has(rawStatus as OrderStatus) ? rawStatus as OrderStatus : undefined;
    const rawLimit = Number(context.req.query('limit') || fallbackLimit);
    const limit = Math.min(maxLimit, Math.max(1, Number.isInteger(rawLimit) ? rawLimit : fallbackLimit));

    const search = (context.req.query('q') || '').trim();
    if (!search) return { limit, status };
    if (search.includes('@')) {
      return { limit, status, emailLookup: await createLookupDigest(search, deps.secrets.lookupPepper) };
    }
    const idPrefix = search.toLowerCase().replace(/[^0-9a-f-]/g, '');
    return idPrefix ? { limit, status, idPrefix } : { limit, status };
  }

  function clientKey(context: Parameters<typeof getCookie>[0]) {
    return context.req.header('cf-connecting-ip')
      || context.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';
  }

  function loginBlockRemaining(client: string) {
    const entry = loginFailures.get(client);
    if (!entry) return 0;
    if (entry.blockedUntil <= Date.now()) {
      loginFailures.delete(client);
      return 0;
    }
    return entry.count >= maxLoginFailures ? entry.blockedUntil - Date.now() : 0;
  }

  function recordLoginFailure(client: string) {
    const now = Date.now();
    for (const [key, entry] of loginFailures) {
      if (entry.blockedUntil <= now) loginFailures.delete(key);
    }
    const entry = loginFailures.get(client) || { count: 0, blockedUntil: 0 };
    entry.count += 1;
    entry.blockedUntil = now + loginBlockMs;
    loginFailures.set(client, entry);
  }

  function toPublicProduct(product: ProductRecord) {
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      edition: product.edition,
      description: product.description,
      unitAmount: product.unitAmount,
      currency: product.currency,
      shippingAmount: product.shippingAmount,
      imageUrl: product.imageUrl,
      available: product.status === 'active' && product.inventory !== 0,
    };
  }

  async function parseProductInput(context: Parameters<typeof getCookie>[0]): Promise<{ value: ProductInput } | { response: Response }> {
    try {
      return { value: productSchema.parse(await context.req.json()) };
    } catch (error) {
      if (error instanceof z.ZodError) return { response: context.json({ error: '入力内容を確認してください。', fields: z.flattenError(error).fieldErrors }, 422) };
      return { response: context.json({ error: 'JSON の形式が正しくありません。' }, 400) };
    }
  }

  function escapeCsv(value: string) {
    const normalized = value.replace(/\r?\n/g, ' ');
    const guarded = /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
    return `"${guarded.replaceAll('"', '""')}"`;
  }

  function isUniqueViolation(error: unknown) {
    if (!(error instanceof Error)) return false;
    return error.message.includes('SKU already exists') || (error as Error & { code?: string }).code === '23505';
  }
}
