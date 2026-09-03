import type { OrderSpec } from '../config/order-spec';

export type OrderStatus = 'pending' | 'paid' | 'payment_failed' | 'cancelled';
export type ProductStatus = 'active' | 'draft' | 'archived';

export type ProductRecord = {
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
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type ProductInput = Omit<ProductRecord, 'id' | 'createdAt' | 'updatedAt'>;

export class ProductUnavailableError extends Error {
  constructor() {
    super('Product is unavailable or out of stock');
    this.name = 'ProductUnavailableError';
  }
}

export type PendingOrderInput = {
  id: string;
  idempotencyKey: string;
  emailLookup: string;
  encryptedPii: string;
  quantity: number;
  unitAmount: number;
  shippingAmount: number;
  totalAmount: number;
  currency: string;
  productId: string | null;
  productName: string;
  externalUserId: string | null;
};

export type OrderRecord = {
  id: string;
  status: OrderStatus;
  paymentSessionId: string | null;
};

export type AdminOrderRecord = OrderRecord & {
  encryptedPii: string;
  quantity: number;
  unitAmount: number;
  shippingAmount: number;
  totalAmount: number;
  currency: string;
  productId: string | null;
  productName: string;
  shippedAt: string | Date | null;
  trackingNumber: string | null;
  externalUserId: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type OrderQuery = {
  limit: number;
  status?: OrderStatus;
  emailLookup?: string;
  idPrefix?: string;
};

export type FulfillmentPatch = {
  shippedAt?: Date | null;
  trackingNumber?: string | null;
};

export type OrderStats = {
  totalOrders: number;
  todayOrders: number;
  pendingOrders: number;
  paidOrders: number;
  paidGross: number;
};

export interface CheckoutDatabase {
  createPendingOrder(input: PendingOrderInput): Promise<OrderRecord>;
  attachPaymentSession(orderId: string, paymentSessionId: string): Promise<void>;
  transitionPaymentSession(paymentSessionId: string, status: OrderStatus): Promise<void>;
  listOrders(options: OrderQuery): Promise<AdminOrderRecord[]>;
  getOrder(orderId: string): Promise<AdminOrderRecord | null>;
  updateFulfillment(orderId: string, patch: FulfillmentPatch): Promise<AdminOrderRecord | null>;
  getOrderStats(): Promise<OrderStats>;
  listProducts(options?: { includeArchived?: boolean }): Promise<ProductRecord[]>;
  getProductBySku(sku: string): Promise<ProductRecord | null>;
  createProduct(product: ProductInput & { id: string }): Promise<ProductRecord>;
  updateProduct(productId: string, patch: Partial<ProductInput>): Promise<ProductRecord | null>;
  cancelPendingOrder(orderId: string): Promise<void>;
}

export type StripeSessionInput = {
  orderId: string;
  idempotencyKey: string;
  customerEmail: string;
  quantity: number;
  orderSpec: OrderSpec;
  successUrl: string;
  cancelUrl: string;
};

export type StripeSession = {
  id: string;
  url: string;
};

export type VerifiedStripeEvent = {
  type: string;
  paymentSessionId: string;
};

export interface StripeLike {
  createCheckoutSession(input: StripeSessionInput): Promise<StripeSession>;
  verifyWebhook(payload: string, signature: string, secret: string): Promise<VerifiedStripeEvent>;
}

export type CheckoutSecrets = {
  piiKey: string;
  lookupPepper: string;
  webhookSecret: string;
  adminPasswordHash: string;
  adminSessionSecret: string;
  mcpToken?: string;
};
