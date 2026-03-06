/**
 * Pricing Engine
 * =============
 * Applies pricing rules in a deterministic order:
 *   1. Seasonal  (highest priority - time-limited promotions)
 *   2. Promo Code (user-supplied code)
 *   3. Bulk       (quantity-based discount)
 *   4. User Tier  (loyalty discount)
 *
 * Rules are applied sequentially on the running price.
 * Each rule records the discount it applied for transparency.
 *
 * Only rules with higher priority numbers are evaluated first
 * (as set in the DB). Within the same rule_type the first
 * matching rule wins (e.g. bulk 20+ beats bulk 10+).
 */

const RULE_TYPE_ORDER = ['seasonal', 'promo_code', 'bulk', 'user_tier'];

/**
 * Calculate the final price for a variant.
 *
 * @param {Object} params
 * @param {number} params.basePrice       - Product base_price
 * @param {number} params.priceAdjustment - Variant price_adjustment
 * @param {number} params.quantity        - Units being purchased
 * @param {string} [params.userTier]      - e.g. 'gold', 'silver', 'standard'
 * @param {string} [params.promoCode]     - Optional promo code string
 * @param {Array}  params.rules           - Active PricingRule rows from DB
 *
 * @returns {{ unitPrice, totalPrice, appliedDiscounts, originalPrice }}
 */
function calculatePrice({ basePrice, priceAdjustment, quantity, userTier, promoCode, rules }) {
  const originalUnitPrice = parseFloat(basePrice) + parseFloat(priceAdjustment || 0);
  let currentPrice = originalUnitPrice;
  const appliedDiscounts = [];

  // Group rules by type for ordered processing
  const rulesByType = {};
  for (const rule of rules) {
    if (!rulesByType[rule.rule_type]) rulesByType[rule.rule_type] = [];
    rulesByType[rule.rule_type].push(rule);
  }

  // Sort each type's rules by priority DESC (best deal first for bulk)
  for (const type of Object.keys(rulesByType)) {
    rulesByType[type].sort((a, b) => {
      // For bulk: higher min_quantity = better deal, check highest threshold first
      if (type === 'bulk') {
        const aMq = a.config?.min_quantity || 0;
        const bMq = b.config?.min_quantity || 0;
        return bMq - aMq;
      }
      return b.priority - a.priority;
    });
  }

  // Apply rules in defined order
  for (const ruleType of RULE_TYPE_ORDER) {
    const typeRules = rulesByType[ruleType] || [];
    for (const rule of typeRules) {
      const discount = evaluateRule(rule, { quantity, userTier, promoCode, currentPrice });
      if (discount !== null) {
        const discountAmount = discount;
        currentPrice = Math.max(0, currentPrice - discountAmount);
        appliedDiscounts.push({
          rule_id: rule.id,
          rule_name: rule.name,
          rule_type: rule.rule_type,
          discount_value: rule.discount_value,
          discount_type: rule.discount_type,
          discount_amount: parseFloat(discountAmount.toFixed(2)),
          price_after: parseFloat(currentPrice.toFixed(2)),
        });
        break; // Only one rule per type applies
      }
    }
  }

  const unitPrice = parseFloat(currentPrice.toFixed(2));
  return {
    originalPrice: parseFloat(originalUnitPrice.toFixed(2)),
    unitPrice,
    totalPrice: parseFloat((unitPrice * quantity).toFixed(2)),
    appliedDiscounts,
  };
}

/**
 * Evaluate a single rule against the current context.
 * Returns the discount amount (float) if applicable, or null.
 */
function evaluateRule(rule, { quantity, userTier, promoCode, currentPrice }) {
  const config = rule.config || {};

  switch (rule.rule_type) {
    case 'seasonal':
      // Seasonal rules are already filtered for date validity by the repository
      return computeDiscount(rule, currentPrice);

    case 'bulk':
      if (quantity >= (config.min_quantity || 1)) {
        return computeDiscount(rule, currentPrice);
      }
      return null;

    case 'user_tier':
      if (userTier && config.tier && userTier.toLowerCase() === config.tier.toLowerCase()) {
        return computeDiscount(rule, currentPrice);
      }
      return null;

    case 'promo_code':
      if (promoCode && config.code && promoCode.toUpperCase() === config.code.toUpperCase()) {
        return computeDiscount(rule, currentPrice);
      }
      return null;

    default:
      return null;
  }
}

function computeDiscount(rule, currentPrice) {
  if (rule.discount_type === 'percentage') {
    return currentPrice * (parseFloat(rule.discount_value) / 100);
  }
  // fixed
  return Math.min(parseFloat(rule.discount_value), currentPrice);
}

module.exports = { calculatePrice };
