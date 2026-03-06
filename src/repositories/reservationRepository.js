const db = require('../config/database');

const RESERVATION_TTL_MINUTES = parseInt(process.env.RESERVATION_TTL_MINUTES) || 15;

const findActive = async (variantId, cartId) => {
  const { rows } = await db.query(`
    SELECT * FROM inventory_reservations
    WHERE variant_id = $1 AND cart_id = $2 AND status = 'active'
  `, [variantId, cartId]);
  return rows[0] || null;
};

const findExpired = async () => {
  const { rows } = await db.query(`
    SELECT * FROM inventory_reservations
    WHERE status = 'active' AND expires_at < NOW()
  `);
  return rows;
};

/**
 * Upsert a reservation within a transaction.
 * Returns the new/updated reservation.
 */
const upsert = async (client, { variant_id, cart_id, quantity }) => {
  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);
  const { rows } = await client.query(`
    INSERT INTO inventory_reservations (variant_id, cart_id, quantity, expires_at, status)
    VALUES ($1, $2, $3, $4, 'active')
    ON CONFLICT (variant_id, cart_id) DO UPDATE
      SET quantity = $3, expires_at = $4, status = 'active', updated_at = NOW()
    RETURNING *
  `, [variant_id, cart_id, quantity, expiresAt]);
  return rows[0];
};

const release = async (client, id, oldQuantity) => {
  await client.query(`
    UPDATE inventory_reservations SET status = 'released', updated_at = NOW()
    WHERE id = $1
  `, [id]);
  await client.query(`
    UPDATE variants
    SET reserved_quantity = GREATEST(0, reserved_quantity - $1), updated_at = NOW()
    WHERE id = (SELECT variant_id FROM inventory_reservations WHERE id = $2)
  `, [oldQuantity, id]);
};

/**
 * Release all expired active reservations in a single atomic operation.
 * Returns the number of reservations released.
 * This is idempotent: re-running on already-released reservations is safe.
 */
const releaseExpired = async (client) => {
  // Fetch expired reservations and lock them
  const { rows: expired } = await client.query(`
    SELECT id, variant_id, quantity
    FROM inventory_reservations
    WHERE status = 'active' AND expires_at < NOW()
    FOR UPDATE SKIP LOCKED
  `);

  if (expired.length === 0) return 0;

  const ids = expired.map(r => r.id);

  // Mark as released
  await client.query(`
    UPDATE inventory_reservations
    SET status = 'released', updated_at = NOW()
    WHERE id = ANY($1)
  `, [ids]);

  // Decrement reserved_quantity per variant
  for (const r of expired) {
    await client.query(`
      UPDATE variants
      SET reserved_quantity = GREATEST(0, reserved_quantity - $1), updated_at = NOW()
      WHERE id = $2
    `, [r.quantity, r.variant_id]);
  }

  return expired.length;
};

const convert = async (client, variantId, cartId) => {
  const { rows } = await client.query(`
    UPDATE inventory_reservations
    SET status = 'converted', updated_at = NOW()
    WHERE variant_id = $1 AND cart_id = $2 AND status = 'active'
    RETURNING *
  `, [variantId, cartId]);
  return rows[0] || null;
};

module.exports = { findActive, findExpired, upsert, release, releaseExpired, convert };
