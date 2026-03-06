const router = require('express').Router();
const ctrl = require('../controllers/productController');
const variantCtrl = require('../controllers/variantController');
const validate = require('../middleware/validate');
const Joi = require('joi');

const productSchema = Joi.object({
  name: Joi.string().max(255).required(),
  description: Joi.string().optional().allow(''),
  base_price: Joi.number().min(0).required(),
  status: Joi.string().valid('active', 'archived', 'draft').default('active'),
  category_id: Joi.string().uuid().optional().allow(null),
});

const variantSchema = Joi.object({
  sku: Joi.string().max(100).required(),
  attributes: Joi.object().default({}),
  price_adjustment: Joi.number().default(0),
  stock_quantity: Joi.number().integer().min(0).default(0),
  is_active: Joi.boolean().default(true),
});

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.get('/:id/price', ctrl.getPrice);
router.post('/', validate(productSchema), ctrl.create);
router.patch('/:id', validate(productSchema.fork(Object.keys(productSchema.describe().keys), k => k.optional())), ctrl.update);
router.delete('/:id', ctrl.remove);

// Nested variant routes
router.get('/:productId/variants', variantCtrl.getByProduct);
router.post('/:productId/variants', validate(variantSchema), variantCtrl.create);
router.get('/:productId/variants/:id', variantCtrl.getOne);
router.patch('/:productId/variants/:id', validate(variantSchema.fork(Object.keys(variantSchema.describe().keys), k => k.optional())), variantCtrl.update);
router.delete('/:productId/variants/:id', variantCtrl.remove);

module.exports = router;
