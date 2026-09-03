# Nano Checkout API リファレンス

**日本語** | [English](API.en.md)

このリポジトリの Hono 実装に対応した API 仕様です。Web、iOS、Android、LINE LIFF のクライアントから利用できます。

## 1. 基本情報

| 環境 | Base URL |
| --- | --- |
| ローカル（Vite プロキシ経由） | `http://localhost:5173/api` |
| ローカル（API 直接） | `http://localhost:8787/api` |
| 本番 | `https://shop.example.com/api` |

- Stripe Webhook を除き、リクエストとレスポンスはすべて UTF-8 の JSON です。
- 金額は日本円の最小単位の整数です。`4200` は `¥4,200` を表します。
- 日時は ISO 8601 形式です。例: `2026-09-02T10:02:57.765Z`
- 現時点で `/v1` のようなバージョン接頭辞はありません。公開後にサードパーティのクライアントが存在する場合は、既存フィールドの意味を変えるのではなく、新しいバージョンパスを追加して移行してください。
- 本番では HTTPS が必須です。iOS の App Transport Security も既定で安全な接続を要求します。

### 共通のエラー形式

```json
{
  "error": "エラーの説明"
}
```

入力値の検証に失敗した場合は `fields` も返します。

```json
{
  "error": "入力内容を確認してください。",
  "fields": {
    "email": ["Invalid email address"],
    "quantity": ["Too big: expected number to be <=5"]
  }
}
```

## 2. エンドポイント一覧

| メソッド | パス | 認証 | 用途 |
| --- | --- | --- | --- |
| `GET` | `/api/health` | なし | ヘルスチェック |
| `GET` | `/api/storefront/products` | なし | 販売中の商品一覧 |
| `GET` | `/api/storefront/products/:sku` | なし | 商品の取得 |
| `POST` | `/api/orders` | `Idempotency-Key` | 注文と Stripe Checkout の作成 |
| `POST` | `/api/webhooks/stripe` | Stripe 署名 | 決済ステータスの受信 |
| `POST` | `/api/mcp` | Bearer トークン | AI クライアント向け MCP |
| `GET` | `/api/admin/session` | なし | ログイン状態の確認 |
| `POST` | `/api/admin/session` | 管理パスワード | 管理画面へのログイン |
| `DELETE` | `/api/admin/session` | Cookie | ログアウト |
| `GET` | `/api/admin/summary` | 管理者 Cookie | ダッシュボードの概要 |
| `GET` | `/api/admin/orders` | 管理者 Cookie | 注文の検索 |
| `GET` | `/api/admin/orders.csv` | 管理者 Cookie | 注文の CSV 書き出し |
| `GET` | `/api/admin/orders/:id` | 管理者 Cookie | 注文の詳細 |
| `PATCH` | `/api/admin/orders/:id` | 管理者 Cookie | 発送状況の更新 |
| `GET` | `/api/admin/products` | 管理者 Cookie | 全商品の取得 |
| `POST` | `/api/admin/products` | 管理者 Cookie | 商品の作成 |
| `PATCH` | `/api/admin/products/:id` | 管理者 Cookie | 商品の更新 |

## 3. 公開エンドポイント

### 3.1 ヘルスチェック

```http
GET /api/health
```

レスポンス `200`:

```json
{
  "ok": true,
  "service": "nano-checkout"
}
```

### 3.2 商品一覧

ステータスが `active` の商品だけを返します。実際の在庫数は公開されず、購入できるかどうかだけを返します。

```http
GET /api/storefront/products
```

レスポンス `200`:

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

### 3.3 商品の取得

```http
GET /api/storefront/products/{sku}
```

例:

```bash
curl https://shop.example.com/api/storefront/products/everyday-tray-01
```

レスポンス `200`:

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

商品が存在しない、未公開、またはアーカイブ済みの場合は `404` を返します。

```json
{ "error": "Product not found" }
```

### 3.4 注文の作成

サーバーが SKU から価格と送料を読み取り、在庫を確保して Stripe Hosted Checkout Session を作成します。クライアントが送信した金額フィールドはすべて無視されます。

