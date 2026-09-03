# Nano Checkout API reference

[日本語](API.md) | **English**

The API implemented by the Hono app in this repository, for Web, iOS, Android and LINE LIFF clients.

## 1. Basics

| Environment | Base URL |
| --- | --- |
| Local (through the Vite proxy) | `http://localhost:5173/api` |
| Local (API directly) | `http://localhost:8787/api` |
| Production | `https://shop.example.com/api` |

- Requests and responses are UTF-8 JSON, except the Stripe webhook.
- Amounts are integers in the smallest unit of the Japanese yen: `4200` means `¥4,200`.
- Timestamps are ISO 8601, for example `2026-09-02T10:02:57.765Z`.
- There is no `/v1` prefix. Once third-party clients exist, add a new version path rather than changing what an existing field means.
- Production requires HTTPS. App Transport Security on iOS demands a secure connection by default too.

### Error format

```json
{
  "error": "What went wrong"
}
```

Validation failures also return `fields`:

```json
{
  "error": "入力内容を確認してください。",
  "fields": {
    "email": ["Invalid email address"],
    "quantity": ["Too big: expected number to be <=5"]
  }
}
```

## 2. Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | none | Health check |
| `GET` | `/api/storefront/products` | none | Products on sale |
| `GET` | `/api/storefront/products/:sku` | none | One product |
| `POST` | `/api/orders` | `Idempotency-Key` | Create an order and a Stripe Checkout session |
| `POST` | `/api/webhooks/stripe` | Stripe signature | Receive payment status |
| `POST` | `/api/mcp` | Bearer token | MCP endpoint for AI clients |
| `GET` | `/api/admin/session` | none | Read login state |
| `POST` | `/api/admin/session` | Admin password | Log in |
| `DELETE` | `/api/admin/session` | Cookie | Log out |
| `GET` | `/api/admin/summary` | Admin cookie | Dashboard summary |
| `GET` | `/api/admin/orders` | Admin cookie | Search orders |
| `GET` | `/api/admin/orders.csv` | Admin cookie | Export orders as CSV |
| `GET` | `/api/admin/orders/:id` | Admin cookie | One order |
| `PATCH` | `/api/admin/orders/:id` | Admin cookie | Update fulfillment |
| `GET` | `/api/admin/products` | Admin cookie | All products |
| `POST` | `/api/admin/products` | Admin cookie | Create a product |
| `PATCH` | `/api/admin/products/:id` | Admin cookie | Update a product |

## 3. Public endpoints

### 3.1 Health check

```http
GET /api/health
```

Response `200`:

```json
{
  "ok": true,
  "service": "nano-checkout"
}
```

### 3.2 Product list

Returns only products with status `active`. Actual stock levels are never exposed publicly, only whether the product can be bought.

```http
GET /api/storefront/products
```

Response `200`:

```json
{
  "products": [
    {
      "id": "product-default-tray",
      "sku": "everyday-tray-01",
      "name": "Everyday Carry Tray",
      "edition": "Sand / Edition 01",
      "description": "玄関やデスクの小物を静かに整える、植物由来素材のミニトレイ。",
      "unitAmount": 4200,
      "currency": "jpy",
      "shippingAmount": 0,
      "imageUrl": "/product-tray.svg",
      "available": true
    }
  ]
}
```

### 3.3 One product

```http
GET /api/storefront/products/{sku}
```

Example:

```bash
curl https://shop.example.com/api/storefront/products/everyday-tray-01
```

Response `200`:

```json
{
  "product": {
    "id": "product-default-tray",
    "sku": "everyday-tray-01",
    "name": "Everyday Carry Tray",
    "edition": "Sand / Edition 01",
    "description": "玄関やデスクの小物を静かに整える、植物由来素材のミニトレイ。",
    "unitAmount": 4200,
    "currency": "jpy",
    "shippingAmount": 0,
    "imageUrl": "/product-tray.svg",
    "available": true
  }
}
```

A product that does not exist, is unpublished, or is archived returns `404`:

```json
{ "error": "Product not found" }
```

### 3.4 Create an order

The server reads the price and shipping fee from the SKU, reserves inventory, and creates a Stripe Hosted Checkout session. Any amount the client sends is ignored.

