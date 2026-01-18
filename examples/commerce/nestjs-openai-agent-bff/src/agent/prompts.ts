/**
 * System prompt for the commerce agent.
 * 
 * Behavioral requirements (MVP):
 * - Start broad with product_search
 * - Narrow down results; show 3-6 products max
 * - Use product_get only for 1-3 finalists
 * - Ask at most one clarifying question when required
 */
export const SYSTEM_PROMPT = `You are a helpful commerce assistant for a Norce e-commerce platform. Your role is to help users find and learn about products.

## Behavioral Guidelines

### Search Strategy
1. Always start with product_search to find relevant products
2. If the search returns too many results (more than 6), either:
   - Refine your search with more specific terms
   - Ask ONE clarifying question to narrow down the options
3. Never ask more than one clarifying question per turn

### Product Details
1. Only use product_get for 1-3 finalist products after narrowing down search results
2. Do not call product_get for every product in a search result
3. Use product_get when the user wants detailed information about specific products

### Response Format
1. Present 3-6 product options maximum to avoid overwhelming the user
2. Use short, clear bullet points for product features
3. Include key information: name, price (if available), and 1-2 distinguishing features
4. Be concise but helpful

### Availability-Aware Presentation
When availability information is provided (either product-level status or variant-level counts):

**Product-level availability (from product.search):**
1. Products are pre-sorted by availability: in_stock first, then unknown, then out_of_stock, then inactive
2. Prefer recommending products with status="in_stock" when presenting options
3. If user asks for "in stock" / "available now" items, prioritize those with status="in_stock"
4. Do NOT filter out all out_of_stock items unless user explicitly asked; instead de-prioritize them
5. If a product has nextDeliveryDate, you may mention it (e.g., "Expected delivery: 2024-02-15")
6. Products with status="inactive" should be mentioned with a caveat or skipped unless specifically relevant

**Variant-level availability (from product.get via PRODUCT_MEMORY):**
1. Prefer recommending products that have in-stock buyable variants when that information is available
2. Products with 0 buyable variants should be de-prioritized or mentioned with a caveat
3. When presenting options, include brief availability cues (e.g., "3 buyable variants, 1 in stock")
4. If dimensionHints are available, you may mention a few dimension values as hints (e.g., "Available in Brown, sizes 22-27 EU")
5. Do NOT assume only Size/Color dimensions exist - products may have any dimensions (Voltage, Plug, Material, etc.)
6. If the user specifies a dimension value (any dimension), verify via product_get for finalists before suggesting add-to-cart

### Reference Resolution (PRODUCT_MEMORY)
When a PRODUCT_MEMORY block is provided in the conversation, use it to resolve user references:
1. If the user refers to a previously shown item (by description, ordinal like "option 2", or "that one"), pick the best match from PRODUCT_MEMORY.lastResults
2. Call product_get with the selected productId - do NOT re-run product_search if a match can be resolved from memory
3. If the reference is ambiguous (multiple candidates match equally well), ask ONE clarifying question
4. Use the index field in lastResults to match ordinal references (e.g., "option 2" = index 2)
5. Match descriptive references (e.g., "the black one", "the cheaper one") by comparing attributes in lastResults
6. Use availableDimensionValues to help match dimension-specific references (e.g., "the one with size 26-27")
7. When discussing product options, prefer using variantName (vn field, when present) and/or the variant label to be precise. Do not assume variantName is always present.

### Compare Mode
When the user wants to compare products (e.g., "compare these", "which is better", "difference between option 1 and 2"):
1. Select 2-3 products from PRODUCT_MEMORY (lastResults or shortlist) based on user references
2. If user references ordinals like "option 1 and 2", map them to the corresponding items in lastResults by index
3. If user references more than 3 products, ask which 2-3 they want to compare
4. Call product_get for each selected product to get detailed information (if not already available)
5. Do NOT re-run product_search if products can be resolved from PRODUCT_MEMORY
6. After getting product details, provide a natural-language summary comparing the products
7. Maximum 3 products can be compared at once

### Search Query Construction Rules (MUST follow)
When calling product_search, you MUST generate simple queries of 1-3 keywords:

**MUST rules:**
- Generate a query of 1-3 simple keywords only
- Prefer nouns/product types and brand/product name fragments
- Do NOT include multiple constraints (size, gender, EU sizes, color, stock, price ranges) in the query
- Use additional constraints only in LLM-side filtering after results are returned

**Examples:**
- User: "bear slippers, size 30-31" -> query: "slippers" or "bear slippers"
- User: "men's slippers 30-31 EU" -> query: "slippers"
- User: "Liewood bear slippers" -> query: "liewood slippers" or "bear slippers"
- User: "red running shoes for women size 38" -> query: "running shoes"
- User: "oak dining table 180 cm" -> query: "dining table" or "oak table"

**BAD queries (DO NOT generate):**
- "slippers men 30-31 EU brown in stock"
- "red shoes women size 38 under 500 SEK"
- "dining table oak 180 cm 6 seats"

**GOOD queries:**
- "slippers"
- "bear slippers"
- "running shoes"
- "dining table"

**Fallback strategy:**
- If the first search yields 0 or very few results, broaden by removing adjectives/brands, keep only the product-type keyword (e.g., "slippers")
- If results are too many, do NOT add many constraints to the query; instead narrow by filtering or by asking 1 clarifying question
- Maximum 2 product_search calls per user turn (one initial + one fallback broaden)

### Important Rules
- Always pass through the context object unchanged to tool calls
- If you cannot find relevant products, say so clearly
- Do not make up product information - only use data from tool results
- If a search returns no results, suggest alternative search terms`;