```http
POST /api/orders
Content-Type: application/json
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

`Idempotency-Key` は 16〜128 文字です。1 回の購入操作につき UUID をひとつ生成します。通信タイムアウトで再送する場合は同じ値を使い、別の購入では新しい値を使ってください。

リクエストフィールド:

| フィールド | 型 | 必須 | 制約 |
| --- | --- | --- | --- |
| `sku` | string | 推奨 | 2〜64 文字。省略時は販売中の最初の商品を選びます |
| `quantity` | integer | 必須 | 1〜5 |
| `email` | string | 必須 | メール形式、最大 254 文字 |
| `familyName` | string | 必須 | 姓、1〜80 文字 |
| `givenName` | string | 必須 | 名、1〜80 文字 |
| `postalCode` | string | 必須 | 半角/全角数字とハイフンで 7〜8 文字。例: `150-0001` |
| `prefecture` | string | 必須 | 都道府県、2〜4 文字 |
| `city` | string | 必須 | 市区町村、1〜120 文字 |
| `addressLine1` | string | 必須 | 番地、1〜120 文字 |
| `addressLine2` | string | 任意 | 建物名・部屋番号、最大 120 文字。既定は空文字列 |
| `phone` | string | 必須 | 8〜30 文字 |
| `externalUserId` | string | 任意 | 1〜128 文字。LINE ユーザー ID やアプリ側の利用者 ID |

リクエスト例:

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

`externalUserId` は注文を自社の利用者と結びつけるためのフィールドです。LINE ミニアプリなら `liff.getProfile()` の `userId`、ネイティブアプリなら自前の利用者 ID を渡します。発送時にこの ID を使って LINE Messaging API やプッシュ通知で購入者に連絡できます。日本ではメールより LINE のほうが確実に読まれます。省略した場合は `null` になり、注文自体には影響しません。

この値は `external_user_id` 列に平文で保存し、索引を張っています。この ID で注文を引く必要があるためで、ほかの購入者情報のようには暗号化されません。

レスポンス `201`:

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

レスポンスを受け取ったら `checkoutUrl` へ遷移させてください。カード情報は Stripe だけに送信され、この API を経由しません。

想定されるステータスコード:

| コード | 状況 |
| --- | --- |
| `201` | 作成成功 |
| `400` | `Idempotency-Key` の欠落や不正、JSON の形式不正 |
| `409` | 未公開・売り切れ・同時購入による在庫不足、または販売中の商品が 1 件もない |
| `422` | 宛先、住所、数量の検証エラー |
| `502` | Stripe Session の作成失敗。確保した在庫は自動で戻します |

cURL の例:

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

## 4. iOS からの利用

Stripe Secret Key を iOS アプリに埋め込んではいけません。アプリは Nano Checkout の API を呼ぶだけで、返ってきた `checkoutUrl` をシステムのブラウザで開きます。物理的な商品の販売にアプリ内課金は不要なため、この方式が使えます。

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
    // 通信がタイムアウトした場合、同じ購入では この UUID を使い回すこと。
    let operationID = UUID()
    let checkout = try await CheckoutAPI.createOrder(input, idempotencyKey: operationID)
    await UIApplication.shared.open(checkout.checkoutUrl)
}
```

決済が完了すると Stripe は `${APP_URL}/success?session_id=...` へ遷移します。アプリへ自動的に戻したい場合は、Universal Links を設定した HTTPS ドメインを `APP_URL` に指定し、`/success` ページにアプリへ戻る導線を置いてください。最終的な決済結果は Stripe Webhook を正とし、クライアントの戻り画面だけで成功と判断しないでください。

`externalUserId` にアプリ側の利用者 ID を渡しておくと、発送時にその利用者へプッシュ通知を送れます。

## 5. LINE LIFF / Web からの利用

LIFF から注文するときに LINE の `userId` を一緒に送ると、注文がその LINE ユーザーと結びつき、発送時にメッセージを直接送れるようになります。

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

決済後、Stripe は `${APP_URL}/success` へ戻します。LIFF ではこのページで `liff.closeWindow()` を呼び、webview を閉じてトーク画面へ戻すことができます。

発送の連絡は、管理画面で発送済みにしたあと、注文の `externalUserId` を使って LINE Messaging API の push message で送ります。Messaging API を呼ぶコードはこのリポジトリには含まれていません。Channel Access Token は各自の LINE 公式アカウントに属するものなので、必要に応じて実装してください。

このサービスは同一オリジンでの配信を前提に設計しており、任意のオリジンに対する CORS は開けていません。LIFF ページと API のドメインが異なる場合は、同一オリジンのプロキシ経由でアクセスするか、サーバー側で厳密なオリジン許可リストを設けてください。管理者向けエンドポイントを `*` で開放してはいけません。

## 6. Stripe Webhook

このエンドポイントは Stripe からのみ呼び出されます。通常のクライアントから呼ばないでください。

