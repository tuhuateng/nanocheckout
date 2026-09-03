ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS external_user_id text;

CREATE INDEX IF NOT EXISTS checkout_orders_external_user_idx ON checkout_orders (external_user_id);
