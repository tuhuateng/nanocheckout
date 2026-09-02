import postgres, { type Sql } from 'postgres';
import { ProductUnavailableError, type AdminOrderRecord, type CheckoutDatabase, type OrderRecord, type OrderStats, type OrderStatus, type PendingOrderInput, type ProductInput, type ProductRecord } from './types';

export function createPostgresDatabase(connectionString: string): CheckoutDatabase {
  const sql = postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return new PostgresCheckoutDatabase(sql);
}

export class PostgresCheckoutDatabase implements CheckoutDatabase {
  constructor(private readonly sql: Sql) {}

  async createPendingOrder(input: PendingOrderInput): Promise<OrderRecord> {
    return this.sql.begin(async (transaction) => {
      const existing = await transaction<Array<{ id: string; status: OrderStatus; payment_session_id: string | null }>>`
        SELECT id, status, payment_session_id FROM checkout_orders WHERE idempotency_key = ${input.idempotencyKey} LIMIT 1
      `;
      if (existing[0]) return { id: existing[0].id, status: existing[0].status, paymentSessionId: existing[0].payment_session_id };

      if (input.productId) {
        const reserved = await transaction`
          UPDATE checkout_products
          SET inventory = CASE WHEN inventory IS NULL THEN NULL ELSE inventory - ${input.quantity} END,
              updated_at = now()
          WHERE id = ${input.productId}
            AND status = 'active'
            AND (inventory IS NULL OR inventory >= ${input.quantity})
          RETURNING id
        `;
        if (!reserved[0]) throw new ProductUnavailableError();
      }

      const rows = await transaction<Array<{ id: string; status: OrderStatus; payment_session_id: string | null }>>`
        INSERT INTO checkout_orders (
          id, idempotency_key, email_lookup, pii_ciphertext, quantity,
          unit_amount, shipping_amount, total_amount, currency, status, product_id, product_name
        ) VALUES (
          ${input.id}, ${input.idempotencyKey}, ${input.emailLookup}, ${input.encryptedPii}, ${input.quantity},
          ${input.unitAmount}, ${input.shippingAmount}, ${input.totalAmount}, ${input.currency}, 'pending',
          ${input.productId}, ${input.productName}
        )
        RETURNING id, status, payment_session_id
      `;
      return { id: rows[0].id, status: rows[0].status, paymentSessionId: rows[0].payment_session_id };
    });
  }

  async attachPaymentSession(orderId: string, paymentSessionId: string): Promise<void> {
    await this.sql`
      UPDATE checkout_orders
      SET payment_session_id = ${paymentSessionId}, updated_at = now()
      WHERE id = ${orderId}
    `;
  }

