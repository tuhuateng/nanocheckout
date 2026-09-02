# Nano Checkout

小さなストア向けの、プラットフォーム非依存なチェックアウト実装です。フロントエンドは React + Vite、API は Hono、データベースは Postgres、決済は Stripe Checkout を使用します。

Web、iOS、Android、LINE LIFF 向けのリクエスト例を含む完全な仕様は [API 接口文档](docs/API.md) を参照してください。

## ローカルで起動

Node.js 20 以上が必要です。

```bash
npm install
npm run dev
```

`http://localhost:5173` を開いてください。環境変数を設定しない場合はメモリ DB とデモ決済で起動するため、UI と注文フローをすぐ確認できます。

商品名、価格、送料、販売条件は `src/config/order-spec.ts` の一箇所で変更できます。

商品管理を使う場合、商品データは Postgres の `checkout_products` が正本になります。初期商品はマイグレーションで自動作成されます。

## 本番環境変数

`.env.example` を参照し、次をプラットフォームのシークレットとして登録します。値をリポジトリへコミットしないでください。

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CHECKOUT_PII_KEY` — `openssl rand -base64 32` で一度だけ生成。変更すると既存 PII を復号できません。
- `CHECKOUT_LOOKUP_PEPPER` — `openssl rand -hex 32` で生成。
- `ADMIN_PASSWORD_HASH` — `npm run admin:hash -- "十分に長いパスワード"` の出力を設定。
- `ADMIN_SESSION_SECRET` — `openssl rand -hex 32` で生成。
- `APP_URL` — 例: `https://shop.example.com`
- `DATABASE_URL` — Cloudflare Hyperdrive を使う場合は不要。

テーブルは `migrations/0000_checkout_orders.sql` を SQL エディタで実行するか、`DIRECT_URL` を指定して `npm run db:push` で作成します。

## Cloudflare Pages + Hyperdrive（推奨）

1. Cloudflare Pages にリポジトリを接続し、ビルドコマンドを `npm run build`、出力を `dist` にします。
2. Neon、Supabase、または自前 Postgres を作成します。Supabase は東京リージョンを選び、本番の `DATABASE_URL` には 6543 の transaction pooler を使います。マイグレーション用 `DIRECT_URL` には 5432 を使います。
3. Hyperdrive を作成します。

   ```bash
   npx wrangler hyperdrive create nano-checkout-db --connection-string="postgres://..."
   ```

4. 出力された ID を使い、`wrangler.toml` の `[[hyperdrive]]` セクションを有効にします。Pages の Settings → Bindings で `HYPERDRIVE` という名前で追加する方法でも構いません。
5. 上記シークレットを Pages の Settings → Variables and Secrets に登録してデプロイします。
6. Stripe Workbench で `https://あなたのドメイン/api/webhooks/stripe` を webhook として登録し、次のイベントを選びます。
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`

`public/_routes.json` は Worker を `/api/*` に限定します。`/confirm/` は `OrderSpec` からビルド時に生成され、静的アセットとして配信されるため Worker の呼び出しを消費しません。

## 商户管理后台

`/admin/` 提供订单管理界面，包括销售额与订单统计、支付状态筛选、订单搜索，以及解密后的购买者和配送信息。管理会话存放在签名、`HttpOnly`、`SameSite=Strict` Cookie 中，密码只以 PBKDF2 哈希形式配置。

本地未设置 `ADMIN_PASSWORD_HASH` 时会启用演示后台，地址为 `http://localhost:5173/admin/`，密码为 `nano-demo-2026`。生产适配器不会启用此默认密码；缺少管理员环境变量时会直接拒绝启动。

### 产品管理

后台的「商品管理」支持：

- 新建与编辑商品
- SKU、名称、版本、说明、价格和运费
- 有限库存或不限库存
- 草稿、销售中、归档状态
- 一键上下架和前台预览

公开客户端可以调用：

```http
GET /api/storefront/products
GET /api/storefront/products/:sku
```

Web 可通过 `/?product=SKU` 预览指定商品；iOS、Android 和 LINE 也使用相同 SKU 创建订单：

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

服务端根据 SKU 查询价格并预留库存，不采用客户端提交的金额。Stripe Session 创建失败或过期时会自动归还库存。

> Supabase Free は非アクティブなプロジェクトを一時停止することがあります。実際に注文を受けるストアでは有料プラン、Neon、または監視を含む自前 Postgres を利用してください。

## Vercel / Netlify

どちらも `DATABASE_URL` に Postgres の pooled connection string を設定します。Vercel は `api/index.ts`、Netlify は `netlify/functions/checkout.ts` が同じ `createCheckoutApp()` を読み込みます。

- Vercel: `vercel.json` を含めて通常どおりインポート
- Netlify: `netlify.toml` を含めて通常どおりインポート

Vercel Hobby は商用利用向けではないため、販売用途では契約条件に合うプランを選択してください。

## セキュリティ境界

- 商品価格と送料はサーバーの `OrderSpec` から計算し、ブラウザが送る金額は信用しません。
- 購入者情報は AES-256-GCM で暗号化して保存します。検索用メール値は HMAC-SHA256 で不可逆化します。
- Stripe webhook は Web Crypto で署名と 5 分の時刻許容範囲を検証します。
- 注文作成は idempotency key で二重実行を防ぎます。
- カード情報は Stripe Hosted Checkout だけが扱います。

## コマンド

```bash
npm run typecheck  # TypeScript
npm test           # 単体・API テスト
npm run build      # Vite + 静的確認ページ
npm run cf:dev     # Cloudflare Pages ローカル実行
```
