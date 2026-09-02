import { orderSpec } from '../config/order-spec';
import { createCheckoutApp } from '../runtime/checkout-app';
import { createPostgresDatabase } from '../runtime/postgres-database';
import { createStripeClient } from '../runtime/stripe';

export type PlatformEnvironment = {
  DATABASE_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  CHECKOUT_PII_KEY?: string;
  CHECKOUT_LOOKUP_PEPPER?: string;
  APP_URL?: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_SESSION_SECRET?: string;
};

export function createPlatformApp(environment: PlatformEnvironment, hyperdriveUrl?: string) {
  const connectionString = hyperdriveUrl || environment.DATABASE_URL;
  const missing = [
    !connectionString && 'DATABASE_URL or HYPERDRIVE',
    !environment.STRIPE_SECRET_KEY && 'STRIPE_SECRET_KEY',
    !environment.STRIPE_WEBHOOK_SECRET && 'STRIPE_WEBHOOK_SECRET',
    !environment.CHECKOUT_PII_KEY && 'CHECKOUT_PII_KEY',
    !environment.CHECKOUT_LOOKUP_PEPPER && 'CHECKOUT_LOOKUP_PEPPER',
    !environment.ADMIN_PASSWORD_HASH && 'ADMIN_PASSWORD_HASH',
    !environment.ADMIN_SESSION_SECRET && 'ADMIN_SESSION_SECRET',
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`Missing checkout configuration: ${missing.join(', ')}`);
  if (environment.ADMIN_SESSION_SECRET!.length < 32) throw new Error('ADMIN_SESSION_SECRET must contain at least 32 characters');
  if (!environment.ADMIN_PASSWORD_HASH!.startsWith('pbkdf2$')) throw new Error('ADMIN_PASSWORD_HASH must be generated with npm run admin:hash');

  return createCheckoutApp({
    db: createPostgresDatabase(connectionString!),
    stripe: createStripeClient(environment.STRIPE_SECRET_KEY!),
    orderSpec,
    secrets: {
      piiKey: environment.CHECKOUT_PII_KEY!,
      lookupPepper: environment.CHECKOUT_LOOKUP_PEPPER!,
      webhookSecret: environment.STRIPE_WEBHOOK_SECRET!,
      adminPasswordHash: environment.ADMIN_PASSWORD_HASH!,
      adminSessionSecret: environment.ADMIN_SESSION_SECRET!,
    },
    appUrl: environment.APP_URL,
  });
}
