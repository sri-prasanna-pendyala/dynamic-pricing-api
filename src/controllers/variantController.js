const variantRepo = require('../repositories/variantRepository');
const productRepo = require('../repositories/productRepository');
const { AppError } = require('../utils/errors');

exports.getByProduct = async (req, res, next) => {
  try {
    const variants = await variantRepo.findByProduct(req.params.productId);
    res.json({ success: true, data: variants });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const variant = await variantRepo.findById(req.params.id);
    if (!variant) throw new AppError('Variant not found', 404);
    res.json({ success: true, data: variant });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const product = await productRepo.findById(req.params.productId);
    if (!product) throw new AppError('Product not found', 404);

    const existing = await variantRepo.findBySku(req.body.sku);
    if (existing) throw new AppError('SKU already exists', 409);

    const variant = await variantRepo.create({
      ...req.body,
      product_id: req.params.productId,
    });
    res.status(201).json({ success: true, data: variant });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const variant = await variantRepo.update(req.params.id, req.body);
    if (!variant) throw new AppError('Variant not found', 404);
    res.json({ success: true, data: variant });
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const deleted = await variantRepo.remove(req.params.id);
    if (!deleted) throw new AppError('Variant not found', 404);
    res.json({ success: true, message: 'Variant deleted' });
  } catch (err) { next(err); }
};
