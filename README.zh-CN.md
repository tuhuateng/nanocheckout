# Nano Checkout

[日本語](README.md) | **简体中文** | [English](README.en.md)

面向小型店铺的、与部署平台无关的结账实现。前端使用 React + Vite，API 使用 Hono，数据库使用 Postgres，支付使用 Stripe Checkout。

包含 Web、iOS、Android 和 LINE LIFF 请求示例的完整接口规范见 [API 接口文档](docs/API.md)。

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。未设置环境变量时会以内存数据库和演示支付启动，可以立即查看 UI 和下单流程。

商品数据以 Postgres 的 `checkout_products` 表为正本，通过管理后台编辑。初始商品由迁移脚本自动创建。当没有任何在售商品时，前台显示不可购买状态，下单接口返回 `409`。

`src/config/order-spec.ts` 定义店铺名称和「特定商取引法に基づく表記」页面的内容。**其中的销售主体名称、负责人、地址和电话号码目前是占位值，上线前必须替换为真实的经营者信息。**

## 生产环境变量

参考 `.env.example`，把以下内容注册为部署平台的 Secret。不要把值提交到仓库。

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CHECKOUT_PII_KEY` — 用 `openssl rand -base64 32` 生成一次即可。更换后无法解密已有的个人信息。
- `CHECKOUT_LOOKUP_PEPPER` — 用 `openssl rand -hex 32` 生成。
- `ADMIN_PASSWORD_HASH` — 设置为 `npm run admin:hash -- "足够长的密码"` 的输出。
- `ADMIN_SESSION_SECRET` — 用 `openssl rand -hex 32` 生成（至少 32 个字符）。
- `APP_URL` — 例如 `https://shop.example.com`
- `DATABASE_URL` — 使用 Cloudflare Hyperdrive 时不需要。
- `MCP_TOKEN` — 可选。设置后启用给 AI 用的 MCP 接口，用 `openssl rand -hex 32` 生成（至少 32 个字符）。

建表方式二选一：在 SQL 编辑器中按编号顺序执行 `migrations/` 下的 SQL（`0000_checkout_orders.sql` → `0001_checkout_products.sql` → `0002_order_fulfillment.sql`），或设置 `DIRECT_URL` 后运行 `npm run db:push`。

## Cloudflare Pages + Hyperdrive（推荐）

1. 在 Cloudflare Pages 中连接仓库，构建命令设为 `npm run build`，输出目录设为 `dist`。
2. 创建 Neon、Supabase 或自建 Postgres。Supabase 请选择东京区域，生产环境的 `DATABASE_URL` 使用 6543 端口的 transaction pooler，迁移用的 `DIRECT_URL` 使用 5432 端口。
3. 创建 Hyperdrive。

   ```bash
   npx wrangler hyperdrive create nano-checkout-db --connection-string="postgres://..."
   ```

4. 用输出的 ID 启用 `wrangler.toml` 中的 `[[hyperdrive]]` 段落。也可以在 Pages 的 Settings → Bindings 中以 `HYPERDRIVE` 为名添加绑定。
5. 把上述 Secret 注册到 Pages 的 Settings → Variables and Secrets，然后部署。
6. 在 Stripe Workbench 中把 `https://你的域名/api/webhooks/stripe` 注册为 webhook，并勾选以下事件：
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`

`public/_routes.json` 把 Worker 限定在 `/api/*`。`/confirm/` 页面在构建时由 `OrderSpec` 生成，作为静态资源分发，不消耗 Worker 调用次数。

> Supabase Free 会暂停长期不活跃的项目。真正接单的店铺请使用付费方案、Neon，或带监控的自建 Postgres。

## 商户管理后台

`/admin/` 提供订单管理界面，包括销售额与订单统计、支付状态筛选、订单搜索，以及解密后的购买者和配送信息。管理会话存放在签名、`HttpOnly`、`SameSite=Strict` 的 Cookie 中，密码只以 PBKDF2 哈希形式配置。同一来源 IP 连续 8 次登录失败后会被锁定 15 分钟。计数保存在运行实例的内存里，多实例部署请同时在 Cloudflare 侧配置限流。

本地未设置 `ADMIN_PASSWORD_HASH` 时会启用演示后台，地址为 `http://localhost:5173/admin/`，密码为 `nano-demo-2026`。生产适配器不会启用此默认密码；缺少管理员环境变量时会直接拒绝启动。

### 发货管理

在订单详情中可以记录履约状态：

- 把已支付的订单标记为「已发货」并记录发货时间，也可以撤销。
- 保存物流追踪号。
- 导出订单 CSV，带 UTF-8 BOM，Excel 打开日文不会乱码。

购买者姓名以加密形式存储，数据库无法直接检索。搜索框对邮箱和订单 ID 走服务端查询，对姓名则在已加载的订单中本地过滤。

### 商品管理

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

## 让 AI 直接操作店铺（MCP）

可以把 Claude 这类 MCP 客户端接到后台，用对话查销售、改价格库存、记录发货。

设置 `MCP_TOKEN` 后 `POST /api/mcp` 生效；不设置时该地址返回 404，功能整体关闭。

```bash
claude mcp add --transport http nano-checkout https://shop.example.com/api/mcp \
  --header "Authorization: Bearer $MCP_TOKEN"
```

一共开放 8 个工具：销售概要、订单列表、按邮箱查订单、订单详情、商品列表、创建商品、更新商品、记录发货。创建订单、退款、删除数据都刻意没有开放，AI 无法通过这个接口产生扣款或不可逆的删除。写入类工具与管理员 REST 接口共用同一份校验 schema。

购买者信息默认脱敏，只返回姓氏、掩码邮箱和都道府县。确实需要让 AI 看到完整收件信息时，设置 `MCP_ALLOW_PII=true`。开启前请清楚：地址和电话会进入 AI 服务商的上下文和日志。

协议细节和完整工具说明见 [API 接口文档](docs/API.md) 第 11 章。

## Vercel / Netlify

两者都把 `DATABASE_URL` 设为 Postgres 的 pooled connection string。Vercel 由 `api/index.ts`、Netlify 由 `netlify/functions/checkout.ts` 加载同一个 `createCheckoutApp()`。

- Vercel：连同 `vercel.json` 一起按常规方式导入
- Netlify：连同 `netlify.toml` 一起按常规方式导入

Vercel Hobby 不面向商业用途，用于销售时请选择符合合同条款的方案。

## 安全边界

- 商品价格和运费由服务端数据计算，不信任浏览器提交的金额。
- 购买者信息使用 AES-256-GCM 加密存储；用于检索的邮箱值经 HMAC-SHA256 不可逆处理。
- Stripe webhook 使用 Web Crypto 验证签名和 5 分钟的时间容差。
- 创建订单使用 idempotency key 防止重复执行。
- 银行卡信息只由 Stripe Hosted Checkout 处理。

## 命令

```bash
npm run typecheck  # TypeScript 类型检查
npm test           # 单元测试与 API 测试
npm run build      # Vite 构建 + 静态确认页
npm run cf:dev     # 本地运行 Cloudflare Pages
```

## 许可证

以 Apache License 2.0 开源，Copyright 2026 株式会社MIIMOO。

可以商用、修改、再分发。分发时请一并附上 `LICENSE` 和 `NOTICE`，并注明你所做的改动。本协议不授予「MIIMOO」「株式会社MIIMOO」名称与商标的使用权。
