const db = require('../config/database');

const findByProduct = async (productId) => {
  const { rows } = await db.query(`
    SELECT *, (stock_quantity - reserved_quantity) AS available_quantity
    FROM variants
    WHERE product_id = $1
    ORDER BY sku
  `, [productId]);
  return rows;
};

const findById = async (id) => {
  const { rows } = await db.query(`
    SELECT *, (stock_quantity - reserved_quantity) AS available_quantity
    FROM variants WHERE id = $1
  `, [id]);
  return rows[0] || null;
};

const findBySku = async (sku) => {
  const { rows } = await db.query(`
    SELECT *, (stock_quantity - reserved_quantity) AS available_quantity
    FROM variants WHERE sku = $1
  `, [sku]);
  return rows[0] || null;
};

// Lock row for update - used inside transactions for concurrency control
const findByIdForUpdate = async (client, id) => {
  const { rows } = await client.query(`
    SELECT *, (stock_quantity - reserved_quantity) AS available_quantity
    FROM variants WHERE id = $1
    FOR UPDATE
  `, [id]);
  return rows[0] || null;
};

const create = async ({ product_id, sku, attributes, price_adjustment, stock_quantity }) => {
  const { rows } = await db.query(`
    INSERT INTO variants (product_id, sku, attributes, price_adjustment, stock_quantity)
    VALUES ($1, $2, $3, $4, $5) RETURNING *,
    (stock_quantity - reserved_quantity) AS available_quantity
  `, [product_id, sku, JSON.stringify(attributes || {}), price_adjustment || 0, stock_quantity || 0]);
  return rows[0];
};

const update = async (id, fields) => {
  const allowed = ['sku', 'attributes', 'price_adjustment', 'stock_quantity', 'is_active'];
  const sets = [];
  const values = [];
  let idx = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      values.push(key === 'attributes' ? JSON.stringify(fields[key]) : fields[key]);
    }
  }
  if (sets.length === 0) return findById(id);
  values.push(id);
  const { rows } = await db.query(
    `UPDATE variants SET ${sets.join(', ')} WHERE id = $${idx}
     RETURNING *, (stock_quantity - reserved_quantity) AS available_quantity`,
    values
  );
  return rows[0] || null;
};

const remove = async (id) => {
  const { rowCount } = await db.query('DELETE FROM variants WHERE id = $1', [id]);
  return rowCount > 0;
};

module.exports = { findByProduct, findById, findBySku, findByIdForUpdate, create, update, remove };