```http
POST /api/orders
Content-Type: application/json
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

`Idempotency-Key` must be 16–128 characters. Generate one UUID per purchase attempt; reuse the same value when retrying after a network timeout, and use a fresh one for a new purchase.

Request fields:

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `sku` | string | recommended | 2–64 characters. Omitted, the first product on sale is used |
| `quantity` | integer | yes | 1–5 |
| `email` | string | yes | Valid email, up to 254 characters |
| `familyName` | string | yes | 1–80 characters |
| `givenName` | string | yes | 1–80 characters |
| `postalCode` | string | yes | 7–8 characters of digits (half or full width) and hyphens, e.g. `150-0001` |
| `prefecture` | string | yes | Japanese prefecture, 2–4 characters |
| `city` | string | yes | Ward and municipality, 1–120 characters |
| `addressLine1` | string | yes | Street and house number, 1–120 characters |
| `addressLine2` | string | no | Building and room, up to 120 characters, defaults to an empty string |
| `phone` | string | yes | 8–30 characters |
| `externalUserId` | string | no | 1–128 characters. A LINE user id or your app's own user id |

Request example:

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
  "addressLine2": "KINUビル 201",
  "phone": "090-1234-5678",
  "externalUserId": "U4af4980629a0f1d1a8b2c3d4e5f60718"
}
```

`externalUserId` ties the order to your own users. A LINE mini app passes the `userId` from `liff.getProfile()`; a native app passes its own user id. At fulfillment you use it to reach the buyer over the LINE Messaging API or a push notification. In Japan that lands far more reliably than email. Leave it out and it stores as `null`, which does not affect the order.

The value is stored in plain text in the `external_user_id` column and indexed, because orders have to be looked up by it. Unlike the rest of the buyer details, it is not encrypted.

Response `201`:

```json
{
  "orderId": "98d865f6-0208-4712-8593-c70839c63a83",
  "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_live_...",
  "product": {
    "id": "product-default-tray",
    "sku": "everyday-tray-01",
    "name": "Everyday Carry Tray",
    "edition": "Sand / Edition 01",
    "description": "玄関やデスクの小物を静かに整える、植物由来素材のミニトレイ。",
    "unitAmount": 4200,
    "currency": "jpy",
    "shippingAmount": 0,
    "imageUrl": "/product-tray.svg",
    "available": true
  }
}
```

Send the buyer to `checkoutUrl`. Card details go only to Stripe and never pass through this API.

Status codes:

| Code | Situation |
| --- | --- |
| `201` | Created |
| `400` | Missing or malformed `Idempotency-Key`, or invalid JSON |
| `409` | Product unpublished, sold out, out of stock from a concurrent purchase, or no product on sale at all |
| `422` | Recipient, address or quantity failed validation |
| `502` | Stripe session creation failed; reserved inventory is released automatically |

cURL example:

```bash
curl -X POST https://shop.example.com/api/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
  -d '{
    "sku":"everyday-tray-01",
    "quantity":1,
    "email":"buyer@example.com",
    "familyName":"山田",
    "givenName":"花子",
    "postalCode":"150-0001",
    "prefecture":"東京都",
    "city":"渋谷区神宮前",
    "addressLine1":"1-2-3",
    "addressLine2":"",
    "phone":"090-1234-5678"
  }'
```

## 4. Using it from iOS

Never ship a Stripe secret key inside an iOS app. The app calls the Nano Checkout API and opens the returned `checkoutUrl` in the system browser. Selling physical goods does not require in-app purchase, which is what makes this possible.

