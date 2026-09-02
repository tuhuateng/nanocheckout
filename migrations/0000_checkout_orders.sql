CREATE TABLE IF NOT EXISTS checkout_orders (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  email_lookup text NOT NULL,
  pii_ciphertext text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 5),
  unit_amount integer NOT NULL CHECK (unit_amount >= 0),
  shipping_amount integer NOT NULL CHECK (shipping_amount >= 0),
  total_amount integer NOT NULL CHECK (total_amount >= 0),
  currency varchar(3) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  payment_session_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkout_orders_email_lookup_idx ON checkout_orders (email_lookup);
CREATE INDEX IF NOT EXISTS checkout_orders_status_created_idx ON checkout_orders (status, created_at DESC);
