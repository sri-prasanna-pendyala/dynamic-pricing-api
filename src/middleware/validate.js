const Joi = require('joi');

const validate = (schema, source = 'body') => (req, res, next) => {
  const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: true });
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: error.details.map(d => d.message),
    });
  }
  req[source] = value;
  next();
};

module.exports = validate;