  async transitionPaymentSession(paymentSessionId: string, status: OrderStatus): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const changed = await transaction`
        UPDATE checkout_orders
        SET status = ${status}, updated_at = now()
        WHERE payment_session_id = ${paymentSessionId}
          AND status <> ${status}
        RETURNING product_id, quantity
      `;
      const order = changed[0];
      if (status === 'cancelled' && order?.product_id) {
        await transaction`
          UPDATE checkout_products
          SET inventory = CASE WHEN inventory IS NULL THEN NULL ELSE inventory + ${Number(order.quantity)} END,
              updated_at = now()
          WHERE id = ${String(order.product_id)}
        `;
      }
    });
  }

  async listOrders(options: { limit: number; status?: OrderStatus }): Promise<AdminOrderRecord[]> {
    const rows = options.status
      ? await this.sql`SELECT id, status, payment_session_id, pii_ciphertext, quantity, unit_amount, shipping_amount, total_amount, currency, product_id, product_name, created_at, updated_at FROM checkout_orders WHERE status = ${options.status} ORDER BY created_at DESC LIMIT ${options.limit}`
      : await this.sql`SELECT id, status, payment_session_id, pii_ciphertext, quantity, unit_amount, shipping_amount, total_amount, currency, product_id, product_name, created_at, updated_at FROM checkout_orders ORDER BY created_at DESC LIMIT ${options.limit}`;
    return rows.map(mapAdminOrder);
  }

  async getOrder(orderId: string): Promise<AdminOrderRecord | null> {
    const rows = await this.sql`SELECT id, status, payment_session_id, pii_ciphertext, quantity, unit_amount, shipping_amount, total_amount, currency, product_id, product_name, created_at, updated_at FROM checkout_orders WHERE id = ${orderId} LIMIT 1`;
    return rows[0] ? mapAdminOrder(rows[0]) : null;
  }

  async getOrderStats(): Promise<OrderStats> {
    const rows = await this.sql<Array<{ total_orders: number; today_orders: number; pending_orders: number; paid_orders: number; paid_gross: number }>>`
      SELECT
        count(*)::int AS total_orders,
        count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo')::int AS today_orders,
        count(*) FILTER (WHERE status = 'pending')::int AS pending_orders,
        count(*) FILTER (WHERE status = 'paid')::int AS paid_orders,
        coalesce(sum(total_amount) FILTER (WHERE status = 'paid'), 0)::int AS paid_gross
      FROM checkout_orders
    `;
    const row = rows[0];
    return {
      totalOrders: row.total_orders,
      todayOrders: row.today_orders,
      pendingOrders: row.pending_orders,
      paidOrders: row.paid_orders,
      paidGross: row.paid_gross,
    };
  }

  async listProducts(options: { includeArchived?: boolean } = {}): Promise<ProductRecord[]> {
    const rows = options.includeArchived
      ? await this.sql`SELECT * FROM checkout_products ORDER BY updated_at DESC`
      : await this.sql`SELECT * FROM checkout_products WHERE status <> 'archived' ORDER BY updated_at DESC`;
    return rows.map(mapProduct);
  }

  async getProductBySku(sku: string): Promise<ProductRecord | null> {
    const rows = await this.sql`SELECT * FROM checkout_products WHERE sku = ${sku} LIMIT 1`;
    return rows[0] ? mapProduct(rows[0]) : null;
  }

  async createProduct(input: ProductInput & { id: string }): Promise<ProductRecord> {
    const rows = await this.sql`
      INSERT INTO checkout_products (id, sku, name, edition, description, unit_amount, currency, shipping_amount, image_url, status, inventory)
      VALUES (${input.id}, ${input.sku}, ${input.name}, ${input.edition}, ${input.description}, ${input.unitAmount}, ${input.currency}, ${input.shippingAmount}, ${input.imageUrl}, ${input.status}, ${input.inventory})
      RETURNING *
    `;
    return mapProduct(rows[0]);
  }

  async updateProduct(productId: string, patch: Partial<ProductInput>): Promise<ProductRecord | null> {
    const values: Record<string, unknown> = { updated_at: new Date() };
    if (patch.sku !== undefined) values.sku = patch.sku;
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.edition !== undefined) values.edition = patch.edition;
    if (patch.description !== undefined) values.description = patch.description;
    if (patch.unitAmount !== undefined) values.unit_amount = patch.unitAmount;
    if (patch.currency !== undefined) values.currency = patch.currency;
    if (patch.shippingAmount !== undefined) values.shipping_amount = patch.shippingAmount;
    if (patch.imageUrl !== undefined) values.image_url = patch.imageUrl;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.inventory !== undefined) values.inventory = patch.inventory;
    const rows = await this.sql`UPDATE checkout_products SET ${this.sql(values)} WHERE id = ${productId} RETURNING *`;
    return rows[0] ? mapProduct(rows[0]) : null;
  }

  async cancelPendingOrder(orderId: string): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const rows = await transaction`
        UPDATE checkout_orders SET status = 'cancelled', updated_at = now()
        WHERE id = ${orderId} AND status = 'pending'
        RETURNING product_id, quantity
      `;
      const order = rows[0];
      if (order?.product_id) {
        await transaction`
          UPDATE checkout_products
          SET inventory = CASE WHEN inventory IS NULL THEN NULL ELSE inventory + ${Number(order.quantity)} END,
              updated_at = now()
          WHERE id = ${String(order.product_id)}
        `;
      }
    });
  }
}

function mapAdminOrder(row: Record<string, unknown>): AdminOrderRecord {
  return {
    id: String(row.id),
    status: row.status as OrderStatus,
    paymentSessionId: row.payment_session_id ? String(row.payment_session_id) : null,
    encryptedPii: String(row.pii_ciphertext),
    quantity: Number(row.quantity),
    unitAmount: Number(row.unit_amount),
    shippingAmount: Number(row.shipping_amount),
    totalAmount: Number(row.total_amount),
    currency: String(row.currency),
    productId: row.product_id ? String(row.product_id) : null,
    productName: row.product_name ? String(row.product_name) : 'Product',
    createdAt: row.created_at as string | Date,
    updatedAt: row.updated_at as string | Date,
  };
}

function mapProduct(row: Record<string, unknown>): ProductRecord {
  return {
    id: String(row.id),
    sku: String(row.sku),
    name: String(row.name),
    edition: String(row.edition),
    description: String(row.description),
    unitAmount: Number(row.unit_amount),
    currency: 'jpy',
    shippingAmount: Number(row.shipping_amount),
    imageUrl: String(row.image_url),
    status: row.status as ProductRecord['status'],
    inventory: row.inventory === null || row.inventory === undefined ? null : Number(row.inventory),
    createdAt: row.created_at as string | Date,
    updatedAt: row.updated_at as string | Date,
  };
}
