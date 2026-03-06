/**
 * Integration tests require a running PostgreSQL instance.
 * Set TEST_DB_* env vars or use docker-compose.
 *
 * Run: NODE_ENV=test jest tests/integration
 */
require('dotenv').config({ path: '.env.test' });

const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');

// Helper to reset test data between tests
async function truncateTables() {
  await db.query(`
    TRUNCATE TABLE order_items, orders, inventory_reservations,
      cart_items, carts, pricing_rules, variants, products, categories
    RESTART IDENTITY CASCADE
  `);
}

// Helper factories
async function createCategory() {
  const res = await request(app)
    .post('/api/v1/categories')
    .send({ name: 'Test Category', slug: `cat-${Date.now()}` });
  return res.body.data;
}

async function createProduct(categoryId) {
  const res = await request(app)
    .post('/api/v1/products')
    .send({ name: 'Test Product', base_price: 100, category_id: categoryId });
  return res.body.data;
}

async function createVariant(productId, stock = 10) {
  const res = await request(app)
    .post(`/api/v1/products/${productId}/variants`)
    .send({ sku: `SKU-${Date.now()}-${Math.random()}`, stock_quantity: stock, attributes: {} });
  return res.body.data;
}

async function createCart(userId = 'user1', tier = 'standard') {
  const res = await request(app)
    .get('/api/v1/cart')
    .set('x-user-id', userId)
    .set('x-user-tier', tier);
  return res.body.data;
}

describe('Product & Category API', () => {
  let category;

  beforeAll(async () => { await truncateTables(); });
  afterAll(async () => { await db.pool.end(); });

  it('creates a category', async () => {
    const res = await request(app)
      .post('/api/v1/categories')
      .send({ name: 'Electronics', slug: 'electronics-test' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Electronics');
    category = res.body.data;
  });

  it('creates a child category', async () => {
    const res = await request(app)
      .post('/api/v1/categories')
      .send({ name: 'Phones', slug: 'phones-test', parent_id: category.id });
    expect(res.status).toBe(201);
    expect(res.body.data.parent_id).toBe(category.id);
  });

  it('creates a product', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .send({ name: 'iPhone', base_price: 999.99, category_id: category.id });
    expect(res.status).toBe(201);
    expect(parseFloat(res.body.data.base_price)).toBe(999.99);
  });

  it('rejects product with invalid price', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .send({ name: 'Bad', base_price: -1 });
    expect(res.status).toBe(422);
  });
});

describe('Dynamic Pricing API', () => {
  let product, variant, seasonalRule;

  beforeAll(async () => {
    await truncateTables();
    const cat = await createCategory();
    product = await createProduct(cat.id);
    variant = await createVariant(product.id, 100);

    // Add a seasonal rule
    const ruleRes = await request(app)
      .post('/api/v1/pricing-rules')
      .send({
        name: 'Test Seasonal',
        rule_type: 'seasonal',
        discount_type: 'percentage',
        discount_value: 10,
        starts_at: new Date(Date.now() - 86400000).toISOString(),
        ends_at: new Date(Date.now() + 86400000).toISOString(),
        priority: 10,
        is_active: true,
      });
    seasonalRule = ruleRes.body.data;
  });

  it('returns price breakdown with seasonal discount', async () => {
    const res = await request(app)
      .get(`/api/v1/products/${product.id}/price`)
      .query({ quantity: 1 });
    expect(res.status).toBe(200);
    const calc = res.body.data.base_price_calculation;
    expect(calc.original_price).toBe(100);
    expect(calc.final_price).toBe(90);
    expect(calc.applied_discounts[0].rule_type).toBe('seasonal');
  });

  it('applies bulk discount for high quantity', async () => {
    await request(app)
      .post('/api/v1/pricing-rules')
      .send({
        name: 'Bulk 5+',
        rule_type: 'bulk',
        discount_type: 'percentage',
        discount_value: 5,
        min_quantity: 5,
        priority: 20,
        is_active: true,
      });

    const res = await request(app)
      .get(`/api/v1/products/${product.id}/price`)
      .query({ quantity: 5 });
    expect(res.status).toBe(200);
    // seasonal 10% on 100 = 90, then bulk 5% on 90 = 85.5
    const calc = res.body.data.base_price_calculation;
    expect(calc.final_price).toBeCloseTo(85.5, 1);
    expect(calc.applied_discounts).toHaveLength(2);
  });

  it('applies gold tier discount', async () => {
    await request(app)
      .post('/api/v1/pricing-rules')
      .send({
        name: 'Gold Tier',
        rule_type: 'user_tier',
        discount_value: 15,
        user_tier: 'gold',
        priority: 30,
        is_active: true,
      });

    const res = await request(app)
      .get(`/api/v1/products/${product.id}/price`)
      .query({ quantity: 1, user_tier: 'gold' });
    expect(res.status).toBe(200);
    const calc = res.body.data.base_price_calculation;
    // seasonal 10% on 100 = 90, gold 15% on 90 = 76.5
    expect(calc.final_price).toBeCloseTo(76.5, 1);
  });

  it('applies promo code discount', async () => {
    await request(app)
      .post('/api/v1/pricing-rules')
      .send({
        name: 'PROMO20',
        rule_type: 'promo_code',
        discount_type: 'percentage',
        discount_value: 20,
        promo_code: 'PROMO20',
        priority: 40,
        is_active: true,
      });

    const res = await request(app)
      .get(`/api/v1/products/${product.id}/price`)
      .query({ quantity: 1, promo_code: 'PROMO20' });
    expect(res.status).toBe(200);
    const calc = res.body.data.base_price_calculation;
    expect(calc.applied_discounts.some(d => d.rule_type === 'promo_code')).toBe(true);
  });
});

