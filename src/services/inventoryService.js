const db = require('../config/database');
const variantRepo = require('../repositories/variantRepository');
const reservationRepo = require('../repositories/reservationRepository');
const { AppError } = require('../utils/errors');

/**
 * Reserve inventory for a cart item.
 * Uses SELECT ... FOR UPDATE to prevent race conditions.
 * Idempotent: re-reserving the same (variant, cart) updates the quantity.
 */
const reserveStock = async (variantId, cartId, quantity) => {
  return db.withTransaction(async (client) => {
    // Lock the variant row to prevent concurrent oversell
    const variant = await variantRepo.findByIdForUpdate(client, variantId);
    if (!variant) throw new AppError('Variant not found', 404);
    if (!variant.is_active) throw new AppError('Variant is not available', 400);

    // Check existing reservation for this (variant, cart) pair
    const { rows: existing } = await client.query(`
      SELECT * FROM inventory_reservations
      WHERE variant_id = $1 AND cart_id = $2 AND status = 'active'
    `, [variantId, cartId]);

    const currentReserved = existing[0] ? existing[0].quantity : 0;
    const additionalNeeded = quantity - currentReserved;

    // available = stock - reserved (not counting our own existing reservation)
    const available = parseInt(variant.stock_quantity) - parseInt(variant.reserved_quantity) + currentReserved;

    if (quantity > available) {
      throw new AppError(
        `Insufficient stock. Requested: ${quantity}, Available: ${available}`,
        409
      );
    }

    // Upsert reservation
    const reservation = await reservationRepo.upsert(client, {
      variant_id: variantId,
      cart_id: cartId,
      quantity,
    });

    // Adjust reserved_quantity on the variant
    await client.query(`
      UPDATE variants
      SET reserved_quantity = reserved_quantity + $1, updated_at = NOW()
      WHERE id = $2
    `, [additionalNeeded, variantId]);

    return reservation;
  });
};

/**
 * Release a specific reservation (e.g., item removed from cart).
 */
const releaseReservation = async (variantId, cartId) => {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query(`
      UPDATE inventory_reservations
      SET status = 'released', updated_at = NOW()
      WHERE variant_id = $1 AND cart_id = $2 AND status = 'active'
      RETURNING *
    `, [variantId, cartId]);

    if (rows[0]) {
      await client.query(`
        UPDATE variants
        SET reserved_quantity = GREATEST(0, reserved_quantity - $1), updated_at = NOW()
        WHERE id = $2
      `, [rows[0].quantity, variantId]);
    }

    return rows[0] || null;
  });
};

/**
 * Convert a reservation into a permanent stock deduction (checkout).
 * Decrements stock_quantity AND reserved_quantity atomically.
 */
const convertReservation = async (client, variantId, cartId, quantity) => {
  // Lock variant
  const variant = await variantRepo.findByIdForUpdate(client, variantId);
  if (!variant) throw new AppError('Variant not found', 404);

  if (parseInt(variant.stock_quantity) < quantity) {
    throw new AppError(`Insufficient stock for checkout: ${variant.sku}`, 409);
  }

  // Mark reservation as converted
  await reservationRepo.convert(client, variantId, cartId);

  // Deduct both stock and reserved
  await client.query(`
    UPDATE variants
    SET stock_quantity   = stock_quantity - $1,
        reserved_quantity = GREATEST(0, reserved_quantity - $1),
        updated_at = NOW()
    WHERE id = $2
  `, [quantity, variantId]);
};

module.exports = { reserveStock, releaseReservation, convertReservation };
