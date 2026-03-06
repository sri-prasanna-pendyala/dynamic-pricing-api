require('dotenv').config();
const { pool } = require('../src/config/database');

const migrations = [
  // ============================================================
  // CATEGORIES (self-referencing for hierarchy)
  // ============================================================
  `CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    slug        VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    parent_id   INT REFERENCES categories(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)`,

  // ============================================================
  // PRODUCTS
  // ============================================================
  `CREATE TABLE IF NOT EXISTS products (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    base_price  NUMERIC(12,2) NOT NULL CHECK (base_price >= 0),
    status      VARCHAR(20)   NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','archived','draft')),
    category_id INT REFERENCES categories(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_status   ON products(status)`,

  // ============================================================
  // VARIANTS
  // ============================================================
  `CREATE TABLE IF NOT EXISTS variants (
    id               SERIAL PRIMARY KEY,
    product_id       INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku              VARCHAR(100) NOT NULL UNIQUE,
    attributes       JSONB NOT NULL DEFAULT '{}',
    price_adjustment NUMERIC(12,2) NOT NULL DEFAULT 0,
    stock_quantity   INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    reserved_quantity INT NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_variants_sku     ON variants(sku)`,

  // ============================================================
  // PRICING RULES
  // ============================================================
  `CREATE TABLE IF NOT EXISTS pricing_rules (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    rule_type    VARCHAR(50)  NOT NULL
                 CHECK (rule_type IN ('bulk','user_tier','seasonal','promo_code')),
    discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage'
                 CHECK (discount_type IN ('percentage','fixed')),
    discount_value NUMERIC(10,4) NOT NULL CHECK (discount_value >= 0),
    -- Bulk rule: min quantity threshold
    min_quantity INT,
    -- User-tier rule: which tier this applies to
    user_tier    VARCHAR(50),
    -- Seasonal/time-based rule
    starts_at    TIMESTAMPTZ,
    ends_at      TIMESTAMPTZ,
    -- Promo code rule
    promo_code   VARCHAR(100),
    -- Priority: lower number = applied first
    priority     INT NOT NULL DEFAULT 100,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    -- Which products/categories this rule applies to (NULL = all)
    product_id   INT REFERENCES products(id) ON DELETE CASCADE,
    category_id  INT REFERENCES categories(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_pricing_rules_type      ON pricing_rules(rule_type)`,
  `CREATE INDEX IF NOT EXISTS idx_pricing_rules_promo     ON pricing_rules(promo_code)`,
  `CREATE INDEX IF NOT EXISTS idx_pricing_rules_product   ON pricing_rules(product_id)`,

  // ============================================================
  // CARTS
  // ============================================================
  `CREATE TABLE IF NOT EXISTS carts (
    id         SERIAL PRIMARY KEY,
    user_id    VARCHAR(255) NOT NULL,
    user_tier  VARCHAR(50) NOT NULL DEFAULT 'standard',
    status     VARCHAR(20) NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','checked_out','abandoned')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_carts_user ON carts(user_id)`,

  // ============================================================
  // CART ITEMS  (with price snapshot)
  // ============================================================
  `CREATE TABLE IF NOT EXISTS cart_items (
    id                 SERIAL PRIMARY KEY,
    cart_id            INT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    variant_id         INT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
    quantity           INT NOT NULL CHECK (quantity > 0),
    unit_price_snapshot NUMERIC(12,2) NOT NULL,
    price_breakdown    JSONB NOT NULL DEFAULT '[]',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cart_id, variant_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cart_items_cart    ON cart_items(cart_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cart_items_variant ON cart_items(variant_id)`,

  // ============================================================
  // INVENTORY RESERVATIONS
  // ============================================================
  `CREATE TABLE IF NOT EXISTS inventory_reservations (
    id          SERIAL PRIMARY KEY,
    variant_id  INT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
    cart_id     INT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    quantity    INT NOT NULL CHECK (quantity > 0),
    expires_at  TIMESTAMPTZ NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','released','converted')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_reservations_variant  ON inventory_reservations(variant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_cart     ON inventory_reservations(cart_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_expires  ON inventory_reservations(expires_at) WHERE status = 'active'`,

  // ============================================================
  // ORDERS  (post-checkout record)
  // ============================================================
  `CREATE TABLE IF NOT EXISTS orders (
    id           SERIAL PRIMARY KEY,
    cart_id      INT NOT NULL REFERENCES carts(id),
    user_id      VARCHAR(255) NOT NULL,
    total_amount NUMERIC(12,2) NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'completed',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    variant_id  INT NOT NULL REFERENCES variants(id),
    quantity    INT NOT NULL,
    unit_price  NUMERIC(12,2) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ============================================================
  // updated_at trigger function
  // ============================================================
  `CREATE OR REPLACE FUNCTION update_updated_at_column()
   RETURNS TRIGGER AS $$
   BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
   $$ language 'plpgsql'`,

  ...[
    'categories','products','variants','pricing_rules',
    'carts','cart_items','inventory_reservations',
  ].map(
    (t) => `
    DROP TRIGGER IF EXISTS set_${t}_updated_at ON ${t};
    CREATE TRIGGER set_${t}_updated_at
    BEFORE UPDATE ON ${t}
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`
  ),
];

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('Running migrations…');
    for (const sql of migrations) {
      await client.query(sql);
    }
    console.log('✅ Migrations complete');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
