import { z } from 'zod';

export const orderStatuses = ['pending', 'paid', 'payment_failed', 'cancelled'] as const;

export const productSchema = z.object({
  sku: z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().trim().min(1).max(160),
  edition: z.string().trim().max(120),
  description: z.string().trim().max(2_000),
  unitAmount: z.number().int().min(0).max(100_000_000),
  currency: z.literal('jpy'),
  shippingAmount: z.number().int().min(0).max(100_000_000),
  imageUrl: z.string().trim().min(1).max(2_000).refine((value) => value.startsWith('/') || /^https:\/\//.test(value), '画像URLが正しくありません。'),
  status: z.enum(['active', 'draft', 'archived']),
  inventory: z.number().int().min(0).max(10_000_000).nullable(),
});

export const fulfillmentSchema = z.object({
  shipped: z.boolean().optional(),
  trackingNumber: z.string().trim().max(120).nullable().optional(),
});
