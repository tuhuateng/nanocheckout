# Nano Checkout

[日本語](README.md) | [简体中文](README.zh-CN.md) | **English**

A headless checkout backend for LINE mini apps and native apps.

The Shopify and Wix checkouts cannot be embedded inside an app; sending the buyer out to a browser breaks the purchase there and then. Nano Checkout returns nothing but an order id and a Stripe payment URL, so a LINE LIFF page or an iOS / Android app can create orders without leaving its own screens. Selling physical goods does not require in-app purchase, so an app can run its own payment flow.

- Orders can carry a LINE user id or your app's own user id, so shipping notices go out over LINE or push instead of email
- Built for Japan: yen pricing, prefecture address form, and the legal terms page required by the Act on Specified Commercial Transactions
- Product, order and fulfillment management screens included
- Hono for the API, Postgres for storage, Stripe Hosted Checkout for payments

The bundled React storefront is one reference client; you do not need it if you only sell through your own app. The iOS (Swift) and LINE LIFF examples are in sections 4 and 5 of [docs/API.md](docs/API.md) (Chinese).

## Run locally

Node.js 20 or newer is required.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. With no environment variables set, the app starts with an in-memory database and demo payments, so you can try the UI and order flow right away.

Product data lives in the Postgres table `checkout_products` and is edited from the admin panel. The initial product is seeded by the migrations. When no product is published, the storefront shows an unavailable state and the order endpoint returns `409`.

`src/config/order-spec.ts` holds the store name and the content of the legal terms page required by the Japanese Act on Specified Commercial Transactions. **The seller name, the person in charge, the address and the phone number are placeholders. Replace them with the real details of the selling business before going live.**

## Production environment variables

See `.env.example` and register the following as secrets on your platform. Never commit the values.

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CHECKOUT_PII_KEY` — generate once with `openssl rand -base64 32`. Changing it makes existing PII undecryptable.
- `CHECKOUT_LOOKUP_PEPPER` — generate with `openssl rand -hex 32`.
- `ADMIN_PASSWORD_HASH` — the output of `npm run admin:hash -- "a-long-password"`.
- `ADMIN_SESSION_SECRET` — generate with `openssl rand -hex 32` (at least 32 characters).
- `APP_URL` — e.g. `https://shop.example.com`
- `DATABASE_URL` — not needed when using Cloudflare Hyperdrive.
- `MCP_TOKEN` — optional. Setting it enables the MCP endpoint for AI clients. Generate with `openssl rand -hex 32` (at least 32 characters).

Create the tables either by running the SQL files in `migrations/` in numeric order (`0000_checkout_orders.sql` → `0001_checkout_products.sql` → `0002_order_fulfillment.sql` → `0003_order_external_user.sql`) in a SQL editor, or by setting `DIRECT_URL` and running `npm run db:push`.

## Cloudflare Pages + Hyperdrive (recommended)

1. Connect the repository to Cloudflare Pages with build command `npm run build` and output directory `dist`.
2. Create a Postgres database on Neon, Supabase, or your own host. On Supabase pick the Tokyo region, use the transaction pooler on port 6543 for the production `DATABASE_URL`, and port 5432 for the migration `DIRECT_URL`.
3. Create a Hyperdrive configuration.

   ```bash
   npx wrangler hyperdrive create nano-checkout-db --connection-string="postgres://..."
   ```

