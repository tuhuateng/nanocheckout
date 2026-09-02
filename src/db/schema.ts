import { check, index, integer, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const checkoutProducts = pgTable('checkout_products', {
  id: text('id').primaryKey(),
  sku: varchar('sku', { length: 64 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  edition: varchar('edition', { length: 120 }).notNull().default(''),
  description: text('description').notNull().default(''),
  unitAmount: integer('unit_amount').notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('jpy'),
  shippingAmount: integer('shipping_amount').notNull().default(0),
  imageUrl: text('image_url').notNull().default(''),
  status: varchar('status', { length: 16 }).notNull().default('draft'),
  inventory: integer('inventory'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('checkout_products_sku_unique').on(table.sku),
  index('checkout_products_status_updated_idx').on(table.status, table.updatedAt),
  check('checkout_products_amount_check', sql`${table.unitAmount} >= 0 AND ${table.shippingAmount} >= 0`),
  check('checkout_products_inventory_check', sql`${table.inventory} IS NULL OR ${table.inventory} >= 0`),
]);

export const checkoutOrders = pgTable('checkout_orders', {
  id: text('id').primaryKey(),
  idempotencyKey: text('idempotency_key').notNull(),
  emailLookup: text('email_lookup').notNull(),
  piiCiphertext: text('pii_ciphertext').notNull(),
  quantity: integer('quantity').notNull(),
  unitAmount: integer('unit_amount').notNull(),
  shippingAmount: integer('shipping_amount').notNull(),
  totalAmount: integer('total_amount').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  productId: text('product_id').references(() => checkoutProducts.id, { onDelete: 'set null' }),
  productName: text('product_name').notNull().default('Product'),
  status: varchar('status', { length: 24 }).notNull().default('pending'),
  paymentSessionId: text('payment_session_id'),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  trackingNumber: text('tracking_number'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('checkout_orders_idempotency_key_unique').on(table.idempotencyKey),
  uniqueIndex('checkout_orders_payment_session_unique').on(table.paymentSessionId),
  index('checkout_orders_email_lookup_idx').on(table.emailLookup),
  index('checkout_orders_status_created_idx').on(table.status, table.createdAt),
  index('checkout_orders_product_idx').on(table.productId),
  index('checkout_orders_shipped_idx').on(table.shippedAt),
  check('checkout_orders_quantity_check', sql`${table.quantity} BETWEEN 1 AND 5`),
]);
