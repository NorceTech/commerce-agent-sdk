/**
 * Summarize comparison using LLM for highlights.
 * 
 * This module generates highlights and recommendations for product comparisons
 * using the existing OpenAI client within the same request turn.
 * 
 * IMPORTANT: This is optional and MUST fail safely - if summarization fails,
 * the comparison table should still be returned without highlights.
 */

import { OpenAiClient } from '../../openai/OpenAiClient.js';
import { CompareProductData, ComparisonSummaryResult } from './compareTypes.js';
import pino from 'pino';

const logger = pino({ name: 'summarizeComparison' });

/**
 * Maximum tokens for the summarization response.
 * Keep this small to avoid token bloat.
 */
const MAX_SUMMARY_TOKENS = 300;

/**
 * Generates highlights and a summary for a product comparison.
 * 
 * This function uses the OpenAI client to generate:
 * - 3-5 highlight bullets per product
 * - A 2-4 sentence overall recommendation
 * 
 * IMPORTANT: This function MUST fail safely. If summarization fails,
 * it returns null and the caller should proceed without highlights.
 * 
 * @param products - Array of normalized product data
 * @param openaiClient - OpenAI client instance
 * @returns ComparisonSummaryResult or null if summarization fails
 */
export async function summarizeComparison(
  products: CompareProductData[],
  openaiClient: OpenAiClient
): Promise<ComparisonSummaryResult | null> {
  try {
    const prompt = buildSummarizationPrompt(products);
    
    const response = await openaiClient.runWithTools({
      input: [
        {
          role: 'system',
          content: 'You are a helpful shopping assistant. Generate concise product comparison highlights. Respond ONLY with valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      tools: [],
      model: undefined, // Use default model
      maxTokens: MAX_SUMMARY_TOKENS,
    });

    if (!response.content) {
      logger.warn('Empty response from summarization');
      return null;
    }

    return parseSummarizationResponse(response.content, products);
  } catch (error) {
    // Log the error but don't throw - fail safely
    logger.warn({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Summarization failed, proceeding without highlights');
    return null;
  }
}

/**
 * Builds the prompt for summarization.
 * 
 * @param products - Array of product data
 * @returns Prompt string
 */
function buildSummarizationPrompt(products: CompareProductData[]): string {
  const productSummaries = products.map((p, i) => {
    const attrs = Object.entries(p.attributes)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    const priceStr = p.price?.formatted || (p.price?.amount ? `${p.price.amount} ${p.price.currency || ''}` : 'N/A');
    return `Product ${i + 1}: ${p.name}
- Brand: ${p.brand || 'N/A'}
- Price: ${priceStr}
- Attributes: ${attrs || 'N/A'}`;
  }).join('\n\n');

  return `Compare these ${products.length} products and provide:
1. For each product, 2-3 short highlight bullets (key strengths or differentiators)
2. A 1-2 sentence overall recommendation

Products:
${productSummaries}

Respond in this exact JSON format:
{
  "summary": "Overall recommendation text",
  "highlights": {
    "${products[0].productId}": ["highlight 1", "highlight 2"],
    "${products[1].productId}": ["highlight 1", "highlight 2"]${products.length > 2 ? `,
    "${products[2].productId}": ["highlight 1", "highlight 2"]` : ''}
  }
}`;
}

/**
 * Parses the summarization response from OpenAI.
 * 
 * @param content - Response content from OpenAI
 * @param products - Original product data for validation
 * @returns ComparisonSummaryResult or null if parsing fails
 */
function parseSummarizationResponse(
  content: string,
  products: CompareProductData[]
): ComparisonSummaryResult | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('No JSON found in summarization response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      summary?: string;
      highlights?: Record<string, string[]>;
    };

    if (!parsed.summary || !parsed.highlights) {
      logger.warn('Invalid summarization response structure');
      return null;
    }

    const perProductHighlights = new Map<string, string[]>();
    
    for (const product of products) {
      const highlights = parsed.highlights[product.productId];
      if (Array.isArray(highlights) && highlights.length > 0) {
        // Cap at 5 highlights per product
        perProductHighlights.set(
          product.productId,
          highlights.slice(0, 5).map(h => String(h).substring(0, 200))
        );
      }
    }

    return {
      summaryText: String(parsed.summary).substring(0, 500),
      perProductHighlights,
    };
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to parse summarization response');
    return null;
  }
}

/**
 * Applies highlights from summarization to comparison items.
 * 
 * @param items - Comparison items to update
 * @param summaryResult - Summarization result with highlights
 */
export function applyHighlightsToItems(
  items: Array<{ productId: string; highlights?: string[] }>,
  summaryResult: ComparisonSummaryResult
): void {
  for (const item of items) {
    const highlights = summaryResult.perProductHighlights.get(item.productId);
    if (highlights && highlights.length > 0) {
      item.highlights = highlights;
    }
  }
}