```swift
import Foundation
import UIKit

struct StoreProduct: Decodable {
    let id: String
    let sku: String
    let name: String
    let edition: String
    let description: String
    let unitAmount: Int
    let currency: String
    let shippingAmount: Int
    let imageUrl: String
    let available: Bool
}

struct ProductListResponse: Decodable {
    let products: [StoreProduct]
}

struct CheckoutRequest: Encodable {
    let sku: String
    let quantity: Int
    let email: String
    let familyName: String
    let givenName: String
    let postalCode: String
    let prefecture: String
    let city: String
    let addressLine1: String
    let addressLine2: String
    let phone: String
    let externalUserId: String?
}

struct CheckoutResponse: Decodable {
    let orderId: String
    let checkoutUrl: URL
    let product: StoreProduct
}

enum CheckoutAPI {
    static let baseURL = URL(string: "https://shop.example.com/api")!

    static func products() async throws -> [StoreProduct] {
        let url = baseURL.appending(path: "storefront/products")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response)
        return try JSONDecoder().decode(ProductListResponse.self, from: data).products
    }

    static func createOrder(_ body: CheckoutRequest, idempotencyKey: UUID) async throws -> CheckoutResponse {
        let url = baseURL.appending(path: "orders")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey.uuidString, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, expectedStatus: 201)
        return try JSONDecoder().decode(CheckoutResponse.self, from: data)
    }

    private static func validate(_ response: URLResponse, expectedStatus: Int = 200) throws {
        guard let http = response as? HTTPURLResponse,
              http.statusCode == expectedStatus else {
            throw URLError(.badServerResponse)
        }
    }
}

@MainActor
func startCheckout(_ input: CheckoutRequest) async throws {
    // Reuse this UUID for the same purchase if the request times out.
    let operationID = UUID()
    let checkout = try await CheckoutAPI.createOrder(input, idempotencyKey: operationID)
    await UIApplication.shared.open(checkout.checkoutUrl)
}
```

After payment Stripe redirects to `${APP_URL}/success?session_id=...`. To return to the app automatically, point `APP_URL` at an HTTPS domain with Universal Links configured and give the `/success` page a way back into the app. Treat the Stripe webhook as the source of truth for payment; never conclude a payment succeeded from the client return page alone.

Pass your app's user id as `externalUserId` and you can push a shipping notification to that user later.

## 5. Using it from LINE LIFF or the web

Send the LINE `userId` along with the order and it binds the order to that LINE user, so you can message them directly when it ships.

```js
await liff.init({ liffId: 'YOUR_LIFF_ID' });
if (!liff.isLoggedIn()) liff.login();

const profile = await liff.getProfile();
const operationId = crypto.randomUUID();

const response = await fetch('/api/orders', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'idempotency-key': operationId,
  },
  body: JSON.stringify({ ...checkoutForm, externalUserId: profile.userId }),
});

const result = await response.json();
if (!response.ok) throw new Error(result.error || 'Checkout failed');
location.assign(result.checkoutUrl);
```

Stripe returns the buyer to `${APP_URL}/success`. Inside LIFF that page can call `liff.closeWindow()` to close the webview and drop back into the chat.

For the shipping notice: after marking the order shipped in the admin panel, use the order's `externalUserId` with a LINE Messaging API push message. This repository contains no Messaging API code — the Channel Access Token belongs to your own LINE official account, so wire it up as you need.

The service is designed to be served same-origin and opens CORS to no arbitrary origin. If the LIFF page lives on a different domain from the API, reach it through a same-origin proxy or add a strict origin allowlist on the server. Never open the admin endpoints with `*`.

## 6. Stripe webhook

Only Stripe calls this endpoint. Regular clients must not.

```http
POST /api/webhooks/stripe
Stripe-Signature: t=...,v1=...
Content-Type: application/json
```

The server verifies the signature against the raw request body, `STRIPE_WEBHOOK_SECRET`, and a five-minute timestamp tolerance.

Handled events:

| Stripe event | Order status |
| --- | --- |
| `checkout.session.completed` | `paid` |
| `checkout.session.async_payment_succeeded` | `paid` |
| `checkout.session.async_payment_failed` | `payment_failed` |
| `checkout.session.expired` | `cancelled`, inventory released |

Response `200`:

```json
{ "received": true }
```

A missing or invalid signature returns `400`.

## 7. Admin authentication

Admin endpoints use a signed HttpOnly cookie `nano_admin_session`, not a bearer token. In production the cookie carries:

- `HttpOnly`
- `Secure`
- `SameSite=Strict`
- An 8-hour lifetime

### 7.1 Read login state

```http
GET /api/admin/session
```

```json
{
  "authenticated": false,
  "demoMode": false
}
```

