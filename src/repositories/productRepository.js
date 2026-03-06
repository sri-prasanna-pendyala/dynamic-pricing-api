const db = require('../config/database');

const findAll = async ({ status, category_id, page = 1, limit = 20 } = {}) => {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (status) { conditions.push(`p.status = $${idx++}`); values.push(status); }
  if (category_id) { conditions.push(`p.category_id = $${idx++}`); values.push(category_id); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;
  values.push(limit, offset);

  const { rows } = await db.query(`
    SELECT p.*, c.name AS category_name,
           COUNT(*) OVER() AS total_count
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    ${where}
    ORDER BY p.created_at DESC
    LIMIT $${idx++} OFFSET $${idx}
  `, values);

  return rows;
};

const findById = async (id) => {
  const { rows } = await db.query(`
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = $1
  `, [id]);
  return rows[0] || null;
};

const findWithVariants = async (id) => {
  const product = await findById(id);
  if (!product) return null;

  const { rows: variants } = await db.query(`
    SELECT *,
           (stock_quantity - reserved_quantity) AS available_quantity
    FROM variants
    WHERE product_id = $1 AND is_active = true
    ORDER BY sku
  `, [id]);

  return { ...product, variants };
};

const create = async ({ name, description, base_price, status, category_id }) => {
  const { rows } = await db.query(`
    INSERT INTO products (name, description, base_price, status, category_id)
    VALUES ($1, $2, $3, $4, $5) RETURNING *
  `, [name, description || null, base_price, status || 'active', category_id || null]);
  return rows[0];
};

const update = async (id, fields) => {
  const allowed = ['name', 'description', 'base_price', 'status', 'category_id'];
  const sets = [];
  const values = [];
  let idx = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      values.push(fields[key]);
    }
  }
  if (sets.length === 0) return findById(id);
  values.push(id);
  const { rows } = await db.query(
    `UPDATE products SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0] || null;
};

const remove = async (id) => {
  const { rowCount } = await db.query('DELETE FROM products WHERE id = $1', [id]);
  return rowCount > 0;
};

module.exports = { findAll, findById, findWithVariants, create, update, remove };
