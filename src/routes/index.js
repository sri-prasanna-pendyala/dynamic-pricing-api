const router = require('express').Router();

router.use('/categories', require('./categoryRoutes'));
router.use('/products', require('./productRoutes'));
router.use('/pricing-rules', require('./pricingRuleRoutes'));
router.use('/carts', require('./cartRoutes'));

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
