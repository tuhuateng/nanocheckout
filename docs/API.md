# Nano Checkout API 接口文档

本文档对应当前仓库中的 Hono API 实现，适用于 Web、iOS、Android 和 LINE LIFF 客户端。

## 1. 基本信息

| 环境 | Base URL |
| --- | --- |
| 本地前端代理 | `http://localhost:5173/api` |
| 本地 API 服务 | `http://localhost:8787/api` |
| 正式环境 | `https://shop.example.com/api` |

- 请求和响应均使用 UTF-8 JSON，Stripe Webhook 除外。
- 金额单位为日元最小单位，即整数 `4200` 表示 `¥4,200`。
- 时间字段采用 ISO 8601，例如 `2026-09-02T10:02:57.765Z`。
- 当前接口没有 `/v1` 前缀。上线后若存在第三方客户端，建议通过新增版本路径演进，避免直接改变现有字段语义。
- 正式环境必须使用 HTTPS；iOS 默认的 App Transport Security 也要求安全连接。

### 通用错误格式

```json
{
  "error": "错误说明"
}
```

字段校验失败时还会返回 `fields`：

```json
{
  "error": "入力内容を確認してください。",
  "fields": {
    "email": ["Invalid email address"],
    "quantity": ["Too big: expected number to be <=5"]
  }
}
```

## 2. 接口一览

| 方法 | 路径 | 认证 | 用途 |
| --- | --- | --- | --- |
| `GET` | `/api/health` | 无 | 健康检查 |
| `GET` | `/api/storefront/products` | 无 | 获取可销售商品 |
| `GET` | `/api/storefront/products/:sku` | 无 | 获取指定商品 |
| `POST` | `/api/orders` | `Idempotency-Key` | 创建订单和 Stripe Checkout |
| `POST` | `/api/webhooks/stripe` | Stripe 签名 | 接收支付状态 |
| `GET` | `/api/admin/session` | 无 | 查询管理员登录状态 |
| `POST` | `/api/admin/session` | 管理密码 | 登录后台 |
| `DELETE` | `/api/admin/session` | Cookie | 退出后台 |
| `GET` | `/api/admin/summary` | 管理员 Cookie | 获取后台概要 |
| `GET` | `/api/admin/orders` | 管理员 Cookie | 查询订单 |
| `GET` | `/api/admin/orders.csv` | 管理员 Cookie | 导出订单 CSV |
| `GET` | `/api/admin/orders/:id` | 管理员 Cookie | 获取订单详情 |
| `PATCH` | `/api/admin/orders/:id` | 管理员 Cookie | 更新发货状态 |
| `GET` | `/api/admin/products` | 管理员 Cookie | 获取全部商品 |
| `POST` | `/api/admin/products` | 管理员 Cookie | 创建商品 |
| `PATCH` | `/api/admin/products/:id` | 管理员 Cookie | 更新商品 |

## 3. 公开接口

### 3.1 健康检查

```http
GET /api/health
```

响应 `200`：

```json
{
  "ok": true,
  "service": "nano-checkout"
}
```

### 3.2 商品列表

只返回状态为 `active` 的商品。公开结果不会暴露实际库存数量，只返回当前是否可购买。

```http
GET /api/storefront/products
```

响应 `200`：

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

### 3.3 商品详情

```http
GET /api/storefront/products/{sku}
```

示例：

```bash
curl https://shop.example.com/api/storefront/products/everyday-tray-01
```

响应 `200`：

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

商品不存在、尚未发布或已归档时返回 `404`：

```json
{ "error": "Product not found" }
```

### 3.4 创建订单

由服务端根据 SKU 读取价格和运费、预留库存，并创建 Stripe Hosted Checkout Session。客户端提交的任何价格字段都会被忽略。

```http
POST /api/orders
Content-Type: application/json
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

`Idempotency-Key` 必须为 16–128 个字符。一次购买操作生成一个 UUID；网络超时重试时必须复用同一个值，新的购买操作则使用新的值。

请求字段：

| 字段 | 类型 | 必填 | 规则 |
| --- | --- | --- | --- |
| `sku` | string | 建议 | 2–64 字符；不传时选择第一个在售商品 |
| `quantity` | integer | 是 | 1–5 |
| `email` | string | 是 | 合法邮箱，最多 254 字符 |
| `familyName` | string | 是 | 姓，1–80 字符 |
| `givenName` | string | 是 | 名，1–80 字符 |
| `postalCode` | string | 是 | 7–8 个数字、全角数字或连字符，例如 `150-0001` |
| `prefecture` | string | 是 | 都道府县，2–4 字符 |
| `city` | string | 是 | 城市及区町村，1–120 字符 |
| `addressLine1` | string | 是 | 街道门牌，1–120 字符 |
| `addressLine2` | string | 否 | 建筑名、房间号，最多 120 字符，默认空字符串 |
| `phone` | string | 是 | 8–30 字符 |

请求示例：

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
  "phone": "090-1234-5678"
}
```

