const router = require('express').Router();
const ctrl = require('../controllers/categoryController');
const validate = require('../middleware/validate');
const Joi = require('joi');

const createSchema = Joi.object({
  name: Joi.string().max(255).required(),
  slug: Joi.string().max(255).required(),
  description: Joi.string().optional(),
  parent_id: Joi.string().uuid().optional().allow(null),
});

const updateSchema = Joi.object({
  name: Joi.string().max(255),
  slug: Joi.string().max(255),
  description: Joi.string().optional(),
  parent_id: Joi.string().uuid().optional().allow(null),
}).min(1);

router.get('/', ctrl.getAll);
router.get('/tree', ctrl.getTree);
router.get('/:id', ctrl.getOne);
router.post('/', validate(createSchema), ctrl.create);
router.patch('/:id', validate(updateSchema), ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
