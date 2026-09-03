import { serve } from '@hono/node-server';
import { orderSpec } from '../src/config/order-spec';
import { hashAdminPassword } from '../src/runtime/admin-auth';
import { createCheckoutApp } from '../src/runtime/checkout-app';
import { createLookupDigest, createRandomBase64Key, encryptPii } from '../src/runtime/crypto';
import { MemoryCheckoutDatabase } from '../src/runtime/memory-database';
import { createPostgresDatabase } from '../src/runtime/postgres-database';
import { createDemoStripeClient, createStripeClient } from '../src/runtime/stripe';

const now = new Date();
const defaultProduct = {
  id: 'product-default-tray',
  sku: 'everyday-tray-01',
  name: orderSpec.product.name,
  edition: orderSpec.product.edition,
  description: orderSpec.product.description,
  unitAmount: orderSpec.product.unitAmount,
  currency: orderSpec.product.currency,
  shippingAmount: orderSpec.shippingAmount,
  imageUrl: orderSpec.product.image,
  status: 'active' as const,
  inventory: 24,
  createdAt: now,
  updatedAt: now,
};
const database = process.env.DATABASE_URL
  ? createPostgresDatabase(process.env.DATABASE_URL)
  : new MemoryCheckoutDatabase([defaultProduct]);
const stripe = process.env.STRIPE_SECRET_KEY
  ? createStripeClient(process.env.STRIPE_SECRET_KEY)
  : createDemoStripeClient();

const piiKey = process.env.CHECKOUT_PII_KEY || createRandomBase64Key();
const lookupPepper = process.env.CHECKOUT_LOOKUP_PEPPER || crypto.randomUUID();
const demoPassword = 'nano-demo-2026';
const mcpToken = process.env.MCP_TOKEN || 'nano-mcp-demo-token-2026';

if (!process.env.DATABASE_URL && database instanceof MemoryCheckoutDatabase) {
  const demoBuyers = [
    ['佐藤', '美咲', 'misaki@example.com', '東京都', '渋谷区代官山町', '12-4', '150-0034', 'paid', 2, 'U4af4980629a0f1d1a8b2c3d4e5f60718'],
    ['鈴木', '健太', 'kenta@example.com', '神奈川県', '横浜市中区山下町', '88-1', '231-0023', 'pending', 1, null],
    ['高橋', '陽子', 'yoko@example.com', '大阪府', '大阪市北区中之島', '3-2', '530-0005', 'paid', 1, 'U9b1c2d3e4f5061728394a5b6c7d8e9f0'],
    ['田中', '直樹', 'naoki@example.com', '京都府', '京都市中京区御池通', '6-8', '604-0000', 'cancelled', 3, null],
  ] as const;
  for (const [familyName, givenName, email, prefecture, city, addressLine1, postalCode, status, quantity, externalUserId] of demoBuyers) {
    const id = crypto.randomUUID();
    const buyer = { email, familyName, givenName, postalCode, prefecture, city, addressLine1, addressLine2: '', phone: '090-0000-0000', quantity };
    await database.createPendingOrder({
      id,
      idempotencyKey: `demo-${id}`,
      emailLookup: await createLookupDigest(email, lookupPepper),
      encryptedPii: await encryptPii(buyer, piiKey),
      quantity,
      unitAmount: orderSpec.product.unitAmount,
      shippingAmount: orderSpec.shippingAmount,
      totalAmount: orderSpec.product.unitAmount * quantity + orderSpec.shippingAmount,
      currency: orderSpec.product.currency,
      productId: defaultProduct.id,
      productName: defaultProduct.name,
      externalUserId,
    });
    await database.attachPaymentSession(id, `cs_demo_${id}`);
    if (status !== 'pending') await database.transitionPaymentSession(`cs_demo_${id}`, status);
  }
}

const app = createCheckoutApp({
  db: database,
  stripe,
  orderSpec,
  secrets: {
    piiKey,
    lookupPepper,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || await hashAdminPassword(demoPassword),
    adminSessionSecret: process.env.ADMIN_SESSION_SECRET || crypto.randomUUID(),
    mcpToken,
  },
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  adminDemoMode: !process.env.ADMIN_PASSWORD_HASH,
  mcpAllowPii: process.env.MCP_ALLOW_PII === 'true',
});

serve({ fetch: app.fetch, port: 8787 }, (info) => {
  console.log(`Nano Checkout API listening on http://localhost:${info.port}`);
  if (!process.env.STRIPE_SECRET_KEY) console.log('Stripe key not set — local checkout is running in demo mode.');
  if (!process.env.ADMIN_PASSWORD_HASH) console.log(`Admin demo: http://localhost:5173/admin/  password: ${demoPassword}`);
  console.log(`MCP endpoint: http://localhost:5173/api/mcp  token: ${mcpToken}`);
});
