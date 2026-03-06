const productRepo = require('../repositories/productRepository');
const variantRepo = require('../repositories/variantRepository');
const pricingRuleRepo = require('../repositories/pricingRuleRepository');
const { calculatePrice } = require('../services/pricingEngine');
const { AppError } = require('../utils/errors');

exports.getAll = async (req, res, next) => {
  try {
    const { status, category_id, page, limit } = req.query;
    const products = await productRepo.findAll({ status, category_id, page, limit });
    const total = products[0] ? parseInt(products[0].total_count) : 0;
    res.json({
      success: true,
      data: products.map(({ total_count, ...p }) => p),
      pagination: { total, page: parseInt(page) || 1, limit: parseInt(limit) || 20 },
    });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const product = await productRepo.findWithVariants(req.params.id);
    if (!product) throw new AppError('Product not found', 404);
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const product = await productRepo.create(req.body);
    res.status(201).json({ success: true, data: product });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const product = await productRepo.update(req.params.id, req.body);
    if (!product) throw new AppError('Product not found', 404);
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const deleted = await productRepo.remove(req.params.id);
    if (!deleted) throw new AppError('Product not found', 404);
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) { next(err); }
};

/**
 * GET /products/:id/price
 * Query params: quantity, user_tier, promo_code
 */
exports.getPrice = async (req, res, next) => {
  try {
    const product = await productRepo.findById(req.params.id);
    if (!product) throw new AppError('Product not found', 404);

    const { quantity = 1, user_tier, promo_code, variant_id } = req.query;
    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 1) throw new AppError('Invalid quantity', 400);

    let priceAdjustment = 0;
    let variantSku = null;

    if (variant_id) {
      const variant = await variantRepo.findById(variant_id);
      if (!variant || variant.product_id !== product.id) {
        throw new AppError('Variant not found for this product', 404);
      }
      priceAdjustment = parseFloat(variant.price_adjustment);
      variantSku = variant.sku;
    }

    const rules = await pricingRuleRepo.findActiveRules(product.id);
    const pricing = calculatePrice({
      basePrice: product.base_price,
      priceAdjustment,
      quantity: qty,
      userTier: user_tier,
      promoCode: promo_code,
      rules,
    });

    res.json({
      success: true,
      data: {
        product_id: product.id,
        product_name: product.name,
        variant_id: variant_id || null,
        variant_sku: variantSku,
        quantity: qty,
        user_tier: user_tier || null,
        promo_code: promo_code || null,
        ...pricing,
      },
    });
  } catch (err) { next(err); }
};
