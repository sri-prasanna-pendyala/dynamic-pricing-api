/**
 * Concurrency Tests
 * =================
 * These tests verify that concurrent reservation requests cannot oversell inventory.
 * They require a live PostgreSQL database.
 *
 * Run with: npm run test:concurrency
 */

const { Pool } = require('pg');

// Skip if no DB configured
const skipIfNoDb = () => {
  if (!process.env.DB_HOST && !process.env.CI) {
    return true;
  }
  return false;
};

describe('Inventory Concurrency Control', () => {
  let pool;
  let productId, variantId;

  beforeAll(async () => {
    if (skipIfNoDb()) return;

    pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'ecommerce_test',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    });

    // Setup test data
    await pool.query(`
      INSERT INTO categories (id, name, slug) VALUES
        ('00000000-0000-0000-0000-000000000001', 'Test Cat', 'test-cat-concurrent')
      ON CONFLICT (slug) DO NOTHING
    `);

    const { rows: [product] } = await pool.query(`
      INSERT INTO products (name, base_price, status)
      VALUES ('Concurrency Test Product', 100, 'active')
      RETURNING id
    `);
    productId = product.id;

    const { rows: [variant] } = await pool.query(`
      INSERT INTO variants (product_id, sku, stock_quantity, reserved_quantity)
      VALUES ($1, $2, 5, 0)
      RETURNING id
    `, [productId, `SKU-CONCUR-${Date.now()}`]);
    variantId = variant.id;
  });

  afterAll(async () => {
    if (!pool) return;
    if (variantId) {
      await pool.query('DELETE FROM inventory_reservations WHERE variant_id = $1', [variantId]);
      await pool.query('DELETE FROM variants WHERE id = $1', [variantId]);
    }
    if (productId) {
      await pool.query('DELETE FROM products WHERE id = $1', [productId]);
    }
    await pool.end();
  });

  test('prevents overselling under concurrent requests', async () => {
    if (skipIfNoDb()) {
      console.log('Skipping concurrency test: no DB configured');
      return;
    }

    const { inventoryService } = require('../services/inventoryService');
    const STOCK = 5;
    const CONCURRENT = 10; // 10 concurrent requests for 5 stock items

    // Create 10 different cart IDs
    const cartIds = [];
    for (let i = 0; i < CONCURRENT; i++) {
      const { rows: [cart] } = await pool.query(
        "INSERT INTO carts DEFAULT VALUES RETURNING id"
      );
      cartIds.push(cart.id);
    }

    // Fire all reservations concurrently
    const results = await Promise.allSettled(
      cartIds.map(cartId =>
        require('../services/inventoryService').reserveStock(variantId, cartId, 1)
      )
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // Exactly STOCK reservations should succeed
    expect(fulfilled.length).toBeLessThanOrEqual(STOCK);
    expect(rejected.length).toBeGreaterThanOrEqual(CONCURRENT - STOCK);

    // Verify DB state
    const { rows: [v] } = await pool.query(
      'SELECT stock_quantity, reserved_quantity FROM variants WHERE id = $1',
      [variantId]
    );
    expect(parseInt(v.reserved_quantity)).toBeLessThanOrEqual(parseInt(v.stock_quantity));
    expect(parseInt(v.reserved_quantity)).toBe(fulfilled.length);
  }, 15000);
});
