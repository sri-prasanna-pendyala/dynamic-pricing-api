const router = require('express').Router();
const ctrl = require('../controllers/pricingRuleController');
const validate = require('../middleware/validate');
const Joi = require('joi');

const schema = Joi.object({
  name: Joi.string().required(),
  rule_type: Joi.string().valid('bulk', 'user_tier', 'seasonal', 'promo_code').required(),
  discount_value: Joi.number().positive().required(),
  discount_type: Joi.string().valid('percentage', 'fixed').default('percentage'),
  config: Joi.object().default({}),
  product_id: Joi.string().uuid().optional().allow(null),
  priority: Joi.number().integer().default(0),
  valid_from: Joi.date().iso().optional().allow(null),
  valid_until: Joi.date().iso().optional().allow(null),
  is_active: Joi.boolean().default(true),
});

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/', validate(schema), ctrl.create);
router.patch('/:id', validate(schema.fork(Object.keys(schema.describe().keys), k => k.optional())), ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