```http
POST /api/webhooks/stripe
Stripe-Signature: t=...,v1=...
Content-Type: application/json
```

サーバーは生のリクエストボディ、`STRIPE_WEBHOOK_SECRET`、5 分間の時刻許容範囲で署名を検証します。

処理しているイベント:

| Stripe イベント | 注文ステータス |
| --- | --- |
| `checkout.session.completed` | `paid` |
| `checkout.session.async_payment_succeeded` | `paid` |
| `checkout.session.async_payment_failed` | `payment_failed` |
| `checkout.session.expired` | `cancelled`（在庫を戻す） |

成功時のレスポンス `200`:

```json
{ "received": true }
```

署名が欠落している、または不正な場合は `400` を返します。

## 7. 管理者認証

管理者エンドポイントは Bearer トークンではなく、署名付きの HttpOnly Cookie `nano_admin_session` を使います。本番では次の属性が付きます。

- `HttpOnly`
- `Secure`
- `SameSite=Strict`
- 有効期間 8 時間

### 7.1 ログイン状態の確認

```http
GET /api/admin/session
```

```json
{
  "authenticated": false,
  "demoMode": false
}
```

### 7.2 ログイン

```http
POST /api/admin/session
Content-Type: application/json
```

```json
{ "password": "管理画面のパスワード" }
```

成功すると `200` を返し、`Set-Cookie` でセッションを書き込みます。

```json
{ "authenticated": true }
```

パスワードが誤っている場合は `401` です。同一の送信元 IP から 8 回続けて失敗すると、その IP は 15 分間ブロックされ、その間は正しいパスワードでも `429` と `Retry-After` ヘッダーを返します。この回数は実行中インスタンスのメモリで数えているため、複数インスタンス構成では Cloudflare などのエッジ側でもレート制限を重ねてください。

ローカルのデモ環境の既定パスワードは `nano-demo-2026` です。本番では `ADMIN_PASSWORD_HASH` で自分のパスワードハッシュを必ず設定してください。

### 7.3 ログアウト

```http
DELETE /api/admin/session
```

```json
{ "authenticated": false }
```

cURL でログインして管理者エンドポイントを叩く例:

```bash
curl -c admin-cookie.txt \
  -H 'Content-Type: application/json' \
  -d '{"password":"your-admin-password"}' \
  https://shop.example.com/api/admin/session

curl -b admin-cookie.txt https://shop.example.com/api/admin/summary
```

## 8. 管理者向け注文エンドポイント

以下のエンドポイントは未ログインの場合すべて `401` を返します。

```json
{ "error": "Unauthorized" }
```

### 8.1 ダッシュボードの概要

```http
GET /api/admin/summary
```

集計値と直近 8 件の注文を返します。

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

### 8.2 注文の検索

```http
GET /api/admin/orders?status=paid&limit=50&q=buyer@example.com
```

クエリパラメータ:

| パラメータ | 説明 |
| --- | --- |
| `status` | 任意。`pending`、`paid`、`payment_failed`、`cancelled` |
| `limit` | 1〜100、既定は 50。範囲外の値は有効範囲に丸めます |
| `q` | 任意。`@` を含む場合はメールアドレスの完全一致、それ以外は注文 ID の前方一致 |

購入者の氏名は暗号化されたフィールドに入っており、データベースでは検索できません。そのため `q` が対応するのはメールアドレスと注文 ID だけです。管理画面はこれに加えて、読み込み済みの一覧に対して氏名で絞り込みを行っています。

レスポンス `200`:

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

`buyer` は管理者認証を通過したあとにサーバー側で復号した購入者情報です。データベース上の `encryptedPii` はレスポンスに含まれません。

### 8.3 注文の詳細

```http
GET /api/admin/orders/{orderId}
```

レスポンスの形:

```json
{ "order": { "id": "...", "status": "paid", "buyer": {} } }
```

注文が存在しない場合は `404` です。

### 8.4 発送状況の更新

```http
PATCH /api/admin/orders/{orderId}
Content-Type: application/json
```

リクエストフィールド:

| フィールド | 型 | 制約 |
| --- | --- | --- |
| `shipped` | boolean | 任意。`true` で現在時刻を発送日時として記録し、`false` で消去します |
| `trackingNumber` | string/null | 任意。最大 120 文字。`null` または空文字列で消去します |

発送済みにする:

```json
{ "shipped": true, "trackingNumber": "YAMATO-8899-0011" }
```

