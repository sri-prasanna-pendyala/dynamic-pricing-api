const db = require('../config/database');

const findById = async (id) => {
  const { rows } = await db.query('SELECT * FROM carts WHERE id = $1', [id]);
  return rows[0] || null;
};

const findWithItems = async (id) => {
  const { rows: carts } = await db.query('SELECT * FROM carts WHERE id = $1', [id]);
  if (!carts[0]) return null;

  const { rows: items } = await db.query(`
    SELECT ci.*,
           v.sku, v.attributes, v.product_id,
           p.name AS product_name,
           (v.stock_quantity - v.reserved_quantity) AS available_quantity
    FROM cart_items ci
    JOIN variants v ON ci.variant_id = v.id
    JOIN products p ON v.product_id = p.id
    WHERE ci.cart_id = $1
  `, [id]);

  return { ...carts[0], items };
};

const create = async ({ user_id, user_tier } = {}) => {
  const { rows } = await db.query(
    `INSERT INTO carts (user_id, user_tier) VALUES ($1, $2) RETURNING *`,
    [user_id || null, user_tier || 'standard']
  );
  return rows[0];
};

// --- Cart Items ---

const findItem = async (cartId, variantId) => {
  const { rows } = await db.query(
    'SELECT * FROM cart_items WHERE cart_id = $1 AND variant_id = $2',
    [cartId, variantId]
  );
  return rows[0] || null;
};

const upsertItem = async (client, { cart_id, variant_id, quantity, unit_price, applied_discounts }) => {
  const { rows } = await client.query(`
    INSERT INTO cart_items (cart_id, variant_id, quantity, unit_price, applied_discounts)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (cart_id, variant_id) DO UPDATE
      SET quantity = $3, unit_price = $4, applied_discounts = $5, updated_at = NOW()
    RETURNING *
  `, [cart_id, variant_id, quantity, unit_price, JSON.stringify(applied_discounts || [])]);
  return rows[0];
};

const removeItem = async (cartId, variantId) => {
  const { rowCount } = await db.query(
    'DELETE FROM cart_items WHERE cart_id = $1 AND variant_id = $2',
    [cartId, variantId]
  );
  return rowCount > 0;
};

const updateStatus = async (client, cartId, status) => {
  const { rows } = await client.query(
    'UPDATE carts SET status = $1 WHERE id = $2 RETURNING *',
    [status, cartId]
  );
  return rows[0];
};

module.exports = { findById, findWithItems, create, findItem, upsertItem, removeItem, updateStatus };
