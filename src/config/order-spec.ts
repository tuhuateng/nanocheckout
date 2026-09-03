export type OrderSpec = {
  storeName: string;
  storeMark: string;
  // Stripe line item shape. Every order overwrites this with its product row.
  product: {
    name: string;
    edition: string;
    description: string;
    unitAmount: number;
    currency: 'jpy';
    image: string;
  };
  shippingAmount: number;
  // Rendered into /confirm/. The seller details are placeholders and must be
  // replaced with the real business before selling anything.
  legal: {
    price: string;
    quantity: string;
    shipping: string;
    total: string;
    payment: string;
    delivery: string;
    cancellation: string;
    applicationPeriod: string;
    sellerName: string;
    representative: string;
    address: string;
    phone: string;
    contact: string;
  };
};

export const orderSpec: OrderSpec = {
  storeName: 'KINU Objects',
  storeMark: 'K / O',
  product: {
    name: 'Everyday Carry Tray',
    edition: 'Sand / Edition 01',
    description: '玄関やデスクの小物を静かに整える、植物由来素材のミニトレイ。',
    unitAmount: 4200,
    currency: 'jpy',
    image: '/product-tray.svg',
  },
  shippingAmount: 0,
  legal: {
    price: '各商品ページに表示された税込価格',
    quantity: '1回のご注文につき1〜5点まで',
    shipping: '各商品ページおよび注文画面に表示します。',
    total: '商品代金（税込）＋表示された送料',
    payment: 'クレジットカード。ご注文時に決済します。',
    delivery: '決済完了後、通常3〜5営業日以内に発送します。',
    cancellation: '発送前はキャンセル可能です。不良品を除き、発送後のお客様都合による返品は承っておりません。',
    applicationPeriod: '在庫がなくなり次第、受付を終了します。',
    sellerName: 'KINU Objects',
    representative: '山田 太郎',
    address: '〒150-0001 東京都渋谷区神宮前 0-0-0',
    phone: '03-0000-0000',
    contact: 'hello@example.com',
  },
};

export const formatYen = (amount: number) =>
  new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount);
