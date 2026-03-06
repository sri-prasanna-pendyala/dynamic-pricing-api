const { calculatePrice } = require('../services/pricingEngine');

const makeRule = (overrides) => ({
  id: 'rule-1',
  name: 'Test Rule',
  rule_type: 'bulk',
  discount_value: 10,
  discount_type: 'percentage',
  config: {},
  priority: 0,
  ...overrides,
});

describe('Pricing Engine', () => {
  const baseParams = {
    basePrice: 100,
    priceAdjustment: 0,
    quantity: 1,
    rules: [],
  };

  test('returns base price when no rules', () => {
    const result = calculatePrice(baseParams);
    expect(result.unitPrice).toBe(100);
    expect(result.originalPrice).toBe(100);
    expect(result.totalPrice).toBe(100);
    expect(result.appliedDiscounts).toHaveLength(0);
  });

  test('applies price adjustment from variant', () => {
    const result = calculatePrice({ ...baseParams, priceAdjustment: 50 });
    expect(result.originalPrice).toBe(150);
    expect(result.unitPrice).toBe(150);
  });

  test('applies seasonal discount', () => {
    const rules = [makeRule({ rule_type: 'seasonal', discount_value: 10, config: {} })];
    const result = calculatePrice({ ...baseParams, rules });
    expect(result.unitPrice).toBe(90);
    expect(result.appliedDiscounts[0].rule_type).toBe('seasonal');
    expect(result.appliedDiscounts[0].discount_amount).toBe(10);
  });

  test('applies bulk discount when quantity meets threshold', () => {
    const rules = [makeRule({ rule_type: 'bulk', discount_value: 15, config: { min_quantity: 10 } })];
    const result = calculatePrice({ ...baseParams, quantity: 10, rules });
    expect(result.unitPrice).toBe(85);
  });

  test('does not apply bulk discount when quantity below threshold', () => {
    const rules = [makeRule({ rule_type: 'bulk', discount_value: 15, config: { min_quantity: 10 } })];
    const result = calculatePrice({ ...baseParams, quantity: 9, rules });
    expect(result.unitPrice).toBe(100);
  });

  test('applies highest applicable bulk tier', () => {
    const rules = [
      makeRule({ id: 'r1', rule_type: 'bulk', discount_value: 10, config: { min_quantity: 10 } }),
      makeRule({ id: 'r2', rule_type: 'bulk', discount_value: 20, config: { min_quantity: 20 } }),
    ];
    const result = calculatePrice({ ...baseParams, quantity: 25, rules });
    // Should apply 20% (higher threshold wins)
    expect(result.unitPrice).toBe(80);
    expect(result.appliedDiscounts).toHaveLength(1);
    expect(result.appliedDiscounts[0].discount_value).toBe(20);
  });

  test('applies user tier discount for matching tier', () => {
    const rules = [makeRule({ rule_type: 'user_tier', discount_value: 15, config: { tier: 'gold' } })];
    const result = calculatePrice({ ...baseParams, userTier: 'gold', rules });
    expect(result.unitPrice).toBe(85);
  });

  test('does not apply user tier discount for non-matching tier', () => {
    const rules = [makeRule({ rule_type: 'user_tier', discount_value: 15, config: { tier: 'gold' } })];
    const result = calculatePrice({ ...baseParams, userTier: 'silver', rules });
    expect(result.unitPrice).toBe(100);
  });

  test('applies promo code discount', () => {
    const rules = [makeRule({ rule_type: 'promo_code', discount_value: 20, config: { code: 'SAVE20' } })];
    const result = calculatePrice({ ...baseParams, promoCode: 'SAVE20', rules });
    expect(result.unitPrice).toBe(80);
  });

  test('promo code is case-insensitive', () => {
    const rules = [makeRule({ rule_type: 'promo_code', discount_value: 20, config: { code: 'SAVE20' } })];
    const result = calculatePrice({ ...baseParams, promoCode: 'save20', rules });
    expect(result.unitPrice).toBe(80);
  });

  test('applies multiple rule types in correct order', () => {
    // seasonal (10%) → bulk (15%) → user_tier (8%)
    const rules = [
      makeRule({ id: 'r1', rule_type: 'seasonal', discount_value: 10, config: {} }),
      makeRule({ id: 'r2', rule_type: 'bulk', discount_value: 15, config: { min_quantity: 5 } }),
      makeRule({ id: 'r3', rule_type: 'user_tier', discount_value: 8, config: { tier: 'gold' } }),
    ];
    const result = calculatePrice({ ...baseParams, quantity: 5, userTier: 'gold', rules });
    // 100 -10% = 90 -15% = 76.5 -8% = 70.38
    expect(result.unitPrice).toBe(70.38);
    expect(result.appliedDiscounts).toHaveLength(3);
    expect(result.appliedDiscounts[0].rule_type).toBe('seasonal');
    expect(result.appliedDiscounts[1].rule_type).toBe('bulk');
    expect(result.appliedDiscounts[2].rule_type).toBe('user_tier');
  });

  test('calculates correct total price', () => {
    const result = calculatePrice({ ...baseParams, basePrice: 50, quantity: 4, rules: [] });
    expect(result.totalPrice).toBe(200);
  });

  test('applies fixed discount', () => {
    const rules = [makeRule({ discount_value: 25, discount_type: 'fixed', rule_type: 'seasonal', config: {} })];
    const result = calculatePrice({ ...baseParams, rules });
    expect(result.unitPrice).toBe(75);
  });

  test('price does not go below zero', () => {
    const rules = [makeRule({ discount_value: 200, discount_type: 'fixed', rule_type: 'seasonal', config: {} })];
    const result = calculatePrice({ ...baseParams, rules });
    expect(result.unitPrice).toBe(0);
  });
});
