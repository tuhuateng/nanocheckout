ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS shipped_at timestamptz;
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS tracking_number text;

CREATE INDEX IF NOT EXISTS checkout_orders_shipped_idx ON checkout_orders (shipped_at DESC);
