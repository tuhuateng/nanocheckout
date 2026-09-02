import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  LockKeyhole,
  Minus,
  Plus,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { formatYen, orderSpec } from '../config/order-spec';
import { AdminApp } from './AdminApp';

type CheckoutForm = {
  email: string;
  familyName: string;
  givenName: string;
  postalCode: string;
  prefecture: string;
  city: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
};

const initialForm: CheckoutForm = {
  email: '',
  familyName: '',
  givenName: '',
  postalCode: '',
  prefecture: '',
  city: '',
  addressLine1: '',
  addressLine2: '',
  phone: '',
};

type StorefrontProduct = {
  id: string;
  sku: string;
  name: string;
  edition: string;
  description: string;
  unitAmount: number;
  currency: 'jpy';
  shippingAmount: number;
  imageUrl: string;
  available: boolean;
};

const defaultStoreProduct: StorefrontProduct = {
  id: 'legacy-default',
  sku: 'default-product',
  name: orderSpec.product.name,
  edition: orderSpec.product.edition,
  description: orderSpec.product.description,
  unitAmount: orderSpec.product.unitAmount,
  currency: orderSpec.product.currency,
  shippingAmount: orderSpec.shippingAmount,
  imageUrl: orderSpec.product.image,
  available: true,
};

const prefectures = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県',
  '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県',
  '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県',
  '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
  '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

export function App() {
  if (window.location.pathname.startsWith('/admin')) return <AdminApp />;
  const isSuccess = window.location.pathname.startsWith('/success');
  if (isSuccess) return <SuccessView />;
  return <CheckoutView />;
}

