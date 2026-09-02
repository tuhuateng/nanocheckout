import { ProductUnavailableError, type AdminOrderRecord, type CheckoutDatabase, type OrderRecord, type OrderStats, type OrderStatus, type PendingOrderInput, type ProductInput, type ProductRecord } from './types';

export class MemoryCheckoutDatabase implements CheckoutDatabase {
  private readonly orders = new Map<string, AdminOrderRecord>();
  private readonly idempotency = new Map<string, string>();
  private readonly products = new Map<string, ProductRecord>();

  constructor(initialProducts: ProductRecord[] = []) {
    for (const product of initialProducts) this.products.set(product.id, { ...product });
  }

  async createPendingOrder(input: PendingOrderInput): Promise<OrderRecord> {
    const existingId = this.idempotency.get(input.idempotencyKey);
    if (existingId) return this.orders.get(existingId)!;
    if (input.productId) {
      const product = this.products.get(input.productId);
      if (!product || product.status !== 'active' || (product.inventory !== null && product.inventory < input.quantity)) {
        throw new ProductUnavailableError();
      }
      if (product.inventory !== null) product.inventory -= input.quantity;
      product.updatedAt = new Date();
    }
    const now = new Date();
    const order: AdminOrderRecord = {
      id: input.id,
      status: 'pending',
      paymentSessionId: null,
      encryptedPii: input.encryptedPii,
      quantity: input.quantity,
      unitAmount: input.unitAmount,
      shippingAmount: input.shippingAmount,
      totalAmount: input.totalAmount,
      currency: input.currency,
      productId: input.productId,
      productName: input.productName,
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(input.id, order);
    this.idempotency.set(input.idempotencyKey, input.id);
    return order;
  }

  async attachPaymentSession(orderId: string, paymentSessionId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error('Order not found');
    order.paymentSessionId = paymentSessionId;
    order.updatedAt = new Date();
  }

  async transitionPaymentSession(paymentSessionId: string, status: OrderStatus): Promise<void> {
    const order = Array.from(this.orders.values()).find((candidate) => candidate.paymentSessionId === paymentSessionId);
    if (!order) return;
    const shouldReleaseInventory = status === 'cancelled' && order.status !== 'cancelled';
    order.status = status;
    order.updatedAt = new Date();
    if (shouldReleaseInventory && order.productId) {
      const product = this.products.get(order.productId);
      if (product?.inventory !== null && product?.inventory !== undefined) product.inventory += order.quantity;
    }
  }

  async listOrders(options: { limit: number; status?: OrderStatus }): Promise<AdminOrderRecord[]> {
    return Array.from(this.orders.values())
      .filter((order) => !options.status || order.status === options.status)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, options.limit);
  }

  async getOrder(orderId: string): Promise<AdminOrderRecord | null> {
    return this.orders.get(orderId) || null;
  }

  async getOrderStats(): Promise<OrderStats> {
    const orders = Array.from(this.orders.values());
    const today = new Date();
    const isToday = (value: string | Date) => {
      const date = new Date(value);
      return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    };
    return {
      totalOrders: orders.length,
      todayOrders: orders.filter((order) => isToday(order.createdAt)).length,
      pendingOrders: orders.filter((order) => order.status === 'pending').length,
      paidOrders: orders.filter((order) => order.status === 'paid').length,
      paidGross: orders.filter((order) => order.status === 'paid').reduce((sum, order) => sum + order.totalAmount, 0),
    };
  }

  async listProducts(options: { includeArchived?: boolean } = {}): Promise<ProductRecord[]> {
    return Array.from(this.products.values())
      .filter((product) => options.includeArchived || product.status !== 'archived')
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .map((product) => ({ ...product }));
  }

  async getProductBySku(sku: string): Promise<ProductRecord | null> {
    const product = Array.from(this.products.values()).find((candidate) => candidate.sku === sku);
    return product ? { ...product } : null;
  }

  async createProduct(input: ProductInput & { id: string }): Promise<ProductRecord> {
    if (Array.from(this.products.values()).some((product) => product.sku === input.sku)) throw new Error('SKU already exists');
    const now = new Date();
    const product: ProductRecord = { ...input, createdAt: now, updatedAt: now };
    this.products.set(product.id, product);
    return { ...product };
  }

  async updateProduct(productId: string, patch: Partial<ProductInput>): Promise<ProductRecord | null> {
    const current = this.products.get(productId);
    if (!current) return null;
    if (patch.sku && Array.from(this.products.values()).some((product) => product.id !== productId && product.sku === patch.sku)) {
      throw new Error('SKU already exists');
    }
    const updated: ProductRecord = { ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: new Date() };
    this.products.set(productId, updated);
    return { ...updated };
  }

  async cancelPendingOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order || order.status !== 'pending') return;
    order.status = 'cancelled';
    order.updatedAt = new Date();
    if (order.productId) {
      const product = this.products.get(order.productId);
      if (product?.inventory !== null && product?.inventory !== undefined) product.inventory += order.quantity;
    }
  }
}