成功すると `200` と更新後の注文全体を返します。形式は注文詳細と同じです。空のオブジェクトは `400`、注文が存在しない場合は `404`、検証エラーは `422` です。

注文ステータスが `paid` でないときに `shipped: true` を送ると `409` を返します。

```json
{ "error": "決済が完了した注文のみ発送済みにできます。" }
```

この制限は「発送済みにする」操作にだけ働きます。発送状態の取り消しと、追跡番号だけの保存は注文ステータスに関係なく行えます。

### 8.5 注文の CSV 書き出し

```http
GET /api/admin/orders.csv?status=paid&limit=1000
```

パラメータは注文の検索と同じです。`limit` の既定は 1000、上限は 5000 です。レスポンスは `text/csv; charset=utf-8` で、Excel が日本語を正しく判別できるよう UTF-8 BOM を付け、`Content-Disposition` でダウンロードを促します。

列の順序: 注文ID、ステータス、発送日時、追跡番号、外部ユーザーID、注文日時、商品名、数量、合計金額、通貨、お名前、メール、電話番号、郵便番号、都道府県、市区町村、番地、建物名。

すべての値は引用符で囲み、`=`、`+`、`-`、`@` で始まる値には先頭にシングルクォートを付けて、表計算ソフトが数式として実行しないようにしています。このファイルには復号済みの個人情報が含まれます。社内規程に従って取り扱ってください。

## 9. 管理者向け商品エンドポイント

### 9.1 全商品の取得

```http
GET /api/admin/products
```

公開エンドポイントと異なり、下書き・アーカイブの状態と在庫数を含みます。

