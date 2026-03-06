const router = require('express').Router();
const ctrl = require('../controllers/cartController');
const validate = require('../middleware/validate');
const Joi = require('joi');

const createCartSchema = Joi.object({
  user_id: Joi.string().optional(),
  user_tier: Joi.string().valid('standard', 'silver', 'gold').default('standard'),
});

const addItemSchema = Joi.object({
  variant_id: Joi.string().uuid().required(),
  quantity: Joi.number().integer().min(1).required(),
  promo_code: Joi.string().optional(),
});

const updateItemSchema = Joi.object({
  quantity: Joi.number().integer().min(1).required(),
  promo_code: Joi.string().optional(),
});

router.post('/', validate(createCartSchema), ctrl.createCart);
router.get('/:cartId', ctrl.getCart);
router.post('/:cartId/items', validate(addItemSchema), ctrl.addItem);
router.patch('/:cartId/items/:variantId', validate(updateItemSchema), ctrl.updateItem);
router.delete('/:cartId/items/:variantId', ctrl.removeItem);
router.post('/:cartId/checkout', ctrl.checkout);

module.exports = router;
