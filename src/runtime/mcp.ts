import { z } from 'zod';
import { createLookupDigest, decryptPii } from './crypto';
import { fulfillmentSchema, orderStatuses, productSchema } from './schemas';
import type { AdminOrderRecord, CheckoutDatabase, FulfillmentPatch } from './types';

const latestProtocolVersion = '2025-06-18';
const supportedProtocolVersions = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

export type McpDependencies = {
  db: CheckoutDatabase;
  piiKey: string;
  lookupPepper: string;
  allowPii: boolean;
};

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
};

const listOrdersSchema = z.object({
  status: z.enum(orderStatuses).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
const findOrdersByEmailSchema = z.object({ email: z.email().max(254) });
const orderIdSchema = z.object({ orderId: z.string().trim().min(1).max(64) });
const listProductsSchema = z.object({ includeArchived: z.boolean().default(false) });
const updateProductSchema = z.object({ productId: z.string().trim().min(1).max(64) }).extend(productSchema.partial().shape);
const markShippedSchema = orderIdSchema.extend(fulfillmentSchema.shape);

const toolDefinitions = [
  {
    name: 'get_sales_summary',
    title: '売上サマリー',
    description: 'Total orders, orders placed today, pending and paid counts, and gross revenue from paid orders.',
    schema: z.object({}),
    readOnly: true,
  },
  {
    name: 'list_orders',
    title: '注文一覧',
    description: 'List orders newest first, optionally filtered by payment status. Buyer details are redacted unless the store enabled MCP_ALLOW_PII.',
    schema: listOrdersSchema,
    readOnly: true,
  },
  {
    name: 'find_orders_by_email',
    title: 'メールで注文検索',
    description: 'Find every order placed with an exact email address. The address is hashed before the lookup, so partial addresses do not match.',
    schema: findOrdersByEmailSchema,
    readOnly: true,
  },
  {
    name: 'get_order',
    title: '注文詳細',
    description: 'Read one order by its id, including payment status, amounts and fulfillment state.',
    schema: orderIdSchema,
    readOnly: true,
  },
  {
    name: 'list_products',
    title: '商品一覧',
    description: 'List products with price, shipping fee, publication status and inventory.',
    schema: listProductsSchema,
    readOnly: true,
  },
  {
    name: 'create_product',
    title: '商品を作成',
    description: 'Create a product. Use status "draft" to stage it and publish it later with update_product.',
    schema: productSchema,
    readOnly: false,
  },
  {
    name: 'update_product',
    title: '商品を更新',
    description: 'Change any field of an existing product: price, shipping fee, inventory, description, or status. Only the fields you pass are written.',
    schema: updateProductSchema,
    readOnly: false,
  },
  {
    name: 'mark_shipped',
    title: '発送を記録',
    description: 'Record or clear the shipping state of a paid order and optionally store a tracking number. Only paid orders can be marked shipped.',
    schema: markShippedSchema,
    readOnly: false,
  },
];

const toolRunners: Record<string, (args: unknown, deps: McpDependencies) => Promise<unknown>> = {
  get_sales_summary: (_args, deps) => deps.db.getOrderStats(),

  list_orders: async (args, deps) => {
    const input = listOrdersSchema.parse(args);
    const orders = await deps.db.listOrders({ limit: input.limit, status: input.status });
    return Promise.all(orders.map((order) => toMcpOrder(order, deps)));
  },

  find_orders_by_email: async (args, deps) => {
    const input = findOrdersByEmailSchema.parse(args);
    const emailLookup = await createLookupDigest(input.email, deps.lookupPepper);
    const orders = await deps.db.listOrders({ limit: 100, emailLookup });
    return Promise.all(orders.map((order) => toMcpOrder(order, deps)));
  },

  get_order: async (args, deps) => {
    const input = orderIdSchema.parse(args);
    const order = await deps.db.getOrder(input.orderId);
    if (!order) throw new Error(`No order with id ${input.orderId}`);
    return toMcpOrder(order, deps);
  },

  list_products: async (args, deps) => {
    const input = listProductsSchema.parse(args);
    return deps.db.listProducts({ includeArchived: input.includeArchived });
  },

  create_product: async (args, deps) => {
    const input = productSchema.parse(args);
    return deps.db.createProduct({ id: crypto.randomUUID(), ...input });
  },

  update_product: async (args, deps) => {
    const { productId, ...patch } = updateProductSchema.parse(args);
    if (Object.keys(patch).length === 0) throw new Error('Pass at least one field to change');
    const product = await deps.db.updateProduct(productId, patch);
    if (!product) throw new Error(`No product with id ${productId}`);
    return product;
  },

  mark_shipped: async (args, deps) => {
    const input = markShippedSchema.parse(args);
    if (input.shipped === undefined && input.trackingNumber === undefined) {
      throw new Error('Pass shipped or trackingNumber');
    }
    const order = await deps.db.getOrder(input.orderId);
    if (!order) throw new Error(`No order with id ${input.orderId}`);
    if (input.shipped === true && order.status !== 'paid') {
      throw new Error(`Order ${input.orderId} is ${order.status}; only paid orders can be marked shipped`);
    }
    const patch: FulfillmentPatch = {};
    if (input.shipped !== undefined) patch.shippedAt = input.shipped ? new Date() : null;
    if (input.trackingNumber !== undefined) patch.trackingNumber = input.trackingNumber || null;
    const updated = await deps.db.updateFulfillment(input.orderId, patch);
    return updated ? toMcpOrder(updated, deps) : null;
  },
};

export async function handleMcpMessage(message: unknown, deps: McpDependencies) {
  const request = (message || {}) as JsonRpcRequest;
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return failure(request.id ?? null, -32600, 'Invalid Request');
  }
  // Notifications carry no id and expect no reply.
  if (request.id === undefined || request.id === null) return null;
  const id = request.id;

  if (request.method === 'initialize') {
    const requested = (request.params as { protocolVersion?: string } | undefined)?.protocolVersion;
    return success(id, {
      protocolVersion: requested && supportedProtocolVersions.has(requested) ? requested : latestProtocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'nano-checkout', version: '0.1.0' },
      instructions: deps.allowPii
        ? 'Merchant tools for this store. Order tools return full buyer addresses; keep them out of anything you publish.'
        : 'Merchant tools for this store. Buyer names, emails and addresses come back redacted.',
    });
  }

  if (request.method === 'ping') return success(id, {});

  if (request.method === 'tools/list') {
    return success(id, {
      tools: toolDefinitions.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.schema, { io: 'input' }),
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: true },
      })),
    });
  }

  if (request.method === 'tools/call') {
    const params = (request.params || {}) as { name?: string; arguments?: unknown };
    const runner = params.name ? toolRunners[params.name] : undefined;
    if (!runner) return failure(id, -32602, `Unknown tool: ${params.name}`);
    try {
      const output = await runner(params.arguments ?? {}, deps);
      return success(id, { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] });
    } catch (error) {
      const text = error instanceof z.ZodError
        ? `Invalid arguments: ${JSON.stringify(z.flattenError(error).fieldErrors)}`
        : error instanceof Error ? error.message : 'Tool call failed';
      return success(id, { content: [{ type: 'text', text }], isError: true });
    }
  }

  return failure(id, -32601, `Unknown method: ${request.method}`);
}

function success(id: string | number, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

function failure(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

async function toMcpOrder(order: AdminOrderRecord, deps: McpDependencies) {
  const buyer = await decryptPii<Record<string, string>>(order.encryptedPii, deps.piiKey);
  const { encryptedPii: _, ...safeOrder } = order;
  if (deps.allowPii) return { ...safeOrder, buyer };
  return {
    ...safeOrder,
    buyer: {
      familyName: buyer.familyName,
      email: maskEmail(buyer.email || ''),
      prefecture: buyer.prefecture,
    },
    piiRedacted: true,
  };
}

function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  return domain ? `${local.slice(0, 1)}***@${domain}` : '***';
}
