-- The report service's own database: a copy of the order facts it needs for sales
-- reports and invoices, kept up to date by `order.snapshot` events from the api.
-- Nothing here is shared with the api's database.
CREATE TABLE orders (
  id               uuid PRIMARY KEY,
  number           text NOT NULL UNIQUE,
  status           text NOT NULL,
  created_at       timestamptz NOT NULL,
  contact_name     text NOT NULL,
  contact_phone    text NOT NULL,
  region           text NOT NULL,
  delivery_service text NOT NULL,
  address_line     text NOT NULL,
  note             text,
  subtotal_cents   integer NOT NULL,
  delivery_fee_cents integer NOT NULL,
  discount_cents   integer NOT NULL,
  total_cents      integer NOT NULL,
  promo_code       text,
  payment_method   text,
  payment_status   text,
  -- When the api produced this version. A late or repeated event never overwrites a newer one.
  emitted_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_created_at_idx ON orders (created_at);

CREATE TABLE order_items (
  order_id          uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  position          integer NOT NULL,
  product_id        uuid NOT NULL,
  name              text NOT NULL,
  quantity          integer NOT NULL CHECK (quantity > 0),
  price_cents       integer NOT NULL,
  line_total_cents  integer NOT NULL,
  PRIMARY KEY (order_id, position)
);

CREATE INDEX order_items_product_idx ON order_items (product_id);
