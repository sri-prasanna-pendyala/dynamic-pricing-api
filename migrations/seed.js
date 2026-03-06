require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'ecommerce_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Categories
    const catResult = await client.query(`
      INSERT INTO categories (name, slug, description) VALUES
        ('Electronics', 'electronics', 'Electronic devices and accessories'),
        ('Clothing', 'clothing', 'Apparel and fashion')
      RETURNING id, name
    `);

    const electronics = catResult.rows.find(r => r.name === 'Electronics');
    const clothing = catResult.rows.find(r => r.name === 'Clothing');

    // Sub-categories
    await client.query(`
      INSERT INTO categories (name, slug, description, parent_id) VALUES
        ('Smartphones', 'smartphones', 'Mobile phones', $1),
        ('Laptops', 'laptops', 'Portable computers', $1),
        ('T-Shirts', 't-shirts', 'Casual t-shirts', $2)
    `, [electronics.id, clothing.id]);

    // Products
    const prodResult = await client.query(`
      INSERT INTO products (name, description, base_price, status, category_id) VALUES
        ('Pro Smartphone X', 'Latest flagship smartphone', 999.99, 'active', $1),
        ('Classic Tee', 'Comfortable cotton t-shirt', 29.99, 'active', $2)
      RETURNING id, name
    `, [electronics.id, clothing.id]);

    const phone = prodResult.rows.find(r => r.name === 'Pro Smartphone X');
    const tee = prodResult.rows.find(r => r.name === 'Classic Tee');

    // Variants
    await client.query(`
      INSERT INTO variants (product_id, sku, attributes, price_adjustment, stock_quantity) VALUES
        ($1, 'PSX-128-BLK', '{"storage":"128GB","color":"Black"}', 0, 50),
        ($1, 'PSX-256-BLK', '{"storage":"256GB","color":"Black"}', 100, 30),
        ($1, 'PSX-256-WHT', '{"storage":"256GB","color":"White"}', 100, 20),
        ($2, 'CTEE-S-RED', '{"size":"S","color":"Red"}', 0, 100),
        ($2, 'CTEE-M-RED', '{"size":"M","color":"Red"}', 0, 150),
        ($2, 'CTEE-L-BLU', '{"size":"L","color":"Blue"}', 0, 75)
    `, [phone.id, tee.id]);

    // Pricing Rules
    const now = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await client.query(`
      INSERT INTO pricing_rules (name, rule_type, discount_value, discount_type, config, priority, valid_from, valid_until) VALUES
        ('Summer Sale', 'seasonal', 10, 'percentage', '{}', 30, $1, $2),
        ('Bulk Discount 10+', 'bulk', 10, 'percentage', '{"min_quantity": 10}', 20, null, null),
        ('Bulk Discount 20+', 'bulk', 15, 'percentage', '{"min_quantity": 20}', 20, null, null),
        ('Gold Tier Discount', 'user_tier', 15, 'percentage', '{"tier": "gold"}', 10, null, null),
        ('Silver Tier Discount', 'user_tier', 8, 'percentage', '{"tier": "silver"}', 10, null, null),
        ('Promo SAVE20', 'promo_code', 20, 'percentage', '{"code": "SAVE20"}', 25, null, null)
    `, [now.toISOString(), future.toISOString()]);

    await client.query('COMMIT');
    console.log('✓ Seed data inserted successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
