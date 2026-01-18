import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { FixedWindowRateLimiter } from '../policy/rateLimiter.js';

describe('FixedWindowRateLimiter', () => {
  let limiter: FixedWindowRateLimiter;

  afterEach(() => {
    limiter?.destroy();
  });

  describe('basic rate limiting', () => {
    it('should allow requests up to the limit within a window', () => {
      limiter = new FixedWindowRateLimiter({
        windowMs: 60_000,
        limit: 5,
      });

      const key = 'test-key';

      for (let i = 0; i < 5; i++) {
        const result = limiter.hit(key);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4 - i);
      }
    });

    it('should block requests after limit is exceeded', () => {
      limiter = new FixedWindowRateLimiter({
        windowMs: 60_000,
        limit: 3,
      });

      const key = 'test-key';

      // Use up the limit
      for (let i = 0; i < 3; i++) {
        const result = limiter.hit(key);
        expect(result.allowed).toBe(true);
      }

      // Next request should be blocked
      const result = limiter.hit(key);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeDefined();
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should track different keys independently', () => {
      limiter = new FixedWindowRateLimiter({
        windowMs: 60_000,
        limit: 2,
      });

      // Use up limit for key1
      limiter.hit('key1');
      limiter.hit('key1');
      const result1 = limiter.hit('key1');
      expect(result1.allowed).toBe(false);

      // key2 should still have quota
      const result2 = limiter.hit('key2');
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(1);
    });
  });

  describe('window reset', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should reset count after window expires', () => {
      limiter = new FixedWindowRateLimiter({
        windowMs: 1000, // 1 second window
        limit: 2,
        pruneIntervalMs: 10_000, // Don't prune during test
      });

      const key = 'test-key';

      // Use up the limit
      limiter.hit(key);
      limiter.hit(key);
      const blocked = limiter.hit(key);
      expect(blocked.allowed).toBe(false);

      // Advance time past the window
      vi.advanceTimersByTime(1001);

      // Should be allowed again
      const result = limiter.hit(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('should return correct resetAt timestamp', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      limiter = new FixedWindowRateLimiter({
        windowMs: 60_000,
        limit: 5,
      });

      const result = limiter.hit('test-key');
      
      // resetAt should be at the end of the current window
      const windowStart = Math.floor(now / 60_000) * 60_000;
      const expectedResetAt = windowStart + 60_000;
      expect(result.resetAt).toBe(expectedResetAt);
    });
  });

  describe('pruning', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should prune expired entries', () => {
      limiter = new FixedWindowRateLimiter({
        windowMs: 1000,
        limit: 10,
        pruneIntervalMs: 100_000, // Manual prune
      });

      // Add some entries
      limiter.hit('key1');
      limiter.hit('key2');
      limiter.hit('key3');
      expect(limiter.size).toBe(3);

      // Advance time past the window
      vi.advanceTimersByTime(1001);

      // Prune should remove old entries
      const pruned = limiter.prune();
      expect(pruned).toBe(3);
      expect(limiter.size).toBe(0);
    });

    it('should not prune entries in current window', () => {
      limiter = new FixedWindowRateLimiter({
        windowMs: 60_000,
        limit: 10,
        pruneIntervalMs: 100_000,
      });

      limiter.hit('key1');
      limiter.hit('key2');
      expect(limiter.size).toBe(2);

      // Prune without advancing time
      const pruned = limiter.prune();
      expect(pruned).toBe(0);
      expect(limiter.size).toBe(2);
    });
  });

  describe('key cap enforcement', () => {
    it('should evict oldest entries when key cap is reached', () => {
      limiter = new FixedWindowRateLimiter({
        windowMs: 60_000,
        limit: 10,
        maxKeys: 5,
        pruneIntervalMs: 100_000,
      });

      // Add entries up to the cap
      for (let i = 0; i < 5; i++) {
        limiter.hit(`key${i}`);
      }
      expect(limiter.size).toBe(5);

      // Adding one more should trigger eviction
      limiter.hit('key5');
      
      // Size should be reduced (evicted 10% = 1 entry, then added 1)
      expect(limiter.size).toBeLessThanOrEqual(5);
    });

    it('should still allow requests after eviction', () => {
      limiter = new FixedWindowRateLimiter({
        windowMs: 60_000,
        limit: 10,
        maxKeys: 3,
        pruneIntervalMs: 100_000,
      });

      // Fill up the limiter
      limiter.hit('key1');
      limiter.hit('key2');
      limiter.hit('key3');

      // New key should still work
      const result = limiter.hit('key4');
      expect(result.allowed).toBe(true);
    });
  });

  describe('peek', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return current count without incrementing', () => {
      limiter = new FixedWindowRateLimiter({
        windowMs: 60_000,
        limit: 10,
      });

      limiter.hit('test-key');
      limiter.hit('test-key');

      const peeked = limiter.peek('test-key');
      expect(peeked?.count).toBe(2);

      // Peek again - count should not have changed
      const peekedAgain = limiter.peek('test-key');
      expect(peekedAgain?.count).toBe(2);
    });

    it('should return undefined for non-existent key', () => {
      limiter = new FixedWindowRateLimiter({
        windowMs: 60_000,
        limit: 10,
      });

      const peeked = limiter.peek('non-existent');
      expect(peeked).toBeUndefined();
    });

    it('should return undefined for expired window', () => {
      limiter = new FixedWindowRateLimiter({
        windowMs: 1000,
        limit: 10,
        pruneIntervalMs: 100_000,
      });

      limiter.hit('test-key');

      // Advance past window
      vi.advanceTimersByTime(1001);

      const peeked = limiter.peek('test-key');
      expect(peeked).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('should clear all entries', () => {
      limiter = new FixedWindowRateLimiter({
        windowMs: 60_000,
        limit: 10,
      });

      limiter.hit('key1');
      limiter.hit('key2');
      limiter.hit('key3');
      expect(limiter.size).toBe(3);

      limiter.reset();
      expect(limiter.size).toBe(0);
    });
  });

  describe('destroy', () => {
    it('should stop pruning timer and clear entries', () => {
      limiter = new FixedWindowRateLimiter({
        windowMs: 60_000,
        limit: 10,
      });

      limiter.hit('key1');
      expect(limiter.size).toBe(1);

      limiter.destroy();
      expect(limiter.size).toBe(0);
    });
  });
});