### 7.2 Log in

```http
POST /api/admin/session
Content-Type: application/json
```

```json
{ "password": "your admin password" }
```

Success returns `200` and writes the session with `Set-Cookie`:

```json
{ "authenticated": true }
```

A wrong password returns `401`. After 8 consecutive failures from one source IP, that IP is blocked for 15 minutes and gets `429` with a `Retry-After` header even for the correct password. The counter lives in the memory of the running instance, so add an edge rate limit on Cloudflare when running more than one instance.

The local demo password is `nano-demo-2026`. Production must set your own password hash through `ADMIN_PASSWORD_HASH`.

### 7.3 Log out

```http
DELETE /api/admin/session
```

```json
{ "authenticated": false }
```

Logging in and calling an admin endpoint with cURL:

```bash
curl -c admin-cookie.txt \
  -H 'Content-Type: application/json' \
  -d '{"password":"your-admin-password"}' \
  https://shop.example.com/api/admin/session

curl -b admin-cookie.txt https://shop.example.com/api/admin/summary
```

## 8. Admin order endpoints

Without a session, every endpoint below returns `401`:

```json
{ "error": "Unauthorized" }
```

### 8.1 Dashboard summary

```http
GET /api/admin/summary
```

Returns the counters and the 8 most recent orders:

```json
{
  "stats": {
    "totalOrders": 4,
    "todayOrders": 4,
    "pendingOrders": 1,
    "paidOrders": 2,
    "paidGross": 12600
  },
  "orders": []
}
```

### 8.2 Search orders

```http
GET /api/admin/orders?status=paid&limit=50&q=buyer@example.com
```

Query parameters:

| Parameter | Description |
| --- | --- |
| `status` | Optional: `pending`, `paid`, `payment_failed`, `cancelled` |
| `limit` | 1–100, default 50. Values outside the range are clamped |
| `q` | Optional. Containing `@` it matches the email exactly, otherwise it matches an order id prefix |

Buyer names live in an encrypted field and cannot be queried in the database, so `q` covers only email addresses and order ids. On top of that, the admin panel filters the page it has already loaded by name.

Response `200`:

```json
{
  "orders": [
    {
      "id": "98d865f6-0208-4712-8593-c70839c63a83",
      "status": "paid",
      "paymentSessionId": "cs_live_...",
      "quantity": 1,
      "unitAmount": 4200,
      "shippingAmount": 0,
      "totalAmount": 4200,
      "currency": "jpy",
      "productId": "product-default-tray",
      "productName": "Everyday Carry Tray",
      "shippedAt": "2026-09-02T11:20:00.000Z",
      "trackingNumber": "YAMATO-8899-0011",
      "externalUserId": "U4af4980629a0f1d1a8b2c3d4e5f60718",
      "createdAt": "2026-09-02T10:02:57.765Z",
      "updatedAt": "2026-09-02T10:03:10.000Z",
      "buyer": {
        "email": "buyer@example.com",
        "familyName": "山田",
        "givenName": "花子",
        "postalCode": "150-0001",
        "prefecture": "東京都",
        "city": "渋谷区神宮前",
        "addressLine1": "1-2-3",
        "addressLine2": "",
        "phone": "090-1234-5678",
        "quantity": 1,
        "sku": "everyday-tray-01"
      }
    }
  ]
}
```

`buyer` is decrypted on the server after the admin session is verified. The stored `encryptedPii` never appears in a response.

### 8.3 One order

```http
GET /api/admin/orders/{orderId}
```

Response shape:

```json
{ "order": { "id": "...", "status": "paid", "buyer": {} } }
```

An unknown order returns `404`.

### 8.4 Update fulfillment

```http
PATCH /api/admin/orders/{orderId}
Content-Type: application/json
```

Request fields:

| Field | Type | Rules |
| --- | --- | --- |
| `shipped` | boolean | Optional. `true` records the current time as the shipping time, `false` clears it |
| `trackingNumber` | string/null | Optional. Up to 120 characters. `null` or an empty string clears it |

Marking an order shipped:

```json
{ "shipped": true, "trackingNumber": "YAMATO-8899-0011" }
```

