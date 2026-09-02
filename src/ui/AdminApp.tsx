import { type CSSProperties, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Box,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Eye,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  PackageCheck,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Store,
  X,
} from 'lucide-react';
import { formatYen, orderSpec } from '../config/order-spec';

type OrderStatus = 'pending' | 'paid' | 'payment_failed' | 'cancelled';

type AdminOrder = {
  id: string;
  status: OrderStatus;
  paymentSessionId: string | null;
  productId: string | null;
  productName: string;
  quantity: number;
  unitAmount: number;
  shippingAmount: number;
  totalAmount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  buyer: {
    email: string;
    familyName: string;
    givenName: string;
    postalCode: string;
    prefecture: string;
    city: string;
    addressLine1: string;
    addressLine2?: string;
    phone: string;
  };
};

type ProductStatus = 'active' | 'draft' | 'archived';

type AdminProduct = {
  id: string;
  sku: string;
  name: string;
  edition: string;
  description: string;
  unitAmount: number;
  currency: 'jpy';
  shippingAmount: number;
  imageUrl: string;
  status: ProductStatus;
  inventory: number | null;
  createdAt: string;
  updatedAt: string;
};

type Stats = {
  totalOrders: number;
  todayOrders: number;
  pendingOrders: number;
  paidOrders: number;
  paidGross: number;
};

const statusLabel: Record<OrderStatus, string> = {
  pending: '決済待ち',
  paid: '決済済み',
  payment_failed: '決済失敗',
  cancelled: 'キャンセル',
};

const filters: Array<{ value: '' | OrderStatus; label: string }> = [
  { value: '', label: 'すべて' },
  { value: 'paid', label: '決済済み' },
  { value: 'pending', label: '決済待ち' },
  { value: 'cancelled', label: 'キャンセル' },
];

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

