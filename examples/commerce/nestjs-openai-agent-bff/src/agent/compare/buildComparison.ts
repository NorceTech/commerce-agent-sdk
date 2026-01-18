/**
 * Build structured comparison payload from product data.
 * 
 * This module creates the deterministic comparison payload from
 * product_get tool outputs.
 */

import type { ComparisonBlock, ComparisonItem, ComparisonTable } from '../../http/responseTypes.js';
import { MAX_FEATURES, CompareProductData } from './compareTypes.js';

/**
 * Priority order for features in the comparison table.
 * Features are ordered by relevance: price first, then key specs.
 */
const FEATURE_PRIORITY = [
  'price',
  'brand',
  'material',
  'color',
  'size',
  'weight',
  'dimensions',
  'category',
  'manufacturer',
  'model',
  'warranty',
  'availability',
];

/**
 * Builds a structured comparison payload from product data.
 * 
 * @param products - Array of normalized product data (2-3 products)
 * @param title - Optional title for the comparison
 * @returns ComparisonBlock with items and table
 */
export function buildComparison(
  products: CompareProductData[],
  title?: string
): ComparisonBlock {
  if (products.length < 2) {
    throw new Error('At least 2 products are required for comparison');
  }

  const productIds = products.map(p => p.productId);
  const items = products.map(p => buildComparisonItem(p));
  const table = buildComparisonTable(products);

  const comparisonTitle = title || generateComparisonTitle(products);

  return {
    title: comparisonTitle,
    productIds,
    items,
    table,
  };
}

/**
 * Builds a single comparison item from product data.
 * 
 * @param product - Normalized product data
 * @returns ComparisonItem
 */
function buildComparisonItem(product: CompareProductData): ComparisonItem {
  const item: ComparisonItem = {
    productId: product.productId,
    name: product.name,
  };

  if (product.brand) {
    item.brand = product.brand;
  }

  if (product.price) {
    item.price = {
      amount: product.price.amount,
      currency: product.price.currency,
      formatted: product.price.formatted,
    };
  }

  if (Object.keys(product.attributes).length > 0) {
    item.attributes = { ...product.attributes };
  }

  if (product.url) {
    item.url = product.url;
  }

  return item;
}

/**
 * Builds the comparison table from product data.
 * Selects common attributes across products and caps at MAX_FEATURES.
 * 
 * @param products - Array of normalized product data
 * @returns ComparisonTable with headers and rows
 */
function buildComparisonTable(products: CompareProductData[]): ComparisonTable {
  // Build headers: Feature column + one column per product
  const headers = ['Feature', ...products.map(p => truncateName(p.name, 30))];

  // Collect all attribute keys across products
  const allKeys = new Set<string>();
  for (const product of products) {
    for (const key of Object.keys(product.attributes)) {
      allKeys.add(key);
    }
  }

  // Add price as a feature if any product has it
  if (products.some(p => p.price?.amount !== undefined || p.price?.formatted)) {
    allKeys.add('price');
  }

  // Add brand as a feature if any product has it
  if (products.some(p => p.brand)) {
    allKeys.add('brand');
  }

  // Sort keys by priority, then alphabetically for non-priority keys
  const sortedKeys = Array.from(allKeys).sort((a, b) => {
    const priorityA = FEATURE_PRIORITY.indexOf(a.toLowerCase());
    const priorityB = FEATURE_PRIORITY.indexOf(b.toLowerCase());
    
    if (priorityA !== -1 && priorityB !== -1) {
      return priorityA - priorityB;
    }
    if (priorityA !== -1) return -1;
    if (priorityB !== -1) return 1;
    return a.localeCompare(b);
  });

  // Cap at MAX_FEATURES
  const cappedKeys = sortedKeys.slice(0, MAX_FEATURES);

  // Build rows
  const rows: ComparisonTable['rows'] = cappedKeys.map(key => {
    const feature = formatFeatureName(key);
    const values = products.map(product => getFeatureValue(product, key));
    return { feature, values };
  });

  return { headers, rows };
}

/**
 * Gets the value of a feature from a product.
 * 
 * @param product - Product data
 * @param key - Feature key
 * @returns String value for the feature
 */
