import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { formatYen, orderSpec } from '../src/config/order-spec';

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const rows = [
  ['販売数量', orderSpec.legal.quantity],
  ['お支払総額', orderSpec.legal.total],
  ['支払時期・方法', orderSpec.legal.payment],
  ['商品の引渡時期', orderSpec.legal.delivery],
  ['撤回・解除について', orderSpec.legal.cancellation],
  ['申込期間', orderSpec.legal.applicationPeriod],
];

const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#f3f1ea">
  <title>販売条件 — ${escapeHtml(orderSpec.storeName)}</title>
  <style>
    :root{font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif;color:#252620;background:#f3f1ea}*{box-sizing:border-box}body{margin:0}.shell{width:min(880px,calc(100% - 40px));margin:0 auto;padding:32px 0 80px}.header{height:62px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #d8d4ca}.brand{font-size:13px;font-weight:700;letter-spacing:.08em}.back{color:#66685f;font-size:12px;text-underline-offset:4px}.intro{padding:70px 0 46px}.eyebrow{color:#b65e3d;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}h1{margin:14px 0;font-size:clamp(34px,7vw,58px);font-weight:500;letter-spacing:-.06em}p{color:#6d6d65;font-size:13px;line-height:1.85}.product{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:24px;border:1px solid #d8d4ca;background:#ebe8df}.product small{display:block;margin-bottom:6px;color:#a05137;letter-spacing:.12em}.product strong{font-size:18px;font-weight:600}.price{font-size:18px;white-space:nowrap}.terms{margin-top:22px;border-top:1px solid #cfcbbf}.row{display:grid;grid-template-columns:210px 1fr;gap:32px;padding:24px 4px;border-bottom:1px solid #d8d4ca}.row dt{font-size:12px;font-weight:600}.row dd{margin:0;color:#66685f;font-size:12px;line-height:1.8}.seller{margin-top:54px;padding:28px;background:#253e34;color:#f3f1ea}.seller h2{margin:0 0 17px;font-size:14px}.seller p{margin:4px 0;color:#d8ded8;font-size:11px}.seller a{color:#fff}.note{margin-top:28px;font-size:10px}.static-badge{padding:7px 10px;border-radius:20px;background:#e4e0d6;color:#77776f;font-size:9px;letter-spacing:.06em}@media(max-width:620px){.intro{padding-top:48px}.row{grid-template-columns:1fr;gap:8px}.product{align-items:flex-start;flex-direction:column}.static-badge{display:none}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="header"><span class="brand">${escapeHtml(orderSpec.storeName)}</span><a class="back" href="/">← チェックアウトへ戻る</a></header>
    <section class="intro"><span class="eyebrow">Terms of sale</span><h1>購入条件の確認</h1><p>ご注文前に、以下の販売条件をご確認ください。</p></section>
    <section class="product"><div><small>${escapeHtml(orderSpec.product.edition)}</small><strong>${escapeHtml(orderSpec.product.name)}</strong></div><span class="price">${formatYen(orderSpec.product.unitAmount)} / 点</span></section>
    <dl class="terms">${rows.map(([term, detail]) => `<div class="row"><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(detail)}</dd></div>`).join('')}</dl>
    <section class="seller"><h2>販売事業者</h2><p>${escapeHtml(orderSpec.legal.seller)}</p><p><a href="mailto:${escapeHtml(orderSpec.legal.contact)}">${escapeHtml(orderSpec.legal.contact)}</a></p></section>
    <p class="note">このページは OrderSpec からビルド時に生成された静的ページです。購入者の入力情報は含まれません。</p>
  </main>
</body>
</html>`;

const outputDirectory = resolve('dist/confirm');
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, 'index.html'), html, 'utf8');
console.log('Prerendered static confirmation page: dist/confirm/index.html');
