export type OrderSpec = {
  storeName: string;
  storeMark: string;
  product: {
    name: string;
    edition: string;
    description: string;
    unitAmount: number;
    currency: 'jpy';
    image: string;
  };
  shippingAmount: number;
  legal: {
    quantity: string;
    total: string;
    payment: string;
    delivery: string;
    cancellation: string;
    applicationPeriod: string;
    seller: string;
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
    quantity: '1回のご注文につき1〜5点まで',
    total: '商品代金（税込）＋表示された送料',
    payment: 'クレジットカード。ご注文時に決済します。',
    delivery: '決済完了後、通常3〜5営業日以内に発送します。',
    cancellation: '発送前はキャンセル可能です。不良品を除き、発送後のお客様都合による返品は承っておりません。',
    applicationPeriod: '在庫がなくなり次第、受付を終了します。',
    seller: 'KINU Objects / 東京都渋谷区神宮前 0-0-0',
    contact: 'hello@example.com',
  },
};

export const formatYen = (amount: number) =>
  new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount);