响应 `201`：

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

收到响应后，将用户导航到 `checkoutUrl`。银行卡信息只提交给 Stripe，不经过本项目 API。

可能的状态码：

| 状态码 | 场景 |
| --- | --- |
| `201` | 创建成功 |
| `400` | 缺少或错误的 `Idempotency-Key`、JSON 格式错误 |
| `409` | 商品未发布、已售罄、并发购买导致库存不足，或店铺当前没有任何在售商品 |
| `422` | 收件人、地址或数量校验失败 |
| `502` | Stripe Session 创建失败；已预留的库存会自动归还 |

cURL 示例：

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

## 4. iOS 接入示例

Stripe Secret Key 不得放入 iOS App。App 只调用 Nano Checkout API，然后使用系统浏览器打开服务端返回的 `checkoutUrl`。

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
    // 若网络超时，请为同一次购买复用该 UUID。
    let operationID = UUID()
    let checkout = try await CheckoutAPI.createOrder(input, idempotencyKey: operationID)
    await UIApplication.shared.open(checkout.checkoutUrl)
}
```

支付完成后 Stripe 会跳转到 `${APP_URL}/success?session_id=...`。若要自动返回原生 App，可让 `APP_URL` 使用已配置 Universal Links 的 HTTPS 域名，并由 `/success` 页面提供“返回 App”入口。支付最终状态以 Stripe Webhook 为准，不应仅凭客户端返回页面判断成功。

## 5. LINE LIFF / Web 接入示例

```js
const operationId = crypto.randomUUID();

const response = await fetch('/api/orders', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'idempotency-key': operationId,
  },
  body: JSON.stringify(checkoutForm),
});

const result = await response.json();
if (!response.ok) throw new Error(result.error || 'Checkout failed');
location.assign(result.checkoutUrl);
```

当前服务默认按同源部署设计，没有开放任意来源 CORS。若 LIFF 页面与 API 不在同一域名，应通过同源代理访问，或在服务端增加严格的来源白名单；不要使用 `*` 开放管理员接口。

## 6. Stripe Webhook

该接口仅供 Stripe 调用，普通客户端不要调用。

```http
POST /api/webhooks/stripe
Stripe-Signature: t=...,v1=...
Content-Type: application/json
```

服务端使用原始请求体、`STRIPE_WEBHOOK_SECRET` 和 5 分钟时间窗口验证签名。

已处理事件：

| Stripe 事件 | 订单状态 |
| --- | --- |
| `checkout.session.completed` | `paid` |
| `checkout.session.async_payment_succeeded` | `paid` |
| `checkout.session.async_payment_failed` | `payment_failed` |
| `checkout.session.expired` | `cancelled`，归还库存 |

成功响应 `200`：

```json
{ "received": true }
```

签名缺失或无效时返回 `400`。

## 7. 管理员认证

管理员接口使用签名的 HttpOnly Cookie `nano_admin_session`，不是 Bearer Token。正式环境 Cookie 同时设置：

- `HttpOnly`
- `Secure`
- `SameSite=Strict`
- 有效期 8 小时

### 7.1 查询登录状态

```http
GET /api/admin/session
```

```json
{
  "authenticated": false,
  "demoMode": false
}
```

### 7.2 登录

```http
POST /api/admin/session
Content-Type: application/json
```

```json
{ "password": "管理后台密码" }
```

成功响应 `200`，并通过 `Set-Cookie` 写入会话：

```json
{ "authenticated": true }
```

密码错误返回 `401`。同一来源 IP 连续 8 次失败后，该 IP 会被锁定 15 分钟，期间无论密码是否正确都返回 `429`，并带 `Retry-After` 响应头。计数保存在运行实例的内存中，多实例部署时请在 Cloudflare 等边缘层再叠加一层限流。

本地演示环境默认密码为 `nano-demo-2026`，正式环境必须通过 `ADMIN_PASSWORD_HASH` 配置自己的密码哈希。

### 7.3 退出

```http
DELETE /api/admin/session
```

```json
{ "authenticated": false }
```

cURL 登录并访问后台接口：

```bash
curl -c admin-cookie.txt \
  -H 'Content-Type: application/json' \
  -d '{"password":"your-admin-password"}' \
  https://shop.example.com/api/admin/session