4. Use the returned ID to enable the `[[hyperdrive]]` section in `wrangler.toml`. Alternatively add a binding named `HYPERDRIVE` under Settings → Bindings in Pages.
5. Register the secrets above under Settings → Variables and Secrets in Pages, then deploy.
6. In Stripe Workbench, register `https://your-domain/api/webhooks/stripe` as a webhook endpoint and select these events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`

`public/_routes.json` restricts the Worker to `/api/*`. The `/confirm/` page is generated from `OrderSpec` at build time and served as a static asset, so it does not consume Worker invocations.

> Supabase Free pauses inactive projects. A store that takes real orders should use a paid plan, Neon, or self-hosted Postgres with monitoring.

## Admin panel

`/admin/` provides order management: revenue and order counts, filtering by payment status, order search, and decrypted buyer and shipping details. The admin session is stored in a signed `HttpOnly`, `SameSite=Strict` cookie, and the password is configured only as a PBKDF2 hash. After 8 consecutive failed logins a source IP is blocked for 15 minutes. The counter lives in the memory of the running instance, so add an edge rate limit on Cloudflare when you run more than one instance.

When `ADMIN_PASSWORD_HASH` is not set locally, a demo admin panel is enabled at `http://localhost:5173/admin/` with password `nano-demo-2026`. The production adapters never enable this default password and refuse to start if any admin environment variable is missing.

### Fulfillment

Shipping progress is recorded from the order detail drawer:

- Mark a paid order as shipped, which stores the shipping timestamp. This can be undone.
- Save a tracking number.
- Export the order list as CSV, written with a UTF-8 BOM so Japanese text opens correctly in Excel.

Buyer names are stored encrypted and cannot be queried in the database. The search box sends email addresses and order ids to the server and filters names within the loaded page.

### Product management

The "Products" section of the admin panel supports:

- Creating and editing products
- SKU, name, edition, description, price and shipping fee
- Limited or unlimited inventory
- Draft, active and archived statuses
- One-click publish/unpublish and storefront preview

Public clients can call:

```http
GET /api/storefront/products
GET /api/storefront/products/:sku
```

On the web, `/?product=SKU` previews a specific product. iOS, Android and LINE create orders with the same SKU:

```json
{
  "sku": "everyday-tray-01",
  "quantity": 1,
  "email": "buyer@example.com",
  "familyName": "山田",
  "givenName": "花子",
  "postalCode": "150-0001",
  "prefecture": "東京都",
  "city": "渋谷区神宮前",
  "addressLine1": "1-2-3",
  "addressLine2": "",
  "phone": "090-0000-0000"
}
```

The server looks up the price by SKU and reserves inventory. Any amount sent by the client is ignored. Inventory is released automatically when Stripe Session creation fails or the session expires.

## Running the store from an AI (MCP)

Connect Claude, or any other MCP client, straight to the merchant tools to check sales, change prices and inventory, and record shipments in conversation.

Setting `MCP_TOKEN` enables `POST /api/mcp`. Without it that URL returns 404 and the feature is off entirely.

```bash
claude mcp add --transport http nano-checkout https://shop.example.com/api/mcp \
  --header "Authorization: Bearer $MCP_TOKEN"
```

Eight tools are exposed: sales summary, order list, order lookup by email, order detail, product list, create product, update product, and record shipment. Creating orders, refunds and deletions are deliberately left out, so an AI on this connection cannot charge a card or remove anything irreversibly. The writing tools share their validation schema with the admin REST API.

Buyer details are redacted by default: family name, a masked email address, and the prefecture. Set `MCP_ALLOW_PII=true` when the AI genuinely needs full shipping details, knowing that addresses and phone numbers then enter the AI vendor's context and logs.

The protocol details and the full tool reference are in section 11 of [docs/API.md](docs/API.md) (Chinese).

## Vercel / Netlify

Both set `DATABASE_URL` to a pooled Postgres connection string. Vercel loads `api/index.ts` and Netlify loads `netlify/functions/checkout.ts`; both call the same `createCheckoutApp()`.

- Vercel: import the repository as usual, including `vercel.json`
- Netlify: import the repository as usual, including `netlify.toml`

Vercel Hobby is not intended for commercial use. Pick a plan that matches the terms of service if you sell through it.

## Security boundaries

- Product prices and shipping fees are computed from server-side data. Amounts sent by the browser are never trusted.
- Buyer information is stored encrypted with AES-256-GCM. The email lookup value is one-way hashed with HMAC-SHA256.
- Stripe webhooks are verified with Web Crypto, including the signature and a 5-minute timestamp tolerance.
- Order creation is protected against duplicate execution by an idempotency key.
- Card details are handled only by Stripe Hosted Checkout.

## Commands

```bash
npm run typecheck  # TypeScript
npm test           # unit and API tests
npm run build      # Vite build + static confirmation page
npm run cf:dev     # run Cloudflare Pages locally
```

## License

Apache License 2.0. Copyright 2026 株式会社MIIMOO.

Commercial use, modification and redistribution are permitted. Ship `LICENSE` and `NOTICE` with any distribution and state the changes you made. The license grants no rights to the "MIIMOO" or "株式会社MIIMOO" names and trademarks.