describe('Cart & Inventory Reservation', () => {
  let product, variant, cart;

  beforeAll(async () => {
    await truncateTables();
    const cat = await createCategory();
    product = await createProduct(cat.id);
    variant = await createVariant(product.id, 10);
    cart = await createCart('user-cart-test');
  });

  it('adds item to cart and creates reservation', async () => {
    const res = await request(app)
      .post(`/api/v1/cart/${cart.id}/items`)
      .send({ variant_id: variant.id, quantity: 3 });
    expect(res.status).toBe(201);
    expect(res.body.data.cart_item.quantity).toBe(3);
    expect(res.body.data.reservation_expires_in_minutes).toBe(15);
  });

  it('reduces available stock after reservation', async () => {
    const res = await request(app)
      .get(`/api/v1/products/${product.id}/variants/${variant.id}`);
    expect(res.status).toBe(200);
    expect(parseInt(res.body.data.reserved_quantity)).toBe(3);
    expect(parseInt(res.body.data.available_quantity)).toBe(7);
  });

  it('snapshots price at time of add', async () => {
    const cartRes = await request(app).get(`/api/v1/cart/${cart.id}`);
    const item = cartRes.body.data.items.find(i => i.variant_id === variant.id);
    expect(item.unit_price_snapshot).toBeDefined();
    expect(parseFloat(item.unit_price_snapshot)).toBe(100); // base price, no rules active
  });

  it('rejects adding more than available stock', async () => {
    const res = await request(app)
      .post(`/api/v1/cart/${cart.id}/items`)
      .send({ variant_id: variant.id, quantity: 20 });
    expect(res.status).toBe(422);
  });

  it('removes item and releases reservation', async () => {
    await request(app)
      .delete(`/api/v1/cart/${cart.id}/items/${variant.id}`);

    const res = await request(app)
      .get(`/api/v1/products/${product.id}/variants/${variant.id}`);
    expect(parseInt(res.body.data.reserved_quantity)).toBe(0);
    expect(parseInt(res.body.data.available_quantity)).toBe(10);
  });
});

describe('Checkout', () => {
  let product, variant, cart;

  beforeAll(async () => {
    await truncateTables();
    const cat = await createCategory();
    product = await createProduct(cat.id);
    variant = await createVariant(product.id, 20);
    cart = await createCart('checkout-user');
    // Add item to cart
    await request(app)
      .post(`/api/v1/cart/${cart.id}/items`)
      .send({ variant_id: variant.id, quantity: 5 });
  });

  it('successfully checks out and permanently deducts stock', async () => {
    const res = await request(app)
      .post(`/api/v1/cart/${cart.id}/checkout`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
    expect(res.body.data.total_amount).toBe(500); // 5 * 100

    // Verify stock permanently reduced
    const varRes = await request(app)
      .get(`/api/v1/products/${product.id}/variants/${variant.id}`);
    expect(parseInt(varRes.body.data.stock_quantity)).toBe(15);
    expect(parseInt(varRes.body.data.reserved_quantity)).toBe(0);
  });

  it('prevents double checkout', async () => {
    const res = await request(app)
      .post(`/api/v1/cart/${cart.id}/checkout`);
    expect(res.status).toBe(400);
  });
});

describe('Concurrency: Oversell Prevention', () => {
  let product, variant;

  beforeAll(async () => {
    await truncateTables();
    const cat = await createCategory();
    product = await createProduct(cat.id);
    variant = await createVariant(product.id, 5); // Only 5 in stock
  });

  it('prevents overselling under concurrent requests', async () => {
    // Spin up 10 concurrent users each trying to reserve 1 unit
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, async (_, i) => {
        const cart = await createCart(`concurrent-user-${i}`);
        return request(app)
          .post(`/api/v1/cart/${cart.id}/items`)
          .send({ variant_id: variant.id, quantity: 1 });
      })
    );

    const successes = results.filter(
      r => r.status === 'fulfilled' && r.value.status === 201
    );
    const failures  = results.filter(
      r => r.status === 'fulfilled' && r.value.status === 422
    );

    // Exactly 5 should succeed (stock = 5), rest should fail
    expect(successes.length).toBe(5);
    expect(failures.length).toBe(5);

    // Verify DB state
    const varRes = await request(app)
      .get(`/api/v1/products/${product.id}/variants/${variant.id}`);
    expect(parseInt(varRes.body.data.available_quantity)).toBe(0);
    expect(parseInt(varRes.body.data.reserved_quantity)).toBe(5);
  });
});

describe('Inventory Expiration', () => {
  it('releases expired reservations idempotently', async () => {
    const inventoryService = require('../../src/services/inventoryService');
    
    // Run cleanup multiple times — should not error
    const r1 = await inventoryService.releaseExpiredReservations();
    const r2 = await inventoryService.releaseExpiredReservations();
    
    expect(r1.errors).toBe(0);
    expect(r2.errors).toBe(0);
  });
});