curl -b admin-cookie.txt https://shop.example.com/api/admin/summary
```

## 8. 管理员订单接口

以下接口未登录时统一返回 `401`：

```json
{ "error": "Unauthorized" }
```

### 8.1 后台概要

```http
GET /api/admin/summary
```

返回统计数据和最近 8 个订单：

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

### 8.2 订单列表

```http
GET /api/admin/orders?status=paid&limit=50&q=buyer@example.com
```

查询参数：

| 参数 | 说明 |
| --- | --- |
| `status` | 可选：`pending`、`paid`、`payment_failed`、`cancelled` |
| `limit` | 1–100，默认 50，超出范围会被限制到有效范围 |
| `q` | 可选。含 `@` 时按邮箱精确匹配，否则按订单 ID 前缀匹配 |

购买者姓名保存在加密字段中，数据库无法直接检索，因此 `q` 只支持邮箱和订单 ID。后台界面在此基础上，对已加载的这一页订单再做一次本地的姓名过滤。

响应 `200`：

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

`buyer` 是服务端在管理员认证通过后解密的购买者信息。数据库中的 `encryptedPii` 不会出现在响应中。

### 8.3 订单详情

```http
GET /api/admin/orders/{orderId}
```

响应格式为：

```json
{ "order": { "id": "...", "status": "paid", "buyer": {} } }
```

订单不存在时返回 `404`。

### 8.4 更新发货状态

```http
PATCH /api/admin/orders/{orderId}
Content-Type: application/json
```

请求字段：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `shipped` | boolean | 可选。`true` 记录当前时间为发货时间，`false` 清除发货时间 |
| `trackingNumber` | string/null | 可选。最多 120 字符，`null` 或空字符串表示清除 |

标记发货：

```json
{ "shipped": true, "trackingNumber": "YAMATO-8899-0011" }
```

成功返回 `200` 和更新后的完整订单，格式与订单详情一致。空对象返回 `400`，订单不存在返回 `404`，字段校验失败返回 `422`。

订单状态不是 `paid` 时，`shipped: true` 返回 `409`：

```json
{ "error": "決済が完了した注文のみ発送済みにできます。" }
```

这一限制只作用于「标记为已发货」。清除发货状态和单独保存追踪号不受订单状态限制。

### 8.5 导出订单 CSV

```http
GET /api/admin/orders.csv?status=paid&limit=1000
```

参数与订单列表一致，`limit` 默认 1000，上限 5000。响应为 `text/csv; charset=utf-8`，带 UTF-8 BOM 以便 Excel 正确识别日文，并通过 `Content-Disposition` 提示下载。

列依次为：注文ID、ステータス、発送日時、追跡番号、注文日時、商品名、数量、合計金額、通貨、お名前、メール、電話番号、郵便番号、都道府県、市区町村、番地、建物名。

所有字段都会加引号，且以 `=`、`+`、`-`、`@` 开头的值会被加上前导单引号，避免电子表格把它当作公式执行。该文件包含解密后的个人信息，请按内部规定保管。

## 9. 管理员商品接口

### 9.1 获取全部商品

```http
GET /api/admin/products
```

与公开接口不同，这里包含草稿、归档状态和库存数量。

```json
{
  "products": [
    {
      "id": "product-default-tray",
      "sku": "everyday-tray-01",
      "name": "Everyday Carry Tray",
      "edition": "Sand / Edition 01",
      "description": "商品说明",
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

### 9.2 创建商品

```http
POST /api/admin/products
Content-Type: application/json
```

请求字段：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `sku` | string | 2–64 字符，仅小写字母、数字、点、下划线和连字符；全局唯一 |
| `name` | string | 1–160 字符 |
| `edition` | string | 必须提供，可为空，最多 120 字符 |
| `description` | string | 必须提供，可为空，最多 2,000 字符 |
| `unitAmount` | integer | 0–100,000,000 |
| `currency` | string | 当前只能是 `jpy` |
| `shippingAmount` | integer | 0–100,000,000 |
| `imageUrl` | string | `/` 开头的站内路径或 HTTPS URL |
| `status` | string | `active`、`draft` 或 `archived` |
| `inventory` | integer/null | 0–10,000,000；`null` 表示不限库存 |

请求示例：

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

成功返回 `201` 和创建后的完整 `product`。SKU 重复返回 `409`，字段校验失败返回 `422`。

### 9.3 更新商品

```http
PATCH /api/admin/products/{productId}
Content-Type: application/json
```

支持仅提交需要修改的字段。例如发布商品：

```json
{ "status": "active" }
```

调整价格和库存：

```json
{
  "unitAmount": 7200,
  "inventory": 15
}
```

成功返回 `200` 和更新后的完整 `product`。空对象返回 `400`，商品不存在返回 `404`，SKU 冲突返回 `409`。

当前没有物理删除商品的接口。停止销售请设为 `draft`，需要保留历史但从正常管理流程移除时设为 `archived`。

## 10. 安全与集成注意事项

- Stripe Secret Key、Webhook Secret、数据库连接和 PII 密钥只能保存在服务端环境变量中。
- 商品价格、运费和库存由服务端决定；客户端只提交 SKU 和数量。
- 购买者信息在数据库中使用 AES-256-GCM 加密，邮箱检索值使用 HMAC-SHA256。
- 创建订单不需要登录，正式业务应在 Cloudflare 上按 IP 或业务身份增加速率限制和风控规则。
- 管理员接口包含解密后的个人信息，不要从消费者 App 调用，也不要向任意来源开放 CORS。
- `checkoutUrl` 是短期支付入口，客户端不应缓存或共享。
- 前端跳转成功不等于最终入账；订单履约应以后台收到的 Stripe Webhook 状态为准。

## 11. MCP 接口（AI 直连）

店铺可以把 Claude 这类 AI 客户端直接接到后台，用自然语言查销售、改商品、记发货。接口是一个符合 MCP 规范的 Streamable HTTP 端点，和 API 部署在一起。

```http
POST /api/mcp
Authorization: Bearer <MCP_TOKEN>
Content-Type: application/json
```

未设置 `MCP_TOKEN` 时该端点返回 `404`，即完全关闭。token 少于 32 个字符时服务拒绝启动。token 错误返回 `401` 并带 `WWW-Authenticate: Bearer`。

传输层实现的是无状态的 Streamable HTTP：单条 JSON-RPC 2.0 请求走 POST，响应为 `application/json`；通知（无 `id`）返回 `202` 空响应；不使用 SSE，也不维护 `Mcp-Session-Id`。协议版本按客户端声明回显，支持 `2025-06-18`、`2025-03-26` 和 `2024-11-05`。

### 11.1 支持的方法

| 方法 | 说明 |
| --- | --- |
| `initialize` | 握手，返回协议版本、能力和 `serverInfo` |
| `notifications/initialized` | 客户端握手完成通知，返回 `202` |
| `ping` | 心跳，返回空结果 |
| `tools/list` | 列出全部工具及其 JSON Schema |
| `tools/call` | 调用工具 |

未实现的方法返回 JSON-RPC 错误 `-32601`；工具名不存在返回 `-32602`。工具内部的业务错误不走 JSON-RPC 错误，而是返回 `isError: true` 的正常结果，便于 AI 读到原因后自行纠正。

### 11.2 工具一览

| 工具 | 只读 | 用途 |
| --- | --- | --- |
| `get_sales_summary` | 是 | 销售额、订单数、待处理和已支付数量 |
| `list_orders` | 是 | 按时间倒序列出订单，可按支付状态筛选 |
| `find_orders_by_email` | 是 | 按邮箱精确查找订单 |
| `get_order` | 是 | 按订单 ID 读取单个订单 |
| `list_products` | 是 | 列出商品，含价格、状态和库存 |
| `create_product` | 否 | 创建商品 |
| `update_product` | 否 | 修改价格、库存、说明或上下架状态 |
| `mark_shipped` | 否 | 记录或取消发货，保存追踪号 |

写入工具的校验规则与管理员 REST 接口共用同一份 schema，因此价格上限、SKU 格式、库存范围等约束完全一致。`mark_shipped` 同样只允许把 `paid` 的订单标为已发货。

有意不提供的能力：创建订单、退款、删除数据。AI 无法通过这个接口产生扣款或不可逆的删除。

### 11.3 个人信息

订单类工具默认对购买者信息脱敏，只返回姓氏、掩码邮箱和都道府县，并附带 `piiRedacted: true`：

```json
{
  "id": "98d865f6-0208-4712-8593-c70839c63a83",
  "status": "paid",
  "totalAmount": 4200,
  "buyer": { "familyName": "山田", "email": "b***@example.com", "prefecture": "東京都" },
  "piiRedacted": true
}
```

需要 AI 读到完整收件信息（例如让它整理面单）时，设置环境变量 `MCP_ALLOW_PII=true`，订单工具改为返回与管理员接口一致的完整 `buyer` 对象。开启前请确认：这些地址和电话会进入 AI 服务商的上下文与日志。

### 11.4 接入 Claude Code

```bash
claude mcp add --transport http nano-checkout https://shop.example.com/api/mcp \
  --header "Authorization: Bearer $MCP_TOKEN"
```

或写进项目的 `.mcp.json`：

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

本接口使用固定 bearer token，不实现 OAuth 2.1 授权流程。只支持 OAuth 的客户端无法直接连接。

### 11.5 用 curl 验证

```bash
curl -X POST https://shop.example.com/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

