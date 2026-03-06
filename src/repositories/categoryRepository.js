const db = require('../config/database');

const findAll = async () => {
  const { rows } = await db.query(`
    SELECT c.*, p.name AS parent_name
    FROM categories c
    LEFT JOIN categories p ON c.parent_id = p.id
    ORDER BY c.name
  `);
  return rows;
};

const findById = async (id) => {
  const { rows } = await db.query(
    `SELECT c.*, p.name AS parent_name
     FROM categories c
     LEFT JOIN categories p ON c.parent_id = p.id
     WHERE c.id = $1`,
    [id]
  );
  return rows[0] || null;
};

const findBySlug = async (slug) => {
  const { rows } = await db.query('SELECT * FROM categories WHERE slug = $1', [slug]);
  return rows[0] || null;
};

const findTree = async () => {
  const { rows } = await db.query(`
    WITH RECURSIVE category_tree AS (
      SELECT id, name, slug, description, parent_id, 0 AS depth
      FROM categories WHERE parent_id IS NULL
      UNION ALL
      SELECT c.id, c.name, c.slug, c.description, c.parent_id, ct.depth + 1
      FROM categories c
      JOIN category_tree ct ON c.parent_id = ct.id
    )
    SELECT * FROM category_tree ORDER BY depth, name
  `);
  return rows;
};

const create = async ({ name, slug, description, parent_id }) => {
  const { rows } = await db.query(
    `INSERT INTO categories (name, slug, description, parent_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, slug, description || null, parent_id || null]
  );
  return rows[0];
};

const update = async (id, fields) => {
  const sets = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(fields)) {
    sets.push(`${key} = $${idx++}`);
    values.push(val);
  }
  values.push(id);
  const { rows } = await db.query(
    `UPDATE categories SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0] || null;
};

const remove = async (id) => {
  const { rowCount } = await db.query('DELETE FROM categories WHERE id = $1', [id]);
  return rowCount > 0;
};

module.exports = { findAll, findById, findBySlug, findTree, create, update, remove };