function CheckoutView() {
  const [form, setForm] = useState(initialForm);
  const [quantity, setQuantity] = useState(1);
  const [accepted, setAccepted] = useState(false);
  const [product, setProduct] = useState(defaultStoreProduct);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const subtotal = useMemo(() => product.unitAmount * quantity, [product.unitAmount, quantity]);
  const total = subtotal + product.shippingAmount;

  useEffect(() => {
    const sku = new URLSearchParams(window.location.search).get('product');
    const endpoint = sku ? `/api/storefront/products/${encodeURIComponent(sku)}` : '/api/storefront/products';
    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) throw new Error('Product not found');
        return response.json() as Promise<{ product?: StorefrontProduct; products?: StorefrontProduct[] }>;
      })
      .then((result) => {
        const selected = result.product || result.products?.[0];
        if (selected) setProduct(selected);
      })
      .catch(() => {
        if (sku) {
          setProduct({
            ...defaultStoreProduct,
            sku,
            name: '現在購入できません',
            edition: 'Unavailable',
            description: '指定された商品は、販売を終了したか一時的に非公開になっています。',
            available: false,
          });
        }
      });
  }, []);

  const update = (field: keyof CheckoutForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accepted || submitting) return;
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({ ...form, quantity, sku: product.sku }),
      });
      const result = (await response.json()) as { checkoutUrl?: string; error?: string };
      if (!response.ok || !result.checkoutUrl) {
        throw new Error(result.error || '決済を開始できませんでした。');
      }
      window.location.assign(result.checkoutUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '通信エラーが発生しました。');
      setSubmitting(false);
    }
  };

  return (
    <main className="page-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label={`${orderSpec.storeName} ホーム`}>
          <span className="brand-mark">{orderSpec.storeMark}</span>
          <span>{orderSpec.storeName}</span>
        </a>
        <div className="secure-badge"><LockKeyhole size={14} /> Secure checkout</div>
      </header>

      <div className="checkout-layout">
        <section className="form-column">
          <div className="eyebrow"><span>Checkout</span><span className="line" /></div>
          <h1>お届け先と<br />お支払い</h1>
          <p className="lead">必要な情報を入力してください。次の画面で安全にカード決済を行います。</p>

          <form onSubmit={submit}>
            <fieldset>
              <legend><span>01</span>連絡先</legend>
              <label className="field full">
                <span>メールアドレス</span>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  required
                />
              </label>
            </fieldset>

            <fieldset>
              <legend><span>02</span>お届け先</legend>
              <div className="field-grid two">
                <label className="field">
                  <span>姓</span>
                  <input autoComplete="family-name" placeholder="山田" value={form.familyName} onChange={(e) => update('familyName', e.target.value)} required />
                </label>
                <label className="field">
                  <span>名</span>
                  <input autoComplete="given-name" placeholder="花子" value={form.givenName} onChange={(e) => update('givenName', e.target.value)} required />
                </label>
              </div>
              <div className="field-grid postal">
                <label className="field">
                  <span>郵便番号</span>
                  <input inputMode="numeric" autoComplete="postal-code" placeholder="150-0001" pattern="[0-9０-９-]{7,8}" value={form.postalCode} onChange={(e) => update('postalCode', e.target.value)} required />
                </label>
                <label className="field select-field">
                  <span>都道府県</span>
                  <select autoComplete="address-level1" value={form.prefecture} onChange={(e) => update('prefecture', e.target.value)} required>
                    <option value="" disabled>選択してください</option>
                    {prefectures.map((prefecture) => <option key={prefecture}>{prefecture}</option>)}
                  </select>
                  <ChevronDown size={16} />
                </label>
              </div>
              <label className="field full">
                <span>市区町村</span>
                <input autoComplete="address-level2" placeholder="渋谷区神宮前" value={form.city} onChange={(e) => update('city', e.target.value)} required />
              </label>
              <label className="field full">
                <span>番地</span>
                <input autoComplete="address-line1" placeholder="1-2-3" value={form.addressLine1} onChange={(e) => update('addressLine1', e.target.value)} required />
              </label>
              <label className="field full">
                <span>建物名・部屋番号 <em>任意</em></span>
                <input autoComplete="address-line2" placeholder="KINU ビル 101" value={form.addressLine2} onChange={(e) => update('addressLine2', e.target.value)} />
              </label>
              <label className="field full">
                <span>電話番号</span>
                <input type="tel" autoComplete="tel" inputMode="tel" placeholder="090-1234-5678" value={form.phone} onChange={(e) => update('phone', e.target.value)} required />
              </label>
            </fieldset>

            <label className="consent-row">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span className="custom-checkbox">{accepted && <Check size={14} strokeWidth={3} />}</span>
              <span><a href="/confirm/" target="_blank">購入条件・返品について</a>とプライバシーポリシーに同意します。</span>
            </label>

            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="pay-button" type="submit" disabled={!accepted || submitting || !product.available}>
              <span>{!product.available ? '現在売り切れです' : submitting ? '安全な決済画面へ移動中…' : `${formatYen(total)} を支払う`}</span>
              {!submitting && <ArrowRight size={19} />}
            </button>
            <p className="payment-note"><ShieldCheck size={16} /> カード情報は当サイトに保存されません。決済は Stripe が安全に処理します。</p>
          </form>
        </section>

        <aside className="summary-column">
          <div className="summary-sticky">
            <div className="product-image-wrap">
              <img src={product.imageUrl} alt={product.name} />
              <span className="edition-pill">{product.edition}</span>
            </div>
            <div className="product-heading">
              <div>
                <p>Edition 01</p>
                <h2>{product.name}</h2>
              </div>
              <span>{formatYen(product.unitAmount)}</span>
            </div>
            <p className="product-description">{product.description}</p>
            <div className="quantity-row">
              <span>数量</span>
              <div className="quantity-control">
                <button type="button" aria-label="数量を減らす" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={quantity === 1}><Minus size={14} /></button>
                <span>{quantity}</span>
                <button type="button" aria-label="数量を増やす" onClick={() => setQuantity((value) => Math.min(5, value + 1))} disabled={quantity === 5}><Plus size={14} /></button>
              </div>
            </div>
            <div className="totals">
              <div><span>小計</span><span>{formatYen(subtotal)}</span></div>
              <div><span>送料</span><span>{product.shippingAmount ? formatYen(product.shippingAmount) : '無料'}</span></div>
              <div className="total"><span>合計 <small>税込</small></span><strong>{formatYen(total)}</strong></div>
            </div>
            <div className="promise"><Sparkles size={17} /><span><strong>小さく、長く使えるもの。</strong>ひとつずつ検品してお届けします。</span></div>
          </div>
        </aside>
      </div>

      <footer>
        <span>© 2026 {orderSpec.storeName}</span>
        <nav><a href="/confirm/">販売条件</a><a href={`mailto:${orderSpec.legal.contact}`}>お問い合わせ</a></nav>
        <span className="powered">Checkout by <strong>Nano</strong></span>
      </footer>
    </main>
  );
}

function SuccessView() {
  const isDemo = new URLSearchParams(window.location.search).get('demo') === '1';
  return (
    <main className="success-shell">
      <a className="brand" href="/"><span className="brand-mark">{orderSpec.storeMark}</span><span>{orderSpec.storeName}</span></a>
      <section className="success-card">
        <div className="success-icon"><Check size={32} /></div>
        <p className="eyebrow-text">Order confirmed</p>
        <h1>{isDemo ? 'デモ注文を受け付けました。' : 'ご注文ありがとうございます。'}</h1>
        <p>{isDemo ? 'Stripe のキーを設定すると、ここまでの流れを実際のテスト決済に切り替えられます。' : '確認メールをお送りしました。商品の発送まで、もうしばらくお待ちください。'}</p>
        <a className="back-link" href="/"><ArrowLeft size={17} /> ストアへ戻る</a>
      </section>
    </main>
  );
}
