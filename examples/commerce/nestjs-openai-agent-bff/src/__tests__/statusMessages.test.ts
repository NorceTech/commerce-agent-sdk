import { describe, it, expect } from 'vitest';
import {
  userFacingStatus,
  getStatusStageForTool,
  getStatusStageForRound,
  buildDevStatus,
  StatusStage,
} from '../agent/statusMessages.js';

describe('statusMessages', () => {
  describe('userFacingStatus', () => {
    it('should return "Starting…" for start stage', () => {
      expect(userFacingStatus('start')).toBe('Starting…');
    });

    it('should return "Thinking…" for thinking stage', () => {
      expect(userFacingStatus('thinking')).toBe('Thinking…');
    });

    it('should return "Searching the catalog…" for searching stage', () => {
      expect(userFacingStatus('searching')).toBe('Searching the catalog…');
    });

    it('should return "Refining the results…" for refining stage', () => {
      expect(userFacingStatus('refining')).toBe('Refining the results…');
    });

    it('should return "Fetching product details…" for fetchingDetails stage', () => {
      expect(userFacingStatus('fetchingDetails')).toBe('Fetching product details…');
    });

    it('should return "Updating your cart…" for updatingCart stage', () => {
      expect(userFacingStatus('updatingCart')).toBe('Updating your cart…');
    });

    it('should return "Preparing the reply…" for finalizing stage', () => {
      expect(userFacingStatus('finalizing')).toBe('Preparing the reply…');
    });

    it('should return a message for all defined stages', () => {
      const stages: StatusStage[] = [
        'start',
        'thinking',
        'searching',
        'refining',
        'fetchingDetails',
        'updatingCart',
        'finalizing',
      ];

      for (const stage of stages) {
        const message = userFacingStatus(stage);
        expect(message).toBeDefined();
        expect(typeof message).toBe('string');
        expect(message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getStatusStageForTool', () => {
    it('should return "searching" for product_search', () => {
      expect(getStatusStageForTool('product_search')).toBe('searching');
    });

    it('should return "fetchingDetails" for product_get', () => {
      expect(getStatusStageForTool('product_get')).toBe('fetchingDetails');
    });

    it('should return "updatingCart" for cart_get', () => {
      expect(getStatusStageForTool('cart_get')).toBe('updatingCart');
    });

    it('should return "updatingCart" for cart_add_item', () => {
      expect(getStatusStageForTool('cart_add_item')).toBe('updatingCart');
    });

    it('should return "updatingCart" for cart_set_item_quantity', () => {
      expect(getStatusStageForTool('cart_set_item_quantity')).toBe('updatingCart');
    });

    it('should return "updatingCart" for cart_remove_item', () => {
      expect(getStatusStageForTool('cart_remove_item')).toBe('updatingCart');
    });

    it('should return "thinking" for unknown tools', () => {
      expect(getStatusStageForTool('unknown_tool')).toBe('thinking');
    });
  });

  describe('getStatusStageForRound', () => {
    it('should return "thinking" for first round', () => {
      expect(getStatusStageForRound(1, true)).toBe('thinking');
    });

    it('should return "refining" after product_search', () => {
      expect(getStatusStageForRound(2, false, 'product_search')).toBe('refining');
    });

    it('should return "fetchingDetails" after product_get', () => {
      expect(getStatusStageForRound(2, false, 'product_get')).toBe('fetchingDetails');
    });

    it('should return "updatingCart" after cart tools', () => {
      expect(getStatusStageForRound(2, false, 'cart_add_item')).toBe('updatingCart');
      expect(getStatusStageForRound(2, false, 'cart_get')).toBe('updatingCart');
      expect(getStatusStageForRound(2, false, 'cart_set_item_quantity')).toBe('updatingCart');
      expect(getStatusStageForRound(2, false, 'cart_remove_item')).toBe('updatingCart');
    });

    it('should return "refining" for subsequent rounds without specific tool', () => {
      expect(getStatusStageForRound(3, false)).toBe('refining');
    });
  });

  describe('buildDevStatus', () => {
    it('should build dev status with round info', () => {
      const result = buildDevStatus(1);
      expect(result.message).toBe('Processing round 1...');
      expect(result.round).toBe(1);
    });

    it('should include additional info when provided', () => {
      const result = buildDevStatus(2, { toolCount: 3 });
      expect(result.message).toBe('Processing round 2...');
      expect(result.round).toBe(2);
      expect(result.toolCount).toBe(3);
    });

    it('should handle multiple rounds', () => {
      for (let round = 1; round <= 6; round++) {
        const result = buildDevStatus(round);
        expect(result.message).toBe(`Processing round ${round}...`);
        expect(result.round).toBe(round);
      }
    });
  });
});
