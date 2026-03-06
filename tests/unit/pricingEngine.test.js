const pricingEngine = require('../../src/services/pricingEngine');

describe('PricingEngine', () => {
  const makeRule = (overrides) => ({
    id: 1,
    name: 'Test Rule',
    rule_type: 'bulk',
    discount_type: 'percentage',
    discount_value: '10',
    min_quantity: 5,
    user_tier: null,
    starts_at: null,
    ends_at: null,
    promo_code: null,
    is_active: true,
    priority: 20,
    ...overrides,
  });

  describe('Bulk discount', () => {
    it('applies bulk discount when quantity meets threshold', () => {
      const rules = [makeRule({ rule_type: 'bulk', discount_value: '10', min_quantity: 5 })];
      const result = pricingEngine.calculate(100, rules, { quantity: 5 });
      expect(result.final_price).toBe(90);
      expect(result.applied_discounts).toHaveLength(1);
    });

    it('does not apply bulk discount below threshold', () => {
      const rules = [makeRule({ rule_type: 'bulk', discount_value: '10', min_quantity: 5 })];
      const result = pricingEngine.calculate(100, rules, { quantity: 4 });
      expect(result.final_price).toBe(100);
      expect(result.applied_discounts).toHaveLength(0);
    });

    it('applies highest qualifying bulk rule', () => {
      const rules = [
        makeRule({ id: 1, rule_type: 'bulk', discount_value: '5', min_quantity: 5, priority: 20 }),
        makeRule({ id: 2, rule_type: 'bulk', discount_value: '10', min_quantity: 10, priority: 20 }),
      ];
      const result = pricingEngine.calculate(100, rules, { quantity: 10 });
      // Both 5-unit and 10-unit rules apply, compounding
      expect(result.applied_discounts).toHaveLength(2);
      expect(result.final_price).toBeCloseTo(85.5, 2); // 100 * 0.95 * 0.90
    });
  });

  describe('User tier discount', () => {
    it('applies gold tier discount', () => {
      const rules = [makeRule({ rule_type: 'user_tier', discount_value: '15', user_tier: 'gold' })];
      const result = pricingEngine.calculate(100, rules, { quantity: 1, user_tier: 'gold' });
      expect(result.final_price).toBe(85);
    });

    it('does not apply gold discount to silver user', () => {
      const rules = [makeRule({ rule_type: 'user_tier', discount_value: '15', user_tier: 'gold' })];
      const result = pricingEngine.calculate(100, rules, { quantity: 1, user_tier: 'silver' });
      expect(result.final_price).toBe(100);
    });

    it('is case-insensitive for tier matching', () => {
      const rules = [makeRule({ rule_type: 'user_tier', discount_value: '10', user_tier: 'Gold' })];
      const result = pricingEngine.calculate(100, rules, { quantity: 1, user_tier: 'GOLD' });
      expect(result.final_price).toBe(90);
    });
  });

  describe('Seasonal discount', () => {
    it('applies seasonal discount within date range', () => {
      const now = new Date();
      const starts = new Date(now - 86400000); // yesterday
      const ends   = new Date(now + 86400000); // tomorrow
      const rules = [makeRule({
        rule_type: 'seasonal',
        discount_value: '12',
        starts_at: starts,
        ends_at: ends,
      })];
      const result = pricingEngine.calculate(100, rules, { quantity: 1 });
      expect(result.final_price).toBeCloseTo(88, 2);
    });

    it('does not apply expired seasonal discount', () => {
      const yesterday = new Date(Date.now() - 86400000 * 2);
      const dayBeforeYesterday = new Date(Date.now() - 86400000 * 3);
      const rules = [makeRule({
        rule_type: 'seasonal',
        discount_value: '12',
        starts_at: dayBeforeYesterday,
        ends_at: yesterday,
      })];
      const result = pricingEngine.calculate(100, rules, { quantity: 1 });
      expect(result.final_price).toBe(100);
    });
  });

  describe('Promo code discount', () => {
    it('applies percentage promo code', () => {
      const rules = [makeRule({
        rule_type: 'promo_code',
        discount_type: 'percentage',
        discount_value: '20',
        promo_code: 'SAVE20',
      })];
      const result = pricingEngine.calculate(100, rules, { quantity: 1, promo_code: 'SAVE20' });
      expect(result.final_price).toBe(80);
    });

    it('applies fixed promo code', () => {
      const rules = [makeRule({
        rule_type: 'promo_code',
        discount_type: 'fixed',
        discount_value: '50',
        promo_code: 'FLAT50',
      })];
      const result = pricingEngine.calculate(200, rules, { quantity: 1, promo_code: 'FLAT50' });
      expect(result.final_price).toBe(150);
    });

    it('caps fixed discount at current price', () => {
      const rules = [makeRule({
        rule_type: 'promo_code',
        discount_type: 'fixed',
        discount_value: '999',
        promo_code: 'BIGSALE',
      })];
      const result = pricingEngine.calculate(50, rules, { quantity: 1, promo_code: 'BIGSALE' });
      expect(result.final_price).toBe(0);
    });

    it('does not apply with wrong promo code', () => {
      const rules = [makeRule({
        rule_type: 'promo_code',
        discount_value: '20',
        promo_code: 'SAVE20',
      })];
      const result = pricingEngine.calculate(100, rules, { quantity: 1, promo_code: 'WRONG' });
      expect(result.final_price).toBe(100);
    });
  });

  describe('Rule priority & compounding', () => {
    it('applies rules in priority order and compounds discounts', () => {
      const now = new Date();
      const rules = [
        makeRule({ id: 1, rule_type: 'seasonal', discount_value: '12', priority: 10,
          starts_at: new Date(now - 1000), ends_at: new Date(now + 86400000) }),
        makeRule({ id: 2, rule_type: 'bulk', discount_value: '10', min_quantity: 10, priority: 20 }),
        makeRule({ id: 3, rule_type: 'user_tier', discount_value: '15', user_tier: 'gold', priority: 30 }),
      ];
      const result = pricingEngine.calculate(1000, rules, { quantity: 10, user_tier: 'gold' });

      // Step 1: seasonal 12% off 1000 = 880
      // Step 2: bulk 10% off 880 = 792
      // Step 3: gold 15% off 792 = 673.20
      expect(result.final_price).toBeCloseTo(673.20, 1);
      expect(result.applied_discounts).toHaveLength(3);
    });
  });

  describe('Price totals', () => {
    it('returns correct total for quantity', () => {
      const rules = [];
      const result = pricingEngine.calculate(99.99, rules, { quantity: 3 });
      expect(result.final_price_total).toBeCloseTo(299.97, 2);
    });
  });
});