Success returns `200` and the whole updated order, in the same shape as the order detail. An empty object returns `400`, an unknown order `404`, and a validation failure `422`.

Sending `shipped: true` for an order whose status is not `paid` returns `409`:

```json
{ "error": "決済が完了した注文のみ発送済みにできます。" }
```

That restriction applies only to marking an order shipped. Clearing the shipped state and saving a tracking number on its own work regardless of order status.

### 8.5 Export orders as CSV

```http
GET /api/admin/orders.csv?status=paid&limit=1000
```

The parameters match the order search. `limit` defaults to 1000 and caps at 5000. The response is `text/csv; charset=utf-8` with a UTF-8 BOM so Excel reads Japanese correctly, and a `Content-Disposition` header to prompt a download.

Columns in order: order id, status, shipped at, tracking number, external user id, created at, product name, quantity, total amount, currency, name, email, phone, postal code, prefecture, city, address line 1, address line 2.

Every value is quoted, and values starting with `=`, `+`, `-` or `@` get a leading apostrophe so a spreadsheet cannot execute them as formulas. The file contains decrypted personal data — handle it under your own data policy.

## 9. Admin product endpoints

### 9.1 All products

```http
GET /api/admin/products
```

Unlike the public endpoint, this includes draft and archived products and the stock level.

```json
{
  "products": [
    {
      "id": "product-default-tray",
      "sku": "everyday-tray-01",
      "name": "Everyday Carry Tray",
      "edition": "Sand / Edition 01",
      "description": "Product description",
      "unitAmount": 4200,
      "currency": "jpy",
      "shippingAmount": 0,
      "imageUrl": "/product-tray.svg",
      "status": "active",
      "inventory": 20,
      "createdAt": "2026-09-02T10:02:57.756Z",
      "updatedAt": "2026-09-02T10:02:57.765Z"
    }
  ]
}
```

### 9.2 Create a product

```http
POST /api/admin/products
Content-Type: application/json
```

Request fields:

| Field | Type | Rules |
| --- | --- | --- |
| `sku` | string | 2–64 characters of lowercase letters, digits, dots, underscores and hyphens; globally unique |
| `name` | string | 1–160 characters |
| `edition` | string | Required, may be empty, up to 120 characters |
| `description` | string | Required, may be empty, up to 2,000 characters |
| `unitAmount` | integer | 0–100,000,000 |
| `currency` | string | Currently `jpy` only |
| `shippingAmount` | integer | 0–100,000,000 |
| `imageUrl` | string | A site path starting with `/`, or an HTTPS URL |
| `status` | string | `active`, `draft` or `archived` |
| `inventory` | integer/null | 0–10,000,000; `null` means unlimited |

Request example:

```json
{
  "sku": "travel-pouch-01",
  "name": "Travel Pouch",
  "edition": "Olive / Edition 02",
  "description": "軽量なトラベルポーチ。",
  "unitAmount": 6800,
  "currency": "jpy",
  "shippingAmount": 300,
  "imageUrl": "https://cdn.example.com/travel-pouch.jpg",
  "status": "draft",
  "inventory": 8
}
```

Success returns `201` and the created `product`. A duplicate SKU returns `409` and a validation failure `422`.

### 9.3 Update a product

```http
PATCH /api/admin/products/{productId}
Content-Type: application/json
```

Send only the fields you want to change. Publishing:

```json
{ "status": "active" }
```

Changing price and stock:

```json
{
  "unitAmount": 7200,
  "inventory": 15
}
```

Success returns `200` and the updated `product`. An empty object returns `400`, an unknown product `404`, and an SKU conflict `409`.

There is no endpoint that deletes a product. Set `draft` to stop selling it, or `archived` to keep the history while removing it from day-to-day management.

## 10. Security and integration notes

