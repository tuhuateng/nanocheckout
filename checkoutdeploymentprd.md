# 结账部署 PRD：平台、数据库与零固定成本路径

状态：2026-08-30 决策草案
调研截止：2026-08-30（平台条款与额度均为当日实测）
关联：[电商能力 PRD](./commerce-prd.md)、[独立 Vite 项目](./independent-vite-repository.md)

---

## 0. 结论先行

| 项 | 决策 |
|---|---|
| **首选部署目标** | **Cloudflare Pages + Workers** |
| 次选 | Vercel、Netlify |
| 数据库 | 商户二选一：Supabase / 自带 Postgres（含 Neon） |
| 零固定成本可行性 | **CF 成立，Vercel 不成立** |
| 架构前提 | 结账 app 必须零平台假设、零 Node 假设、DB 注入 |

**一句话**：白嫖方向成立，但只在 Cloudflare 上成立。Vercel 免费层的条款排除了商用，而卖东西的店铺是明确的商用。

---

## 1. 免费层实测

### 1.1 Vercel —— 免费层不可用于商店

Vercel Fair Use Guidelines 原文：

> Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform requires either a Pro or Enterprise plan. Commercial usage is defined as any Deployment that is used for the purpose of financial gain of anyone involved in any part of the production of the project.

一个收款的落地页无歧义地属于商用。**Vercel 路径的真实起点是 Pro（$20/月）**，不是免费。

这不影响把 Vercel 作为支持目标——很多商户已经在用 Pro，而且 Vercel 的 Supabase integration 是目前唯一能做到真正零终端配置的组合。但它不能作为「零成本上线」的推荐路径。

### 1.2 Cloudflare —— 成立

```
Workers Free       100,000 请求 / 日     每次调用 10ms CPU 时间
Pages Functions    含在同一 Free 计划内
Hyperdrive         含在 Free 计划内      100,000 数据库查询 / 日
Pages 静态资源      不计入 Workers 请求数
```

未见任何商用限制条款。

按单品店估算：一笔订单约 4–6 次数据库查询，10 万次/日 ≈ 1.5–2 万单/日。请求数同理。**对单品通販是绰绰有余的额度。**

### 1.3 数据库

| | 免费层 | 注意 |
|---|---|---|
| Supabase | 500MB、东京区可选 | **闲置会暂停项目**；免费层无每日备份 |
| Neon | 免费层 | 与 CF Hyperdrive 组合良好 |
| 自带 Postgres | — | 医療・金融等不能用第三方托管的客户唯一选项 |

Supabase 免费层的暂停对**正在收单的店铺是静默丢单**，必须在向导里写明：上线收款请用 Pro，或选 Neon / 自带库。

### 1.4 零固定成本栈

```
Cloudflare Pages（静态页）
  + Workers（结账 API）
  + Hyperdrive（连接池）
  + Neon 或 Supabase 免费层
  + Stripe（只按笔抽成，无月费）
= 固定成本 ¥0
```

---

## 2. 10ms CPU 限制与它的解法

Workers Free 每次调用限 10ms **CPU 时间**（不含 I/O 等待）。结账路径里唯一 CPU 密集的动作是把确认屏渲染成 HTML。

**但确认屏根本不需要在请求时渲染。**

它显示的六项——分量、支払総額、支払時期方法、引渡時期、撤回解除、申込期限——**全部来自 OrderSpec，没有一项来自买主输入**。OrderSpec 在构建时就固定了。

所以：

```
构建时   prerender 确认屏 → dist/ 的静态资源
运行时   Pages 直接以静态文件返回，不触发 Worker 调用
```

结果是双重的：**CPU 风险消失，而且确认屏的请求根本不计入 Workers 额度。**

Worker 只剩两条真正需要动态的路由，两条都是 I/O 密集、CPU 极低：

```
POST /api/orders            写订单 + 调 Stripe
POST /api/webhooks/stripe   验签 + 状态迁移
```

**这个优化不是为了省额度，是因为它本来就是对的**：一个内容固定的页面不该每次请求重新渲染。

---

## 3. 架构前提：三处解耦

当前 `api/index.ts` 把平台 handler、DB 客户端构造和业务逻辑写在一个文件里，只能跑 Vercel。要支持多平台必须拆成：

```
src/lpmoo-runtime/checkout-app.ts     Hono app
                                      零平台假设、零 Node 假设、DB 由外部注入

api/index.ts                          Vercel        handle(app)
netlify/functions/checkout.ts         Netlify       handle(app)
functions/[[path]].ts                 CF Pages      handle(app) + Hyperdrive 绑定
wrangler.toml                         仅 CF 生成
```

### 3.1 去 Node 假设

现有代码用了 `node:crypto` 的 `randomUUID` / `createCipheriv` / `createHmac`。CF 开 `nodejs_compat` 后可用，但依赖兼容层意味着三个平台上跑的不是同一份代码。

改为 Web 标准：

```
randomUUID        → crypto.randomUUID()
createCipheriv    → crypto.subtle（AES-256-GCM）
createHmac        → crypto.subtle（HMAC-SHA256）
```

三个平台完全一致，不需要 `nodejs_compat`。

### 3.2 DB 注入

```ts
export function createCheckoutApp(deps: {
  db: CheckoutDatabase;
  stripe: StripeLike;
  orderSpec: OrderSpec;
  secrets: { piiKey: string; lookupPepper: string; webhookSecret: string };
}): Hono;
```

