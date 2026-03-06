const productRepo    = require('../repositories/productRepository');
const variantRepo    = require('../repositories/variantRepository');
const categoryRepo   = require('../repositories/categoryRepository');
const pricingRuleRepo = require('../repositories/pricingRuleRepository');
const pricingEngine  = require('./pricingEngine');
const { NotFoundError, ConflictError } = require('../utils/errors');

class ProductService {
  // ---- Categories ----

  async listCategories() {
    return categoryRepo.findAll();
  }

  async getCategoryById(id) {
    const cat = await categoryRepo.findById(id);
    if (!cat) throw new NotFoundError('Category not found');
    return cat;
  }

  async createCategory(data) {
    if (data.slug) {
      const existing = await categoryRepo.findBySlug(data.slug);
      if (existing) throw new ConflictError('Slug already in use');
    }
    if (data.parent_id) {
      const parent = await categoryRepo.findById(data.parent_id);
      if (!parent) throw new NotFoundError('Parent category not found');
    }
    return categoryRepo.create(data);
  }

  async updateCategory(id, data) {
    const existing = await categoryRepo.findById(id);
    if (!existing) throw new NotFoundError('Category not found');
    return categoryRepo.update(id, data);
  }

  async deleteCategory(id) {
    const existing = await categoryRepo.findById(id);
    if (!existing) throw new NotFoundError('Category not found');
    return categoryRepo.delete(id);
  }

  // ---- Products ----

  async listProducts(filters) {
    return productRepo.findAll(filters);
  }

  async getProductById(id) {
    const product = await productRepo.findById(id);
    if (!product) throw new NotFoundError('Product not found');
    const variants = await variantRepo.findByProductId(id);
    return { ...product, variants };
  }

  async createProduct(data) {
    if (data.category_id) {
      const cat = await categoryRepo.findById(data.category_id);
      if (!cat) throw new NotFoundError('Category not found');
    }
    return productRepo.create(data);
  }

  async updateProduct(id, data) {
    const existing = await productRepo.findById(id);
    if (!existing) throw new NotFoundError('Product not found');
    return productRepo.update(id, data);
  }

  async deleteProduct(id) {
    const existing = await productRepo.findById(id);
    if (!existing) throw new NotFoundError('Product not found');
    return productRepo.delete(id);
  }

  // ---- Variants ----

  async listVariants(productId) {
    const product = await productRepo.findById(productId);
    if (!product) throw new NotFoundError('Product not found');
    return variantRepo.findByProductId(productId);
  }

  async getVariantById(productId, variantId) {
    const variant = await variantRepo.findById(variantId);
    if (!variant || variant.product_id !== parseInt(productId)) {
      throw new NotFoundError('Variant not found');
    }
    return variant;
  }

  async createVariant(productId, data) {
    const product = await productRepo.findById(productId);
    if (!product) throw new NotFoundError('Product not found');
    const existing = await variantRepo.findBySku(data.sku);
    if (existing) throw new ConflictError('SKU already exists');
    return variantRepo.create({ ...data, product_id: parseInt(productId) });
  }

  async updateVariant(productId, variantId, data) {
    const variant = await variantRepo.findById(variantId);
    if (!variant || variant.product_id !== parseInt(productId)) {
      throw new NotFoundError('Variant not found');
    }
    if (data.sku && data.sku !== variant.sku) {
      const existing = await variantRepo.findBySku(data.sku);
      if (existing) throw new ConflictError('SKU already in use');
    }
    return variantRepo.update(variantId, data);
  }

  async deleteVariant(productId, variantId) {
    const variant = await variantRepo.findById(variantId);
    if (!variant || variant.product_id !== parseInt(productId)) {
      throw new NotFoundError('Variant not found');
    }
    return variantRepo.delete(variantId);
  }

  // ---- Dynamic Price Calculation ----

  async calculatePrice(productId, { quantity = 1, user_tier, promo_code } = {}) {
    const product = await productRepo.findById(productId);
    if (!product) throw new NotFoundError('Product not found');

    const rules = await pricingRuleRepo.findApplicable({
      product_id: productId,
      category_id: product.category_id,
    });

    // One price calc per variant
    const variants = await variantRepo.findByProductId(productId);
    const variantPrices = variants.map((v) => {
      const basePrice = parseFloat(product.base_price) + parseFloat(v.price_adjustment);
      const result = pricingEngine.calculate(basePrice, rules, { quantity, user_tier, promo_code });
      return {
        variant_id: v.id,
        sku: v.sku,
        attributes: v.attributes,
        available_quantity: parseInt(v.available_quantity),
        ...result,
      };
    });

    // Also return a base (no variant selected) price for display
    const baseResult = pricingEngine.calculate(
      parseFloat(product.base_price),
      rules,
      { quantity, user_tier, promo_code }
    );

    return {
      product_id: product.id,
      product_name: product.name,
      base_price: parseFloat(product.base_price),
      quantity,
      user_tier: user_tier || null,
      promo_code: promo_code || null,
      base_price_calculation: baseResult,
      variant_prices: variantPrices,
    };
  }

  // ---- Pricing Rules ----

  async listPricingRules() {
    return pricingRuleRepo.findAll();
  }

  async getPricingRuleById(id) {
    const rule = await pricingRuleRepo.findById(id);
    if (!rule) throw new NotFoundError('Pricing rule not found');
    return rule;
  }

  async createPricingRule(data) {
    return pricingRuleRepo.create(data);
  }

  async updatePricingRule(id, data) {
    const existing = await pricingRuleRepo.findById(id);
    if (!existing) throw new NotFoundError('Pricing rule not found');
    return pricingRuleRepo.update(id, data);
  }

  async deletePricingRule(id) {
    const existing = await pricingRuleRepo.findById(id);
    if (!existing) throw new NotFoundError('Pricing rule not found');
    return pricingRuleRepo.delete(id);
  }
}

module.exports = new ProductService();