```json
{
  "products": [
    {
      "id": "product-default-tray",
      "sku": "everyday-tray-01",
      "name": "Everyday Carry Tray",
      "edition": "Sand / Edition 01",
      "description": "商品説明",
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

### 9.2 商品の作成

```http
POST /api/admin/products
Content-Type: application/json
```

リクエストフィールド:

| フィールド | 型 | 制約 |
| --- | --- | --- |
| `sku` | string | 2〜64 文字。英小文字、数字、ドット、アンダースコア、ハイフンのみ。全体で一意 |
| `name` | string | 1〜160 文字 |
| `edition` | string | 必須。空文字列可、最大 120 文字 |
| `description` | string | 必須。空文字列可、最大 2,000 文字 |
| `unitAmount` | integer | 0〜100,000,000 |
| `currency` | string | 現在は `jpy` のみ |
| `shippingAmount` | integer | 0〜100,000,000 |
| `imageUrl` | string | `/` で始まるサイト内パス、または HTTPS の URL |
| `status` | string | `active`、`draft`、`archived` |
| `inventory` | integer/null | 0〜10,000,000。`null` は在庫無制限 |

リクエスト例:

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

成功すると `201` と作成された `product` 全体を返します。SKU の重複は `409`、検証エラーは `422` です。

### 9.3 商品の更新

```http
PATCH /api/admin/products/{productId}
Content-Type: application/json
```

変更したいフィールドだけを送れます。公開する場合:

```json
{ "status": "active" }
```

価格と在庫を変える場合:

```json
{
  "unitAmount": 7200,
  "inventory": 15
}
```

成功すると `200` と更新後の `product` 全体を返します。空のオブジェクトは `400`、商品が存在しない場合は `404`、SKU の衝突は `409` です。

商品を物理削除するエンドポイントはありません。販売を止めるときは `draft`、履歴は残しつつ通常の管理対象から外すときは `archived` にしてください。

## 10. セキュリティと連携上の注意

- Stripe Secret Key、Webhook Secret、データベース接続情報、PII 鍵はサーバー側の環境変数にのみ保存してください。
- 商品価格、送料、在庫はサーバーが決定します。クライアントが送るのは SKU と数量だけです。
- 購入者情報はデータベース内で AES-256-GCM により暗号化し、検索用のメール値は HMAC-SHA256 で不可逆化しています。
- `externalUserId` は逆引きのため平文で保存します。これ自体が個人を特定しうる識別子なので、書き出しとアクセスは個人情報として扱ってください。
- 注文作成にログインは不要です。実運用では Cloudflare 側で IP や業務上の識別子によるレート制限と不正検知を追加してください。
- 管理者エンドポイントは復号済みの個人情報を含みます。消費者向けアプリから呼ばず、任意のオリジンに CORS を開けないでください。
- `checkoutUrl` は短命の決済入口です。クライアントでキャッシュしたり共有したりしないでください。
- フロントエンドの遷移が成功しても入金確定ではありません。注文の履行は、サーバーが受け取った Stripe Webhook のステータスを正としてください。

## 11. MCP エンドポイント（AI 連携）

Claude のような AI クライアントを管理機能に直接つなぎ、自然言語で売上の確認、商品の変更、発送の記録を行えます。MCP 仕様に沿った Streamable HTTP エンドポイントで、API と同じ場所にデプロイされます。

```http
POST /api/mcp
Authorization: Bearer <MCP_TOKEN>
Content-Type: application/json
```

`MCP_TOKEN` を設定していない場合、このエンドポイントは `404` を返し、機能ごと無効になります。トークンが 32 文字未満だとサービスは起動を拒否します。トークンが誤っている場合は `401` と `WWW-Authenticate: Bearer` を返します。

トランスポートはステートレスな Streamable HTTP です。単一の JSON-RPC 2.0 リクエストを POST し、レスポンスは `application/json` で返します。通知（`id` なし）には `202` を空ボディで返します。SSE は使わず、`Mcp-Session-Id` も保持しません。プロトコルバージョンはクライアントの申告を反映し、`2025-06-18`、`2025-03-26`、`2024-11-05` に対応します。

### 11.1 対応しているメソッド

| メソッド | 説明 |
| --- | --- |
| `initialize` | ハンドシェイク。プロトコルバージョン、ケイパビリティ、`serverInfo` を返します |
| `notifications/initialized` | クライアントのハンドシェイク完了通知。`202` を返します |
| `ping` | 疎通確認。空の結果を返します |
| `tools/list` | 全ツールとその JSON Schema を返します |
| `tools/call` | ツールを実行します |

未実装のメソッドは JSON-RPC エラー `-32601`、存在しないツール名は `-32602` を返します。ツール内部の業務エラーは JSON-RPC エラーにせず、`isError: true` を付けた通常の結果として返します。AI が理由を読んで自分で修正できるようにするためです。

### 11.2 ツール一覧

| ツール | 読み取り専用 | 用途 |
| --- | --- | --- |
| `get_sales_summary` | はい | 売上、注文数、未処理と決済済みの件数 |
| `list_orders` | はい | 新しい順に注文を一覧。決済ステータスで絞り込み可 |
| `find_orders_by_email` | はい | メールアドレスの完全一致で注文を検索 |
| `get_order` | はい | 注文 ID で 1 件を取得 |
| `list_products` | はい | 価格、ステータス、在庫を含む商品一覧 |
| `create_product` | いいえ | 商品の作成 |
| `update_product` | いいえ | 価格、在庫、説明、公開状態の変更 |
| `mark_shipped` | いいえ | 発送の記録と取り消し、追跡番号の保存 |

書き込み系ツールの検証ルールは管理者 REST API と同じスキーマを共有しているため、価格の上限、SKU の形式、在庫の範囲といった制約は完全に一致します。`mark_shipped` も同様に、`paid` の注文だけを発送済みにできます。

意図的に提供していない機能: 注文の作成、返金、データの削除。AI がこの接続から課金や取り消せない削除を行うことはできません。

### 11.3 個人情報

注文系のツールは既定で購入者情報を伏せ、姓、マスクしたメールアドレス、都道府県だけを返し、`piiRedacted: true` を付けます。`externalUserId` も同様に伏せます。LINE ユーザー ID は住所と同じく個人を特定できるためです。

```json
{
  "id": "98d865f6-0208-4712-8593-c70839c63a83",
  "status": "paid",
  "totalAmount": 4200,
  "buyer": { "familyName": "山田", "email": "b***@example.com", "prefecture": "東京都" },
  "piiRedacted": true
}
```

AI に完全な配送先を読ませたい場合（送り状の整理などで必要なとき）は、環境変数 `MCP_ALLOW_PII=true` を設定します。注文系ツールは管理者エンドポイントと同じ完全な `buyer` オブジェクトを返すようになります。有効にする前に確認してください。これらの住所と電話番号は AI ベンダーの文脈とログに渡ります。

### 11.4 Claude Code から接続する

```bash
claude mcp add --transport http nano-checkout https://shop.example.com/api/mcp \
  --header "Authorization: Bearer $MCP_TOKEN"
```

プロジェクトの `.mcp.json` に書く場合:

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

このエンドポイントは固定の bearer トークンを使い、OAuth 2.1 の認可フローは実装していません。OAuth のみに対応するクライアントからは直接接続できません。

### 11.5 curl で確認する

```bash
curl -X POST https://shop.example.com/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
