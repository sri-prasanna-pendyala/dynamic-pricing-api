const pricingRuleRepo = require('../repositories/pricingRuleRepository');
const { AppError } = require('../utils/errors');

exports.getAll = async (req, res, next) => {
  try {
    const rules = await pricingRuleRepo.findAll();
    res.json({ success: true, data: rules });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const rule = await pricingRuleRepo.findById(req.params.id);
    if (!rule) throw new AppError('Pricing rule not found', 404);
    res.json({ success: true, data: rule });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const rule = await pricingRuleRepo.create(req.body);
    res.status(201).json({ success: true, data: rule });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const rule = await pricingRuleRepo.update(req.params.id, req.body);
    if (!rule) throw new AppError('Pricing rule not found', 404);
    res.json({ success: true, data: rule });
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const deleted = await pricingRuleRepo.remove(req.params.id);
    if (!deleted) throw new AppError('Pricing rule not found', 404);
    res.json({ success: true, message: 'Pricing rule deleted' });
  } catch (err) { next(err); }
};
