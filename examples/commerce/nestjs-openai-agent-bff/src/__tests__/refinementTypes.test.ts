import { describe, it, expect } from 'vitest';
import {
  refinementActionSchema,
  validateRefinementAction,
  safeParseRefinementAction,
  type RefinementAction,
} from '../http/refinementTypes.js';

describe('refinementTypes', () => {
  describe('refinementActionSchema', () => {
    it('should validate a search_broaden payload', () => {
      const action: RefinementAction = {
        id: 'broaden_search',
        label: 'Search for "slippers"',
        payload: {
          type: 'search_broaden',
          query: 'slippers',
        },
      };
      
      const result = refinementActionSchema.safeParse(action);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.payload.type).toBe('search_broaden');
      }
    });

    it('should validate a search_retry payload', () => {
      const action: RefinementAction = {
        id: 'retry_original',
        label: 'Try "bear slippers"',
        payload: {
          type: 'search_retry',
          query: 'bear slippers',
        },
      };
      
      const result = refinementActionSchema.safeParse(action);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.payload.type).toBe('search_retry');
      }
    });

    it('should validate a remove_constraints payload', () => {
      const action: RefinementAction = {
        id: 'remove_constraints',
        label: 'Remove constraints',
        payload: {
          type: 'remove_constraints',
          constraintsToRemove: ['men', '30-31', 'brown'],
        },
      };
      
      const result = refinementActionSchema.safeParse(action);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.payload.type).toBe('remove_constraints');
      }
    });

    it('should validate an ask_clarify payload', () => {
      const action: RefinementAction = {
        id: 'ask_clarify',
        label: 'Help me find what you need',
        payload: {
          type: 'ask_clarify',
          question: 'Could you describe what you\'re looking for in different words?',
        },
      };
      
      const result = refinementActionSchema.safeParse(action);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.payload.type).toBe('ask_clarify');
      }
    });

    it('should validate a filter_by_dimension payload', () => {
      const action: RefinementAction = {
        id: 'filter_by_color',
        label: 'Filter by Color',
        payload: {
          type: 'filter_by_dimension',
          dimension: 'Color',
          value: 'Brown',
        },
      };
      
      const result = refinementActionSchema.safeParse(action);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.payload.type).toBe('filter_by_dimension');
      }
    });

    it('should validate filter_by_dimension without optional value', () => {
      const action: RefinementAction = {
        id: 'filter_by_size',
        label: 'Filter by Size',
        payload: {
          type: 'filter_by_dimension',
          dimension: 'Size',
        },
      };
      
      const result = refinementActionSchema.safeParse(action);
      expect(result.success).toBe(true);
    });

    it('should reject invalid payload type', () => {
      const action = {
        id: 'invalid',
        label: 'Invalid action',
        payload: {
          type: 'invalid_type',
          query: 'test',
        },
      };
      
      const result = refinementActionSchema.safeParse(action);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const action = {
        id: 'missing_label',
        payload: {
          type: 'search_broaden',
          query: 'slippers',
        },
      };
      
      const result = refinementActionSchema.safeParse(action);
      expect(result.success).toBe(false);
    });

    it('should reject search_broaden without query', () => {
      const action = {
        id: 'broaden_search',
        label: 'Search for "slippers"',
        payload: {
          type: 'search_broaden',
        },
      };
      
      const result = refinementActionSchema.safeParse(action);
      expect(result.success).toBe(false);
    });
  });

  describe('validateRefinementAction', () => {
    it('should return validated action for valid input', () => {
      const action: RefinementAction = {
        id: 'broaden_search',
        label: 'Search for "slippers"',
        payload: {
          type: 'search_broaden',
          query: 'slippers',
        },
      };
      
      const result = validateRefinementAction(action);
      expect(result.id).toBe('broaden_search');
      expect(result.payload.type).toBe('search_broaden');
    });

    it('should throw for invalid input', () => {
      const action = {
        id: 'invalid',
        label: 'Invalid',
        payload: {
          type: 'invalid_type',
        },
      };
      
      expect(() => validateRefinementAction(action)).toThrow();
    });
  });

  describe('safeParseRefinementAction', () => {
    it('should return success for valid input', () => {
      const action: RefinementAction = {
        id: 'retry_original',
        label: 'Try "bear slippers"',
        payload: {
          type: 'search_retry',
          query: 'bear slippers',
        },
      };
      
      const result = safeParseRefinementAction(action);
      expect(result.success).toBe(true);
    });

    it('should return error for invalid input', () => {
      const action = {
        id: 'invalid',
        payload: {},
      };
      
      const result = safeParseRefinementAction(action);
      expect(result.success).toBe(false);
    });
  });
});
