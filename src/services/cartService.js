const db = require('../config/database');
const cartRepo = require('../repositories/cartRepository');
const variantRepo = require('../repositories/variantRepository');
const productRepo = require('../repositories/productRepository');
const pricingRuleRepo = require('../repositories/pricingRuleRepository');
const inventoryService = require('./inventoryService');
const { calculatePrice } = require('./pricingEngine');
const { AppError } = require('../utils/errors');

const createCart = async ({ user_id, user_tier } = {}) => {
  return cartRepo.create({ user_id, user_tier });
};

const getCart = async (cartId) => {
  const cart = await cartRepo.findWithItems(cartId);
  if (!cart) throw new AppError('Cart not found', 404);
  return cart;
};

/**
 * Add or update a variant in the cart.
 * Snapshots the price at add-time and creates/updates inventory reservation.
 */
const addItem = async (cartId, { variant_id, quantity, promo_code }) => {
  const cart = await cartRepo.findById(cartId);
  if (!cart) throw new AppError('Cart not found', 404);
  if (cart.status !== 'active') throw new AppError('Cart is not active', 400);

  const variant = await variantRepo.findById(variant_id);
  if (!variant) throw new AppError('Variant not found', 404);
  if (!variant.is_active) throw new AppError('Variant is not available', 400);

  const product = await productRepo.findById(variant.product_id);
  if (!product || product.status !== 'active') {
    throw new AppError('Product is not available', 400);
  }

  // Fetch active pricing rules
  const rules = await pricingRuleRepo.findActiveRules(product.id);

  // Calculate price snapshot
  const pricing = calculatePrice({
    basePrice: product.base_price,
    priceAdjustment: variant.price_adjustment,
    quantity,
    userTier: cart.user_tier,
    promoCode: promo_code,
    rules,
  });

  // Reserve inventory (handles concurrency via SELECT FOR UPDATE)
  await inventoryService.reserveStock(variant_id, cartId, quantity);

  // Persist cart item with price snapshot
  const item = await db.withTransaction(async (client) => {
    return cartRepo.upsertItem(client, {
      cart_id: cartId,
      variant_id,
      quantity,
      unit_price: pricing.unitPrice,
      applied_discounts: pricing.appliedDiscounts,
    });
  });

  return { ...item, pricing };
};

/**
 * Update item quantity in cart. Re-calculates price and re-reserves stock.
 */
const updateItem = async (cartId, variantId, { quantity, promo_code }) => {
  const cart = await cartRepo.findById(cartId);
  if (!cart) throw new AppError('Cart not found', 404);
  if (cart.status !== 'active') throw new AppError('Cart is not active', 400);

  const existing = await cartRepo.findItem(cartId, variantId);
  if (!existing) throw new AppError('Item not in cart', 404);

  const variant = await variantRepo.findById(variantId);
  const product = await productRepo.findById(variant.product_id);
  const rules = await pricingRuleRepo.findActiveRules(product.id);

  const pricing = calculatePrice({
    basePrice: product.base_price,
    priceAdjustment: variant.price_adjustment,
    quantity,
    userTier: cart.user_tier,
    promoCode: promo_code,
    rules,
  });

  await inventoryService.reserveStock(variantId, cartId, quantity);

  const item = await db.withTransaction(async (client) => {
    return cartRepo.upsertItem(client, {
      cart_id: cartId,
      variant_id: variantId,
      quantity,
      unit_price: pricing.unitPrice,
      applied_discounts: pricing.appliedDiscounts,
    });
  });

  return { ...item, pricing };
};

/**
 * Remove an item from the cart and release its inventory reservation.
 */
const removeItem = async (cartId, variantId) => {
  const cart = await cartRepo.findById(cartId);
  if (!cart) throw new AppError('Cart not found', 404);

  const existing = await cartRepo.findItem(cartId, variantId);
  if (!existing) throw new AppError('Item not in cart', 404);

  await inventoryService.releaseReservation(variantId, cartId);
  await cartRepo.removeItem(cartId, variantId);

  return true;
};

/**
 * Checkout: atomically convert all reservations to permanent stock deductions.
 */
const checkout = async (cartId) => {
  const cart = await cartRepo.findWithItems(cartId);
  if (!cart) throw new AppError('Cart not found', 404);
  if (cart.status !== 'active') throw new AppError('Cart already checked out', 400);
  if (!cart.items || cart.items.length === 0) throw new AppError('Cart is empty', 400);

  return db.withTransaction(async (client) => {
    // Convert each reservation and deduct stock
    for (const item of cart.items) {
      await inventoryService.convertReservation(client, item.variant_id, cartId, item.quantity);
    }

    // Mark cart as checked out
    await cartRepo.updateStatus(client, cartId, 'checked_out');

    // Create order
    const totalAmount = cart.items.reduce(
      (sum, item) => sum + parseFloat(item.unit_price) * item.quantity, 0
    );

    const { rows: orders } = await client.query(`
      INSERT INTO orders (cart_id, user_id, total_amount)
      VALUES ($1, $2, $3) RETURNING *
    `, [cartId, cart.user_id, totalAmount.toFixed(2)]);

    const order = orders[0];

    // Insert order items
    for (const item of cart.items) {
      await client.query(`
        INSERT INTO order_items (order_id, variant_id, quantity, unit_price)
        VALUES ($1, $2, $3, $4)
      `, [order.id, item.variant_id, item.quantity, item.unit_price]);
    }

    return { order, items: cart.items };
  });
};

module.exports = { createCart, getCart, addItem, updateItem, removeItem, checkout };