export function AdminApp() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    document.title = `Merchant — ${orderSpec.storeName}`;
    return () => { document.title = 'Nano Checkout — Simple, secure checkout'; };
  }, []);

  useEffect(() => {
    fetch('/api/admin/session')
      .then((response) => response.json() as Promise<{ authenticated: boolean; demoMode: boolean }>)
      .then((result: { authenticated: boolean; demoMode: boolean }) => {
        setAuthenticated(result.authenticated);
        setDemoMode(result.demoMode);
      })
      .finally(() => setChecking(false));
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    const response = await fetch('/api/admin/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const result = (await response.json()) as { authenticated?: boolean; error?: string };
    if (!response.ok) {
      setLoginError(result.error || 'ログインできませんでした。');
      setLoggingIn(false);
      return;
    }
    setAuthenticated(true);
    setPassword('');
    setLoggingIn(false);
  };

  if (checking) return <div className="admin-loading"><LoaderCircle className="spin" /><span>Loading workspace</span></div>;
  if (!authenticated) return <AdminLogin password={password} setPassword={setPassword} submit={login} error={loginError} loading={loggingIn} demoMode={demoMode} />;
  return <AdminDashboard onLogout={() => setAuthenticated(false)} />;
}

function AdminLogin({ password, setPassword, submit, error, loading, demoMode }: {
  password: string;
  setPassword: (value: string) => void;
  submit: (event: FormEvent) => void;
  error: string;
  loading: boolean;
  demoMode: boolean;
}) {
  return (
    <main className="admin-login-shell">
      <section className="admin-login-visual">
        <a className="admin-login-brand" href="/"><span>{orderSpec.storeMark}</span>{orderSpec.storeName}</a>
        <div className="login-visual-copy">
          <p>Nano merchant workspace</p>
          <h1>小さなストアを、<br />落ち着いて見渡す。</h1>
          <span>注文、決済、配送先情報をひとつの場所で。</span>
        </div>
        <div className="login-orbit"><span /><span /><span /></div>
        <p className="login-footer-copy">Secure merchant access · AES-256-GCM</p>
      </section>
      <section className="admin-login-panel">
        <form onSubmit={submit} className="admin-login-form">
          <div className="login-lock"><LockKeyhole size={21} /></div>
          <p className="admin-kicker">Merchant sign in</p>
          <h2>管理画面にログイン</h2>
          <p className="login-description">ストア管理者用のパスワードを入力してください。</p>
          <label>
            <span>管理者パスワード</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••••" autoFocus />
          </label>
          {demoMode && <div className="demo-credential"><span>LOCAL DEMO</span><code>nano-demo-2026</code></div>}
          {error && <p className="admin-login-error">{error}</p>}
          <button type="submit" disabled={!password || loading}>
            {loading ? <LoaderCircle className="spin" size={18} /> : 'ログイン'}
            {!loading && <ChevronRight size={18} />}
          </button>
          <a href="/">← ストアへ戻る</a>
        </form>
      </section>
    </main>
  );
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [filter, setFilter] = useState<'' | OrderStatus>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<AdminProduct | 'new' | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    const [response, productResponse] = await Promise.all([
      fetch('/api/admin/summary'),
      fetch('/api/admin/products'),
    ]);
    if (response.status === 401 || productResponse.status === 401) return onLogout();
    const result = (await response.json()) as { stats: Stats; orders: AdminOrder[] };
    const productResult = (await productResponse.json()) as { products: AdminProduct[] };
    setStats(result.stats);
    setOrders(result.orders);
    setProducts(productResult.products);
    setLoading(false);
  }, [onLogout]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const changeFilter = async (value: '' | OrderStatus) => {
    setFilter(value);
    setLoading(true);
    const query = value ? `?status=${value}` : '';
    const response = await fetch(`/api/admin/orders${query}`);
    if (response.status === 401) return onLogout();
    const result = (await response.json()) as { orders: AdminOrder[] };
    setOrders(result.orders);
    setLoading(false);
  };

  const logout = async () => {
    await fetch('/api/admin/session', { method: 'DELETE' });
    onLogout();
  };

  const visibleOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) => [order.id, order.buyer.email, order.buyer.familyName, order.buyer.givenName].join(' ').toLowerCase().includes(needle));
  }, [orders, search]);

  const paidRate = stats?.totalOrders ? Math.round((stats.paidOrders / stats.totalOrders) * 100) : 0;

  const updateProductStatus = async (product: AdminProduct) => {
    const status: ProductStatus = product.status === 'active' ? 'draft' : 'active';
    const response = await fetch(`/api/admin/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) return;
    const result = await response.json() as { product: AdminProduct };
    setProducts((current) => current.map((item) => item.id === product.id ? result.product : item));
  };

  const productSaved = (product: AdminProduct) => {
    setProducts((current) => {
      const exists = current.some((item) => item.id === product.id);
      return exists ? current.map((item) => item.id === product.id ? product : item) : [product, ...current];
    });
    setEditingProduct(null);
  };

  return (
    <main className="admin-shell">
      <aside className={`admin-sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="admin-side-brand"><span>{orderSpec.storeMark}</span><div>{orderSpec.storeName}<small>Merchant</small></div></div>
        <nav>
          <a className="active" href="#overview"><LayoutDashboard size={17} />概要</a>
          <a href="#orders"><ShoppingBag size={17} />注文</a>
          <a href="#products"><Box size={17} />商品</a>
          <a href="/" target="_blank"><Store size={17} />ストアを見る</a>
        </nav>
        <div className="admin-side-bottom">
          <div className="store-health"><span /><div><strong>Store online</strong><small>API operating normally</small></div></div>
          <button onClick={logout}><LogOut size={16} />ログアウト</button>
        </div>
      </aside>
      {menuOpen && <button className="sidebar-scrim" aria-label="メニューを閉じる" onClick={() => setMenuOpen(false)} />}

      <section className="admin-content">
        <header className="admin-topbar">
          <button className="mobile-menu" aria-label="メニューを開く" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
          <div><span>Workspace</span><strong>{orderSpec.storeName}</strong></div>
          <div className="admin-profile"><span>KO</span><div>Store owner<small>Administrator</small></div></div>
        </header>

        <div className="admin-main" id="overview">
          <div className="admin-title-row">
            <div><p className="admin-kicker">Overview</p><h1>おはようございます。</h1><span>ストアの今を、ひと目で確認できます。</span></div>
            <div className="date-chip"><Clock3 size={15} />{new Intl.DateTimeFormat('ja-JP', { dateStyle: 'long' }).format(new Date())}</div>
          </div>

          <section className="metric-grid">
            <MetricCard icon={<CircleDollarSign size={19} />} label="決済済み売上" value={formatYen(stats?.paidGross || 0)} trend="入金ベース" accent />
            <MetricCard icon={<ShoppingBag size={19} />} label="総注文数" value={String(stats?.totalOrders || 0)} trend={`本日 +${stats?.todayOrders || 0}`} />
            <MetricCard icon={<PackageCheck size={19} />} label="決済済み" value={String(stats?.paidOrders || 0)} trend={`${paidRate}% of total`} positive />
            <MetricCard icon={<Clock3 size={19} />} label="対応待ち" value={String(stats?.pendingOrders || 0)} trend="決済ステータス確認" warning />
          </section>

          <section className="admin-insight-row">
            <div className="admin-insight-card">
              <div><p className="admin-kicker">Payment health</p><h2>決済状況</h2></div>
              <div className="rate-ring" style={{ '--rate': `${paidRate * 3.6}deg` } as CSSProperties}><span><strong>{paidRate}%</strong><small>paid</small></span></div>
              <div className="rate-copy"><CheckCircle2 size={18} /><span><strong>正常に稼働中</strong>Stripe webhook から注文状態を自動更新します。</span></div>
            </div>
            <div className="admin-product-card">
              <img src={orderSpec.product.image} alt="" />
              <div><p className="admin-kicker">Your product</p><h2>{orderSpec.product.name}</h2><span>{formatYen(orderSpec.product.unitAmount)} · {orderSpec.product.edition}</span></div>
              <a href="/" target="_blank"><Eye size={15} />ストアで見る</a>
            </div>
          </section>

          <section className="orders-panel" id="orders">
            <div className="orders-heading">
              <div><p className="admin-kicker">Orders</p><h2>最近の注文</h2></div>
              <label className="order-search"><Search size={16} /><input aria-label="注文を検索" placeholder="名前・メール・注文ID" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            </div>
            <div className="order-filters">
              {filters.map((option) => <button key={option.value || 'all'} className={filter === option.value ? 'active' : ''} onClick={() => void changeFilter(option.value)}>{option.label}</button>)}
            </div>
            <div className="orders-table-wrap">
              <table className="orders-table">
                <thead><tr><th>注文</th><th>お客様</th><th>日時</th><th>金額</th><th>ステータス</th><th /></tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={6} className="table-state"><LoaderCircle className="spin" />読み込み中</td></tr>}
                  {!loading && visibleOrders.length === 0 && <tr><td colSpan={6} className="table-state"><Box />該当する注文はありません</td></tr>}
                  {!loading && visibleOrders.map((order) => (
                    <tr key={order.id} onClick={() => setSelected(order)}>
                      <td><strong>#{order.id.slice(0, 8).toUpperCase()}</strong><small>{order.quantity} item{order.quantity > 1 ? 's' : ''}</small></td>
                      <td><strong>{order.buyer.familyName} {order.buyer.givenName}</strong><small>{order.buyer.email}</small></td>
                      <td>{dateFormatter.format(new Date(order.createdAt))}</td>
                      <td><strong>{formatYen(order.totalAmount)}</strong></td>
                      <td><StatusBadge status={order.status} /></td>
                      <td><button aria-label="注文詳細を表示"><ChevronRight size={16} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="products-panel" id="products">
            <div className="products-heading">
              <div><p className="admin-kicker">Products</p><h2>商品管理</h2><span>{products.filter((product) => product.status === 'active').length} 件を販売中</span></div>
              <button onClick={() => setEditingProduct('new')}><Plus size={15} />商品を追加</button>
            </div>
            <div className="product-admin-grid">
              {products.map((product) => (
                <article className={`product-admin-card ${product.status}`} key={product.id}>
                  <div className="product-admin-image"><img src={product.imageUrl} alt="" /><span>{product.status === 'active' ? '販売中' : product.status === 'draft' ? '下書き' : 'アーカイブ'}</span></div>
                  <div className="product-admin-body">
                    <small>{product.sku}</small>
                    <h3>{product.name}</h3>
                    <p>{product.edition || 'Standard edition'}</p>
                    <div className="product-admin-meta"><strong>{formatYen(product.unitAmount)}</strong><span>{product.inventory === null ? '在庫 ∞' : `在庫 ${product.inventory}`}</span></div>
                  </div>
                  <div className="product-admin-actions">
                    <a href={`/?product=${encodeURIComponent(product.sku)}`} target="_blank"><Eye size={14} />プレビュー</a>
                    <button onClick={() => setEditingProduct(product)}><Pencil size={14} />編集</button>
                    {product.status !== 'archived' && <button className="publish-toggle" onClick={() => void updateProductStatus(product)}>{product.status === 'active' ? '販売停止' : '販売開始'}</button>}
                  </div>
                </article>
              ))}
              {products.length === 0 && <button className="empty-product-card" onClick={() => setEditingProduct('new')}><Plus size={22} /><strong>最初の商品を追加</strong><span>名前、価格、画像を設定して販売を始めます。</span></button>}
            </div>
          </section>
        </div>
      </section>

      {selected && <OrderDrawer order={selected} close={() => setSelected(null)} />}
      {editingProduct && <ProductEditor product={editingProduct === 'new' ? null : editingProduct} close={() => setEditingProduct(null)} saved={productSaved} />}
    </main>
  );
}

function MetricCard({ icon, label, value, trend, accent, positive, warning }: { icon: ReactNode; label: string; value: string; trend: string; accent?: boolean; positive?: boolean; warning?: boolean }) {
  return <article className={`metric-card ${accent ? 'accent' : ''}`}><div className="metric-icon">{icon}</div><p>{label}</p><strong>{value}</strong><span className={positive ? 'positive' : warning ? 'warning' : ''}>{positive ? <ArrowUpRight size={13} /> : warning ? <ArrowDownRight size={13} /> : null}{trend}</span></article>;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status-badge ${status}`}><i />{statusLabel[status]}</span>;
}

function OrderDrawer({ order, close }: { order: AdminOrder; close: () => void }) {
  const address = `〒${order.buyer.postalCode} ${order.buyer.prefecture}${order.buyer.city}${order.buyer.addressLine1}${order.buyer.addressLine2 ? ` ${order.buyer.addressLine2}` : ''}`;
  return <div className="drawer-layer"><button className="drawer-scrim" aria-label="詳細を閉じる" onClick={close} /><aside className="order-drawer">
    <header><div><p className="admin-kicker">Order detail</p><h2>#{order.id.slice(0, 8).toUpperCase()}</h2></div><button aria-label="閉じる" onClick={close}><X size={20} /></button></header>
    <div className="drawer-status"><StatusBadge status={order.status} /><span>{new Intl.DateTimeFormat('ja-JP', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(order.createdAt))}</span></div>
    <section><h3>商品</h3><div className="drawer-product"><div className="drawer-product-icon"><ShoppingBag size={19} /></div><div><strong>{order.productName}</strong><span>数量 {order.quantity}</span></div><strong>{formatYen(order.totalAmount)}</strong></div></section>
    <section><h3>お客様</h3><dl><div><dt>お名前</dt><dd>{order.buyer.familyName} {order.buyer.givenName}</dd></div><div><dt>メール</dt><dd><a href={`mailto:${order.buyer.email}`}>{order.buyer.email}</a></dd></div><div><dt>電話番号</dt><dd>{order.buyer.phone}</dd></div></dl></section>
    <section><h3>お届け先</h3><p className="drawer-address">{address}</p></section>
    <section><h3>決済情報</h3><dl><div><dt>商品小計</dt><dd>{formatYen(order.unitAmount * order.quantity)}</dd></div><div><dt>送料</dt><dd>{order.shippingAmount ? formatYen(order.shippingAmount) : '無料'}</dd></div><div className="drawer-total"><dt>合計</dt><dd>{formatYen(order.totalAmount)}</dd></div></dl>{order.paymentSessionId && <code className="session-code">{order.paymentSessionId}</code>}</section>
  </aside></div>;
}

function ProductEditor({ product, close, saved }: { product: AdminProduct | null; close: () => void; saved: (product: AdminProduct) => void }) {
  const [form, setForm] = useState({
    name: product?.name || '',
    sku: product?.sku || '',
    edition: product?.edition || '',
    description: product?.description || '',
    unitAmount: String(product?.unitAmount ?? ''),
    shippingAmount: String(product?.shippingAmount ?? 0),
    imageUrl: product?.imageUrl || '/product-tray.svg',
    status: product?.status || 'draft' as ProductStatus,
    inventory: product?.inventory === null || product?.inventory === undefined ? '' : String(product.inventory),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    const response = await fetch(product ? `/api/admin/products/${product.id}` : '/api/admin/products', {
      method: product ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...form,
        unitAmount: Number(form.unitAmount),
        shippingAmount: Number(form.shippingAmount),
        inventory: form.inventory === '' ? null : Number(form.inventory),
        currency: 'jpy',
      }),
    });
    const result = await response.json() as { product?: AdminProduct; error?: string };
    if (!response.ok || !result.product) {
      setError(result.error || '保存できませんでした。');
      setSaving(false);
      return;
    }
    saved(result.product);
  };

  return <div className="drawer-layer"><button className="drawer-scrim" aria-label="商品編集を閉じる" onClick={close} /><aside className="product-editor">
    <header><div><p className="admin-kicker">{product ? 'Edit product' : 'New product'}</p><h2>{product ? '商品を編集' : '商品を追加'}</h2></div><button aria-label="閉じる" onClick={close}><X size={20} /></button></header>
    <form onSubmit={submit}>
      <div className="editor-preview"><img src={form.imageUrl || '/product-tray.svg'} alt="" onError={(event) => { event.currentTarget.src = '/product-tray.svg'; }} /><div><span>Preview</span><strong>{form.name || '商品名'}</strong><small>{form.unitAmount ? formatYen(Number(form.unitAmount)) : '価格未設定'}</small></div></div>
      <div className="editor-fields two"><label><span>商品名</span><input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Everyday Carry Tray" required /></label><label><span>SKU</span><input value={form.sku} onChange={(event) => update('sku', event.target.value.toLowerCase())} placeholder="everyday-tray-01" pattern="[a-z0-9][a-z0-9._-]*" required /></label></div>
      <label><span>エディション・バリエーション</span><input value={form.edition} onChange={(event) => update('edition', event.target.value)} placeholder="Sand / Edition 01" /></label>
      <label><span>商品説明</span><textarea value={form.description} onChange={(event) => update('description', event.target.value)} rows={4} placeholder="商品の特徴や素材について" /></label>
      <div className="editor-fields two"><label><span>価格（税込・円）</span><input type="number" min="0" inputMode="numeric" value={form.unitAmount} onChange={(event) => update('unitAmount', event.target.value)} required /></label><label><span>送料（円）</span><input type="number" min="0" inputMode="numeric" value={form.shippingAmount} onChange={(event) => update('shippingAmount', event.target.value)} required /></label></div>
      <div className="editor-fields two"><label><span>在庫数 <em>空欄は無制限</em></span><input type="number" min="0" inputMode="numeric" value={form.inventory} onChange={(event) => update('inventory', event.target.value)} placeholder="∞" /></label><label><span>公開状態</span><select value={form.status} onChange={(event) => update('status', event.target.value)}><option value="draft">下書き</option><option value="active">販売中</option><option value="archived">アーカイブ</option></select></label></div>
      <label><span>商品画像 URL</span><input value={form.imageUrl} onChange={(event) => update('imageUrl', event.target.value)} placeholder="https://... または /image.jpg" required /></label>
      <p className="editor-help">画像は HTTPS URL、または public フォルダ内の `/` から始まるパスを指定できます。</p>
      {error && <p className="editor-error">{error}</p>}
      <div className="editor-footer"><button type="button" onClick={close}>キャンセル</button><button type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : product ? '変更を保存' : '商品を作成'}</button></div>
    </form>
  </aside></div>;
}
