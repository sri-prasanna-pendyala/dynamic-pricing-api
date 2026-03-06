const categoryRepo = require('../repositories/categoryRepository');
const { AppError } = require('../utils/errors');

exports.getAll = async (req, res, next) => {
  try {
    const categories = await categoryRepo.findAll();
    res.json({ success: true, data: categories });
  } catch (err) { next(err); }
};

exports.getTree = async (req, res, next) => {
  try {
    const tree = await categoryRepo.findTree();
    res.json({ success: true, data: tree });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const category = await categoryRepo.findById(req.params.id);
    if (!category) throw new AppError('Category not found', 404);
    res.json({ success: true, data: category });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const existing = await categoryRepo.findBySlug(req.body.slug);
    if (existing) throw new AppError('Slug already in use', 409);
    const category = await categoryRepo.create(req.body);
    res.status(201).json({ success: true, data: category });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const category = await categoryRepo.update(req.params.id, req.body);
    if (!category) throw new AppError('Category not found', 404);
    res.json({ success: true, data: category });
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const deleted = await categoryRepo.remove(req.params.id);
    if (!deleted) throw new AppError('Category not found', 404);
    res.json({ success: true, message: 'Category deleted' });
  } catch (err) { next(err); }
};
