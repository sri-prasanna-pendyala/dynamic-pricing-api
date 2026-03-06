const db = require('../config/database');

/**
 * Fetch active pricing rules applicable to a product at a given time.
 * Rules apply if: product_id matches OR product_id is null (global rule).
 */
const findActiveRules = async (productId, atTime = new Date()) => {
  const { rows } = await db.query(`
    SELECT * FROM pricing_rules
    WHERE is_active = true
      AND (product_id = $1 OR product_id IS NULL)
      AND (valid_from IS NULL OR valid_from <= $2)
      AND (valid_until IS NULL OR valid_until >= $2)
    ORDER BY priority DESC, rule_type
  `, [productId, atTime]);
  return rows;
};

const findAll = async () => {
  const { rows } = await db.query('SELECT * FROM pricing_rules ORDER BY priority DESC');
  return rows;
};

const findById = async (id) => {
  const { rows } = await db.query('SELECT * FROM pricing_rules WHERE id = $1', [id]);
  return rows[0] || null;
};

const create = async (data) => {
  const {
    name, rule_type, discount_value, discount_type,
    config, product_id, priority, valid_from, valid_until
  } = data;
  const { rows } = await db.query(`
    INSERT INTO pricing_rules
      (name, rule_type, discount_value, discount_type, config, product_id, priority, valid_from, valid_until)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
  `, [
    name, rule_type, discount_value, discount_type || 'percentage',
    JSON.stringify(config || {}), product_id || null,
    priority || 0, valid_from || null, valid_until || null
  ]);
  return rows[0];
};

const update = async (id, fields) => {
  const allowed = [
    'name','rule_type','discount_value','discount_type',
    'config','product_id','priority','valid_from','valid_until','is_active'
  ];
  const sets = [];
  const values = [];
  let idx = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      values.push(key === 'config' ? JSON.stringify(fields[key]) : fields[key]);
    }
  }
  if (sets.length === 0) return findById(id);
  values.push(id);
  const { rows } = await db.query(
    `UPDATE pricing_rules SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0] || null;
};

const remove = async (id) => {
  const { rowCount } = await db.query('DELETE FROM pricing_rules WHERE id = $1', [id]);
  return rowCount > 0;
};

module.exports = { findActiveRules, findAll, findById, create, update, remove };