平台入口负责构造 `db`——Vercel/Netlify 用连接串，CF 用 Hyperdrive 绑定。业务逻辑不知道区别。

**这一步同时是 Nano Checkout 抽取的地基**：`checkout-app.ts` 一旦不依赖平台和 `.lpmoo/` 路径，它就已经是那个独立包了。

---

## 4. 目标矩阵

平台与数据库是正交的两个选择，2×3 都要跑通。

| | Supabase | Neon | 自带 Postgres |
|---|---|---|---|
| **CF Pages** | Hyperdrive 绑定 | Hyperdrive 绑定 | Hyperdrive 绑定（商户自建） |
| Vercel | integration 自动注入（零终端） | 连接串 | 连接串 |
| Netlify | 连接串 | 连接串 | 连接串 |

唯一需要额外步骤的是 **CF + 自带 Postgres**：Hyperdrive 绑定要商户自己创建，向导必须给出步骤。

连接串的注意事项按数据库分叉，不能写死成 Supabase 的说法：

```
Supabase   DATABASE_URL 用 6543（transaction pooler），DIRECT_URL 用 5432
           运行时误用 5432 会连接枯竭，症状断续且极难定位
Neon       连接串自带 pooler 端点
自带库      连接池策略由商户决定；CF 上走 Hyperdrive
```

---

## 5. 部署向导

### 5.1 CF Pages 路径（推荐，零固定成本）

```
1  仓库连到 Cloudflare Pages
2  数据库选择
     Supabase：建项目（东京区）→ 复制连接串
     Neon：建项目 → 复制连接串
     自带：填连接串
3  建 Hyperdrive 配置，绑定到 Pages 项目
4  填环境变量：Stripe 三个键 + 两个加密密钥
5  pnpm db:push 建表
6  Stripe 后台注册 webhook 指向 /api/webhooks/stripe
7  部署
```

第 3、5、6 步目前需要终端或后台操作。**零终端只有 Vercel + Supabase 组合能做到**，这是 Vercel 路径唯一的优势，值得保留作为付费用户的推荐路径。

### 5.2 必须在向导里写明的三件事

这三条是商户会踩一次、然后完全查不出原因的：

1. **Supabase 区域选东京（ap-northeast-1）** —— 延迟是次要的，主要是买主 PII 放美国区会变成个人情报保护法的越境移转问题
2. **运行时连接串用 pooler 端口** —— 用错是间歇性连接枯竭
3. **Supabase 免费层闲置会暂停** —— 正在收单的店铺睡过去等于静默丢单

---

## 6. 密钥与安全边界

```
浏览器可见     STRIPE_PUBLISHABLE_KEY、SUPABASE_ANON_KEY
仅服务端       STRIPE_SECRET_KEY、STRIPE_WEBHOOK_SECRET
              SUPABASE_SERVICE_ROLE_KEY、DATABASE_URL
              CHECKOUT_PII_KEY、CHECKOUT_LOOKUP_PEPPER
```

订单写入**必须**在服务端。浏览器能写订单就意味着浏览器能伪造订单。

`CHECKOUT_PII_KEY` 一旦生成不可更换——换掉之后既有订单的买主信息无法解密。向导必须说明这一点。

---

## 7. 分期

| 阶段 | 内容 | 产出 |
|---|---|---|
| **P0** | 拆 `checkout-app.ts`：去平台、去 Node、DB 注入 | 抽取地基 |
| **P1** | 确认屏改为构建时预渲染 | CPU 风险消失、不占 Workers 额度 |
| **P2** | CF Pages 入口 + `wrangler.toml` + Hyperdrive | 零固定成本路径跑通 |
| **P3** | 数据库分叉（Supabase / Neon / 自带）+ 向导分叉 | 2×3 矩阵 |
| **P4** | Vercel / Netlify 入口 | 覆盖已有付费用户 |
| **P5** | Vercel + Supabase 零终端流程 | 付费路径的体验优势 |

**P0 必须最先**，其余都依赖它。而且它同时把 Nano Checkout 的抽取推进了一大步。

---

## 8. 验收标准

- CF Pages + Neon 免费层能完成一笔真实测试订单，固定成本为零
- 确认屏由静态资源返回，不产生 Worker 调用
- 同一份 `checkout-app.ts` 在三个平台上无差异运行，不依赖 `nodejs_compat`
- 2×3 平台/数据库矩阵全部有可执行的向导步骤
- 向导明确写出区域、连接串端口、免费层暂停三条
- 导出的项目中不含任何密钥值

---

## 9. 明确不做

- 不把 Vercel 免费层作为推荐路径（条款排除商用）
- 不为节省额度牺牲正确性——确认屏预渲染是因为它本来就该预渲染
- 不强制 Supabase（开源发布的前提是数据库可替换）
- 不在导出项目里放任何密钥

---

## 附：调研来源（2026-08-30 实测）

- [Vercel Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines) —— Hobby 商用限制原文
- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) —— Free 100,000 请求/日、10ms CPU
- [Cloudflare Hyperdrive Pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/) —— Free 100,000 查询/日
- [Cloudflare Connecting to Databases](https://developers.cloudflare.com/workers/databases/connecting-to-databases/) —— TCP socket 直连，postgres.js / node-postgres 可用
- [Hono Cloudflare Pages](https://hono.dev/docs/getting-started/cloudflare-pages)
