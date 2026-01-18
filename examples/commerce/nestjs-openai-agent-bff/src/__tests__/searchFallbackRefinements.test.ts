import { describe, it, expect } from 'vitest';
import {
  buildEmptySearchRefinements,
  buildFilterRefinements,
  shouldIncludeRefinements,
  buildEmptySearchMessage,
  type SearchAttemptInfo,
} from '../agent/search/searchFallbackRefinements.js';

describe('searchFallbackRefinements', () => {
  describe('buildEmptySearchRefinements', () => {
    it('should return broaden search refinement when fallback not attempted', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'bear slippers',
        effectiveQuery: 'bear slippers',
        wasSimplified: false,
        fallbackRetryAttempted: false,
        resultCount: 0,
      };
      
      const refinements = buildEmptySearchRefinements(searchInfo);
      
      expect(refinements.length).toBeGreaterThan(0);
      const broadenRefinement = refinements.find(r => r.id === 'broaden_search');
      expect(broadenRefinement).toBeDefined();
      expect(broadenRefinement?.payload.type).toBe('search_broaden');
    });

    it('should return ask_clarify refinement when fallback was attempted and still 0 results', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'bear slippers',
        effectiveQuery: 'bear',
        wasSimplified: false,
        fallbackRetryAttempted: true,
        broadenedQuery: 'bear',
        resultCount: 0,
      };
      
      const refinements = buildEmptySearchRefinements(searchInfo);
      
      const clarifyRefinement = refinements.find(r => r.id === 'ask_clarify');
      expect(clarifyRefinement).toBeDefined();
      expect(clarifyRefinement?.payload.type).toBe('ask_clarify');
    });

    it('should return remove_constraints refinement when tokens were dropped', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'slippers men 30-31 brown',
        effectiveQuery: 'slippers',
        wasSimplified: true,
        droppedTokens: ['men', '30-31', 'brown'],
        fallbackRetryAttempted: false,
        resultCount: 0,
      };
      
      const refinements = buildEmptySearchRefinements(searchInfo);
      
      const removeConstraintsRefinement = refinements.find(r => r.id === 'remove_constraints');
      expect(removeConstraintsRefinement).toBeDefined();
      expect(removeConstraintsRefinement?.payload.type).toBe('remove_constraints');
    });

    it('should return retry_original refinement when original differs from effective', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'slippers men 30-31',
        effectiveQuery: 'slippers',
        wasSimplified: true,
        droppedTokens: ['men', '30-31'],
        fallbackRetryAttempted: false,
        resultCount: 0,
      };
      
      const refinements = buildEmptySearchRefinements(searchInfo);
      
      const retryRefinement = refinements.find(r => r.id === 'retry_original');
      expect(retryRefinement).toBeDefined();
      expect(retryRefinement?.payload.type).toBe('search_retry');
    });

    it('should cap refinements at 4', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'slippers men 30-31 brown in stock',
        effectiveQuery: 'slippers',
        wasSimplified: true,
        droppedTokens: ['men', '30-31', 'brown', 'in', 'stock'],
        fallbackRetryAttempted: true,
        broadenedQuery: 'slippers',
        resultCount: 0,
      };
      
      const refinements = buildEmptySearchRefinements(searchInfo);
      
      expect(refinements.length).toBeLessThanOrEqual(4);
    });

    it('should not include broaden refinement when fallback was already attempted', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'bear slippers',
        effectiveQuery: 'bear',
        wasSimplified: false,
        fallbackRetryAttempted: true,
        broadenedQuery: 'bear',
        resultCount: 0,
      };
      
      const refinements = buildEmptySearchRefinements(searchInfo);
      
      const broadenRefinement = refinements.find(r => r.id === 'broaden_search');
      expect(broadenRefinement).toBeUndefined();
    });
  });

  describe('buildFilterRefinements', () => {
    it('should return filter refinements for available dimensions', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'slippers',
        effectiveQuery: 'slippers',
        wasSimplified: false,
        fallbackRetryAttempted: false,
        resultCount: 10,
      };
      
      const refinements = buildFilterRefinements(searchInfo, ['Color', 'Size']);
      
      expect(refinements.length).toBe(2);
      expect(refinements[0].payload.type).toBe('filter_by_dimension');
      expect(refinements[0].label).toBe('Filter by Color');
      expect(refinements[1].label).toBe('Filter by Size');
    });

    it('should cap filter refinements at 2', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'slippers',
        effectiveQuery: 'slippers',
        wasSimplified: false,
        fallbackRetryAttempted: false,
        resultCount: 10,
      };
      
      const refinements = buildFilterRefinements(searchInfo, ['Color', 'Size', 'Brand', 'Material']);
      
      expect(refinements.length).toBe(2);
    });

    it('should return empty array when no dimensions provided', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'slippers',
        effectiveQuery: 'slippers',
        wasSimplified: false,
        fallbackRetryAttempted: false,
        resultCount: 10,
      };
      
      const refinements = buildFilterRefinements(searchInfo);
      
      expect(refinements.length).toBe(0);
    });
  });

  describe('shouldIncludeRefinements', () => {
    it('should return true when search returned 0 results', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'bear slippers',
        effectiveQuery: 'bear slippers',
        wasSimplified: false,
        fallbackRetryAttempted: false,
        resultCount: 0,
      };
      
      expect(shouldIncludeRefinements(searchInfo)).toBe(true);
    });

    it('should return true when query was simplified and dropped tokens', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'slippers men 30-31',
        effectiveQuery: 'slippers',
        wasSimplified: true,
        droppedTokens: ['men', '30-31'],
        fallbackRetryAttempted: false,
        resultCount: 5,
      };
      
      expect(shouldIncludeRefinements(searchInfo)).toBe(true);
    });

    it('should return false when search returned results and no simplification', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'slippers',
        effectiveQuery: 'slippers',
        wasSimplified: false,
        fallbackRetryAttempted: false,
        resultCount: 5,
      };
      
      expect(shouldIncludeRefinements(searchInfo)).toBe(false);
    });
  });

  describe('buildEmptySearchMessage', () => {
    it('should mention both queries when fallback was attempted', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'bear slippers',
        effectiveQuery: 'bear',
        wasSimplified: false,
        fallbackRetryAttempted: true,
        broadenedQuery: 'bear',
        resultCount: 0,
      };
      
      const message = buildEmptySearchMessage(searchInfo);
      
      expect(message).toContain('bear slippers');
      expect(message).toContain('bear');
    });

    it('should mention simplification when query was simplified', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'slippers men 30-31',
        effectiveQuery: 'slippers',
        wasSimplified: true,
        droppedTokens: ['men', '30-31'],
        fallbackRetryAttempted: false,
        resultCount: 0,
      };
      
      const message = buildEmptySearchMessage(searchInfo);
      
      expect(message).toContain('slippers men 30-31');
      expect(message).toContain('simplifying');
    });

    it('should return basic message for simple query with no results', () => {
      const searchInfo: SearchAttemptInfo = {
        originalQuery: 'xyznonexistent',
        effectiveQuery: 'xyznonexistent',
        wasSimplified: false,
        fallbackRetryAttempted: false,
        resultCount: 0,
      };
      
      const message = buildEmptySearchMessage(searchInfo);
      
      expect(message).toContain('xyznonexistent');
      expect(message).toContain('couldn\'t find');
    });
  });
});
