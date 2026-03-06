const cartService = require('../services/cartService');

exports.createCart = async (req, res, next) => {
  try {
    const cart = await cartService.createCart(req.body);
    res.status(201).json({ success: true, data: cart });
  } catch (err) { next(err); }
};

exports.getCart = async (req, res, next) => {
  try {
    const cart = await cartService.getCart(req.params.cartId);
    res.json({ success: true, data: cart });
  } catch (err) { next(err); }
};

exports.addItem = async (req, res, next) => {
  try {
    const item = await cartService.addItem(req.params.cartId, req.body);
    res.status(201).json({ success: true, data: item });
  } catch (err) { next(err); }
};

exports.updateItem = async (req, res, next) => {
  try {
    const item = await cartService.updateItem(
      req.params.cartId, req.params.variantId, req.body
    );
    res.json({ success: true, data: item });
  } catch (err) { next(err); }
};

exports.removeItem = async (req, res, next) => {
  try {
    await cartService.removeItem(req.params.cartId, req.params.variantId);
    res.json({ success: true, message: 'Item removed from cart' });
  } catch (err) { next(err); }
};

exports.checkout = async (req, res, next) => {
  try {
    const result = await cartService.checkout(req.params.cartId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};