- Stripe secret key, webhook secret, database connection and PII key belong in server-side environment variables only.
- Prices, shipping fees and stock are decided by the server. Clients submit only a SKU and a quantity.
- Buyer details are encrypted in the database with AES-256-GCM, and the email lookup value is one-way hashed with HMAC-SHA256.
- `externalUserId` is stored in plain text so orders can be looked up by it. It identifies a person on its own, so treat exports and access to it as personal data.
- Creating an order needs no login. In production, add rate limiting and fraud rules on Cloudflare, by IP or by your own identifiers.
- Admin endpoints return decrypted personal data. Never call them from a consumer app and never open CORS to arbitrary origins.
- `checkoutUrl` is a short-lived payment entry point. Clients must not cache or share it.
- A successful redirect on the frontend is not settled money. Fulfil orders against the Stripe webhook status the server received.

## 11. MCP endpoint (AI clients)

Connect Claude, or any other AI client, straight to the merchant tools to check sales, change products and record shipments in natural language. It is a Streamable HTTP endpoint following the MCP specification, deployed alongside the API.

```http
POST /api/mcp
Authorization: Bearer <MCP_TOKEN>
Content-Type: application/json
```

Without `MCP_TOKEN` the endpoint returns `404` and the feature is off entirely. A token shorter than 32 characters stops the service from starting. A wrong token returns `401` with `WWW-Authenticate: Bearer`.

The transport is stateless Streamable HTTP: one JSON-RPC 2.0 request per POST, answered with `application/json`. Notifications (no `id`) get an empty `202`. There is no SSE and no `Mcp-Session-Id`. The protocol version echoes what the client declares, supporting `2025-06-18`, `2025-03-26` and `2024-11-05`.

### 11.1 Supported methods

| Method | Description |
| --- | --- |
| `initialize` | Handshake; returns the protocol version, capabilities and `serverInfo` |
| `notifications/initialized` | Client handshake notification; answered with `202` |
| `ping` | Liveness check; returns an empty result |
| `tools/list` | Lists every tool with its JSON Schema |
| `tools/call` | Runs a tool |

An unimplemented method returns JSON-RPC error `-32601`; an unknown tool name returns `-32602`. Errors inside a tool are not JSON-RPC errors: they come back as a normal result with `isError: true`, so the AI can read the reason and correct itself.

### 11.2 Tools

| Tool | Read-only | Purpose |
| --- | --- | --- |
| `get_sales_summary` | yes | Revenue, order counts, pending and paid totals |
| `list_orders` | yes | Orders newest first, filterable by payment status |
| `find_orders_by_email` | yes | Find orders by exact email address |
| `get_order` | yes | Read one order by id |
| `list_products` | yes | Products with price, status and inventory |
| `create_product` | no | Create a product |
| `update_product` | no | Change price, inventory, description or publication status |
| `mark_shipped` | no | Record or clear a shipment and store a tracking number |

The writing tools share their validation schema with the admin REST API, so the price ceiling, SKU format and inventory range are identical. `mark_shipped` likewise only marks `paid` orders as shipped.

Deliberately absent: creating orders, refunds, and deleting data. An AI on this connection cannot charge a card or remove anything irreversibly.

### 11.3 Personal data

Order tools redact buyer details by default down to the family name, a masked email address and the prefecture, and add `piiRedacted: true`. `externalUserId` is redacted too — a LINE user id identifies a person as precisely as the address does.

```json
{
  "id": "98d865f6-0208-4712-8593-c70839c63a83",
  "status": "paid",
  "totalAmount": 4200,
  "buyer": { "familyName": "山田", "email": "b***@example.com", "prefecture": "東京都" },
  "piiRedacted": true
}
```

When the AI genuinely needs full shipping details — preparing labels, for instance — set `MCP_ALLOW_PII=true` and the order tools return the same complete `buyer` object as the admin endpoints. Before enabling it, be clear that those addresses and phone numbers enter the AI vendor's context and logs.

### 11.4 Connecting Claude Code

```bash
claude mcp add --transport http nano-checkout https://shop.example.com/api/mcp \
  --header "Authorization: Bearer $MCP_TOKEN"
```

Or in the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "nano-checkout": {
      "type": "http",
      "url": "https://shop.example.com/api/mcp",
      "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
    }
  }
}
```

This endpoint uses a fixed bearer token and does not implement the OAuth 2.1 authorization flow. Clients that support only OAuth cannot connect directly.

### 11.5 Checking it with curl

```bash
curl -X POST https://shop.example.com/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