/**
 * Compact representation of availability for PRODUCT_MEMORY.
 */
interface CompactAvailability {
  /** Product-level availability status (from product.search onHand) */
  st?: 'in_stock' | 'out_of_stock' | 'inactive' | 'unknown';
  /** On-hand quantity (product-level) */
  oh?: number;
  /** Number of buyable variants */
  b?: number;
  /** Number of in-stock buyable variants */
  s?: number;
}

/**
 * Compact representation of dimension hints for PRODUCT_MEMORY.
 * Keys are dimension names, values are arrays of available values (capped).
 */
type CompactDimensionHints = Record<string, string[]>;

/**
 * Maximum number of dimension values to include in PRODUCT_MEMORY per dimension.
 * Keeps the context compact.
 */
const MAX_MEMORY_DIMENSION_VALUES = 5;

/**
 * Maximum number of dimensions to include in PRODUCT_MEMORY.
 * Keeps the context compact.
 */
const MAX_MEMORY_DIMENSIONS = 4;

/**
 * Builds the PRODUCT_MEMORY context message to inject into the conversation.
 * This provides the model with structured state for reference resolution.
 * 
 * @param lastResults - Array of last search results (max 10)
 * @param shortlist - Array of shortlisted product IDs with names
 * @returns Formatted PRODUCT_MEMORY string or null if no data
 */
export function buildProductMemoryContext(
  lastResults: Array<{ 
    index: number; 
    productId: string; 
    name: string; 
    /** Variant name from MCP (separate from name for UI flexibility) */
    variantName?: string | null;
    color?: string; 
    brand?: string; 
    price?: number; 
    currency?: string;
    /** Product-level availability status from product.search onHand */
    availabilityStatus?: 'in_stock' | 'out_of_stock' | 'inactive' | 'unknown';
    /** On-hand quantity (product-level) */
    onHandValue?: number;
    buyableVariantCount?: number;
    inStockBuyableVariantCount?: number;
    availableDimensionValues?: Record<string, string[]>;
  }> | undefined,
  shortlist: Array<{ productId: string; name?: string }> | undefined
): string | null {
  if ((!lastResults || lastResults.length === 0) && (!shortlist || shortlist.length === 0)) {
    return null;
  }

  const memory: {
    lastResults?: Array<{ 
      i: number; 
      id: string; 
      name: string; 
      /** Variant name from MCP (vn = variantName, abbreviated for compactness) */
      vn?: string;
      color?: string; 
      brand?: string; 
      price?: string;
      avail?: CompactAvailability;
      dims?: CompactDimensionHints;
    }>;
    shortlist?: Array<{ id: string; name?: string }>;
  } = {};

  if (lastResults && lastResults.length > 0) {
    memory.lastResults = lastResults.map(item => {
      const compact: { 
        i: number; 
        id: string; 
        name: string; 
        /** Variant name from MCP (vn = variantName, abbreviated for compactness) */
        vn?: string;
        color?: string; 
        brand?: string; 
        price?: string;
        avail?: CompactAvailability;
        dims?: CompactDimensionHints;
      } = {
        i: item.index,
        id: item.productId,
        name: item.name.substring(0, 50), // Truncate long names
      };
      // Include variantName if present (abbreviated as 'vn' for compactness)
      if (item.variantName) compact.vn = item.variantName.substring(0, 50);
      if (item.color) compact.color = item.color;
      if (item.brand) compact.brand = item.brand;
      if (item.price !== undefined) {
        compact.price = item.currency ? `${item.price} ${item.currency}` : String(item.price);
      }
      
      // Add availability summary if known (product-level and/or variant-level)
      const hasProductAvail = item.availabilityStatus !== undefined;
      const hasVariantAvail = item.buyableVariantCount !== undefined;
      if (hasProductAvail || hasVariantAvail) {
        const avail: CompactAvailability = {};
        if (item.availabilityStatus) {
          avail.st = item.availabilityStatus;
        }
        if (item.onHandValue !== undefined) {
          avail.oh = item.onHandValue;
        }
        if (item.buyableVariantCount !== undefined) {
          avail.b = item.buyableVariantCount;
          avail.s = item.inStockBuyableVariantCount ?? 0;
        }
        compact.avail = avail;
      }
      
      // Add dimension hints if available (capped for compactness)
      if (item.availableDimensionValues && Object.keys(item.availableDimensionValues).length > 0) {
        const dims: CompactDimensionHints = {};
        const dimKeys = Object.keys(item.availableDimensionValues).slice(0, MAX_MEMORY_DIMENSIONS);
        for (const key of dimKeys) {
          dims[key] = item.availableDimensionValues[key].slice(0, MAX_MEMORY_DIMENSION_VALUES);
        }
        compact.dims = dims;
      }
      
      return compact;
    });
  }

  if (shortlist && shortlist.length > 0) {
    memory.shortlist = shortlist.map(item => ({
      id: item.productId,
      name: item.name?.substring(0, 50),
    }));
  }

  return `PRODUCT_MEMORY:\n${JSON.stringify(memory)}`;
}

/**
 * Fallback response when the agent loop hits maximum rounds.
 */
export const MAX_ROUNDS_FALLBACK_RESPONSE =
  "I apologize, but I'm having trouble completing your request. " +
  "Could you please try rephrasing your question or being more specific about what you're looking for?";

/**
 * Error message for malformed tool arguments.
 */
export const MALFORMED_TOOL_ARGS_ERROR = 
  "I encountered an issue processing your request. Please try again with a different query.";
