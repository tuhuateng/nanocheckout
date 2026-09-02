CREATE TABLE IF NOT EXISTS checkout_products (
  id text PRIMARY KEY,
  sku varchar(64) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  edition varchar(120) NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  unit_amount integer NOT NULL CHECK (unit_amount >= 0),
  currency varchar(3) NOT NULL DEFAULT 'jpy',
  shipping_amount integer NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
  image_url text NOT NULL DEFAULT '',
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('active', 'draft', 'archived')),
  inventory integer CHECK (inventory IS NULL OR inventory >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO checkout_products (
  id, sku, name, edition, description, unit_amount, currency,
  shipping_amount, image_url, status, inventory
) VALUES (
  'product-default-tray',
  'everyday-tray-01',
  'Everyday Carry Tray',
  'Sand / Edition 01',
  '玄関やデスクの小物を静かに整える、植物由来素材のミニトレイ。',
  4200,
  'jpy',
  0,
  '/product-tray.svg',
  'active',
  24
) ON CONFLICT (sku) DO NOTHING;

ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS product_id text REFERENCES checkout_products(id) ON DELETE SET NULL;
ALTER TABLE checkout_orders ADD COLUMN IF NOT EXISTS product_name text NOT NULL DEFAULT 'Product';

CREATE INDEX IF NOT EXISTS checkout_products_status_updated_idx ON checkout_products (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS checkout_orders_product_idx ON checkout_orders (product_id);