function getFeatureValue(product: CompareProductData, key: string): string {
  const lowerKey = key.toLowerCase();

  // Handle special cases
  if (lowerKey === 'price') {
    if (product.price?.formatted) {
      return product.price.formatted;
    }
    if (product.price?.amount !== undefined) {
      const currency = product.price.currency || '';
      return `${product.price.amount}${currency ? ' ' + currency : ''}`;
    }
    return '-';
  }

  if (lowerKey === 'brand') {
    return product.brand || '-';
  }

  // Check attributes
  const value = product.attributes[key];
  if (value === null || value === undefined) {
    return '-';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return String(value);
}

/**
 * Formats a feature key into a human-readable name.
 * 
 * @param key - Feature key
 * @returns Formatted feature name
 */
function formatFeatureName(key: string): string {
  // Handle common abbreviations
  const abbreviations: Record<string, string> = {
    'sku': 'SKU',
    'id': 'ID',
    'url': 'URL',
  };

  if (abbreviations[key.toLowerCase()]) {
    return abbreviations[key.toLowerCase()];
  }

  // Convert camelCase or snake_case to Title Case
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\s+/, '')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Truncates a name to a maximum length.
 * 
 * @param name - Name to truncate
 * @param maxLength - Maximum length
 * @returns Truncated name
 */
function truncateName(name: string, maxLength: number): string {
  if (name.length <= maxLength) {
    return name;
  }
  return name.substring(0, maxLength - 3) + '...';
}

/**
 * Generates a comparison title from product data.
 * 
 * @param products - Array of product data
 * @returns Generated title
 */
function generateComparisonTitle(products: CompareProductData[]): string {
  // Try to find a common category or type
  const categories = products
    .map(p => p.attributes.category || p.attributes.type)
    .filter((c): c is string => typeof c === 'string');

  if (categories.length > 0 && new Set(categories).size === 1) {
    return `${categories[0]} Comparison`;
  }

  return `Product Comparison (${products.length} items)`;
}

/**
 * Normalizes a raw product object (from product_get result) to CompareProductData.
 * 
 * @param rawProduct - Raw product object from MCP
 * @returns Normalized CompareProductData
 */
export function normalizeProductForComparison(rawProduct: unknown): CompareProductData | null {
  if (!rawProduct || typeof rawProduct !== 'object') {
    return null;
  }

  let product = rawProduct as Record<string, unknown>;

  // Handle card wrapper structure (from product_get tool)
  if (product.card && typeof product.card === 'object') {
    product = product.card as Record<string, unknown>;
  }

  // Extract productId
  const idFields = ['productId', 'id', 'partNo', 'productNumber', 'sku', 'code'];
  let productId: string | undefined;
  for (const field of idFields) {
    const value = product[field];
    if (value !== undefined && value !== null && value !== '') {
      productId = String(value);
      break;
    }
  }

  // Extract name
  const nameFields = ['name', 'title', 'productName', 'displayName'];
  let name: string | undefined;
  for (const field of nameFields) {
    const value = product[field];
    if (typeof value === 'string' && value.trim() !== '') {
      name = value.trim();
      break;
    }
  }

  if (!productId || !name) {
    return null;
  }

  // Extract brand
  let brand: string | undefined;
  if (typeof product.brand === 'string' && product.brand.trim() !== '') {
    brand = product.brand.trim();
  } else if (typeof product.manufacturer === 'string' && product.manufacturer.trim() !== '') {
    brand = product.manufacturer.trim();
  }

  // Extract price
  let price: CompareProductData['price'];
  const priceField = product.price;
  if (typeof priceField === 'number') {
    price = { amount: priceField };
  } else if (typeof priceField === 'string' && priceField.trim() !== '') {
    // Try to parse as number first
    const parsedPrice = parseFloat(priceField.trim());
    if (!isNaN(parsedPrice)) {
      price = { amount: parsedPrice };
    } else {
      price = { formatted: priceField.trim() };
    }
  } else if (typeof priceField === 'object' && priceField !== null) {
    const priceObj = priceField as Record<string, unknown>;
    const amount = priceObj.value ?? priceObj.amount ?? priceObj.price;
    const currency = priceObj.currency ?? priceObj.currencyCode;
    const formatted = priceObj.formatted ?? priceObj.displayPrice;
    
    price = {};
    if (typeof amount === 'number') price.amount = amount;
    if (typeof currency === 'string') price.currency = currency;
    if (typeof formatted === 'string') price.formatted = formatted;
  }

  // Extract currency from top level if not in price
  if (price && !price.currency) {
    const topCurrency = product.currency ?? product.currencyCode;
    if (typeof topCurrency === 'string') {
      price.currency = topCurrency;
    }
  }

  // Extract URL
  let url: string | undefined;
  const urlFields = ['url', 'productUrl', 'link', 'href'];
  for (const field of urlFields) {
    const value = product[field];
    if (typeof value === 'string' && value.trim() !== '') {
      url = value.trim();
      break;
    }
  }

  // Extract attributes
  const attributes: Record<string, string | number | boolean | null> = {};
  const attrFields = ['color', 'size', 'material', 'weight', 'dimensions', 'category', 'type', 'model', 'warranty'];
  
  for (const field of attrFields) {
    const value = product[field];
    if (value !== undefined && value !== null && value !== '') {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        attributes[field] = value;
      }
    }
  }

  // Also check nested attributes object
  if (typeof product.attributes === 'object' && product.attributes !== null && !Array.isArray(product.attributes)) {
    const nestedAttrs = product.attributes as Record<string, unknown>;
    for (const [key, value] of Object.entries(nestedAttrs)) {
      if (attributes[key] === undefined && value !== undefined && value !== null && value !== '') {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          attributes[key] = value;
        }
      }
    }
  }

  return {
    productId,
    name,
    brand,
    price,
    attributes,
    url,
  };
}
