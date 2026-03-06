-- ============================================================
-- E-Commerce Inventory & Dynamic Pricing - Initial Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- CATEGORIES (hierarchical via self-referencing FK)
-- ============================================================
CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  parent_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_categories_parent_id ON categories(parent_id);
CREATE INDEX idx_categories_slug ON categories(slug);

-- ============================================================
-- PRODUCTS
-- ============================================================
CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  base_price  NUMERIC(12,2) NOT NULL CHECK (base_price >= 0),
  status      VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived', 'draft')),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_category_id ON products(category_id);

-- ============================================================
-- VARIANTS (per-product SKUs with optional price adjustments)
-- ============================================================
CREATE TABLE variants (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku              VARCHAR(100) NOT NULL UNIQUE,
  attributes       JSONB NOT NULL DEFAULT '{}',   -- e.g. {"size":"L","color":"Red"}
  price_adjustment NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_quantity   INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Invariant: reserved <= stock
  CONSTRAINT chk_reserved_lte_stock CHECK (reserved_quantity <= stock_quantity)
);

CREATE INDEX idx_variants_product_id ON variants(product_id);
CREATE INDEX idx_variants_sku ON variants(sku);
CREATE INDEX idx_variants_attributes ON variants USING GIN(attributes);

-- ============================================================
-- PRICING RULES
-- ============================================================
CREATE TABLE pricing_rules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(255) NOT NULL,
  rule_type       VARCHAR(30) NOT NULL
                    CHECK (rule_type IN ('bulk', 'user_tier', 'seasonal', 'promo_code')),
  -- discount_value: percentage (0-100) or fixed amount depending on discount_type
  discount_value  NUMERIC(10,4) NOT NULL CHECK (discount_value > 0),
  discount_type   VARCHAR(10) NOT NULL DEFAULT 'percentage'
                    CHECK (discount_type IN ('percentage', 'fixed')),
  -- Rule-specific config stored as JSONB for flexibility
  -- bulk:      {"min_quantity": 10}
  -- user_tier: {"tier": "gold"}
  -- seasonal:  {} (relies on valid_from/valid_until)
  -- promo_code:{"code": "SAVE20"}
  config          JSONB NOT NULL DEFAULT '{}',
  -- Scope: null means applies to all products
  product_id      UUID REFERENCES products(id) ON DELETE CASCADE,
  priority        INTEGER NOT NULL DEFAULT 0,  -- higher = applied first
  valid_from      TIMESTAMPTZ,
  valid_until     TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pricing_rules_type ON pricing_rules(rule_type);
CREATE INDEX idx_pricing_rules_product_id ON pricing_rules(product_id);
CREATE INDEX idx_pricing_rules_active ON pricing_rules(is_active);

-- ============================================================
-- CARTS
-- ============================================================
CREATE TABLE carts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    VARCHAR(255),          -- nullable for guest carts
  user_tier  VARCHAR(50) DEFAULT 'standard',
  status     VARCHAR(20) NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'checked_out', 'abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_carts_user_id ON carts(user_id);
CREATE INDEX idx_carts_status ON carts(status);

-- ============================================================
-- CART ITEMS (with price snapshot)
-- ============================================================
CREATE TABLE cart_items (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cart_id            UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id         UUID NOT NULL REFERENCES variants(id),
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  -- Price snapshot: locked at add-to-cart time, immune to later price changes
  unit_price         NUMERIC(12,2) NOT NULL,
  applied_discounts  JSONB NOT NULL DEFAULT '[]',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cart_id, variant_id)
);

CREATE INDEX idx_cart_items_cart_id ON cart_items(cart_id);
CREATE INDEX idx_cart_items_variant_id ON cart_items(variant_id);

-- ============================================================
-- INVENTORY RESERVATIONS (tracks active holds with TTL)
-- ============================================================
CREATE TABLE inventory_reservations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id  UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  cart_id     UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  expires_at  TIMESTAMPTZ NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'released', 'converted')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(variant_id, cart_id)
);

CREATE INDEX idx_reservations_variant_id ON inventory_reservations(variant_id);
CREATE INDEX idx_reservations_cart_id ON inventory_reservations(cart_id);
CREATE INDEX idx_reservations_expires_at ON inventory_reservations(expires_at)
  WHERE status = 'active';
CREATE INDEX idx_reservations_status ON inventory_reservations(status);

-- ============================================================
-- ORDERS (created at checkout)
-- ============================================================
CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cart_id         UUID NOT NULL REFERENCES carts(id),
  user_id         VARCHAR(255),
  status          VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('confirmed', 'shipped', 'delivered', 'cancelled')),
  total_amount    NUMERIC(12,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_cart_id ON orders(cart_id);
CREATE INDEX idx_orders_user_id ON orders(user_id);

CREATE TABLE order_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id  UUID NOT NULL REFERENCES variants(id),
  quantity    INTEGER NOT NULL,
  unit_price  NUMERIC(12,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);

-- ============================================================
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories','products','variants','pricing_rules',
    'carts','cart_items','inventory_reservations','orders'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
       BEFORE UPDATE ON %s
       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      t, t
    );
  END LOOP;
END;
$$;
