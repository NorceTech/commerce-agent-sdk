import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

describe('sessionStoreFactory', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.resetModules();
  });

  describe('createSessionStore', () => {
    it('should create memory store when SESSION_STORE is unset (defaults to memory)', async () => {
      vi.doMock('../config.js', () => ({
        config: {
          session: {
            store: 'memory',
            ttlSeconds: 3600,
            redis: {
              url: undefined,
              prefix: 'agent:sess:',
            },
          },
        },
      }));

      const { createSessionStore, resetSessionStoreForTesting } = await import('../session/sessionStoreFactory.js');
      resetSessionStoreForTesting();

      const result = await createSessionStore();

      expect(result.type).toBe('memory');
      expect(result.store).toBeDefined();
      expect(typeof result.store.get).toBe('function');
      expect(typeof result.store.set).toBe('function');
      expect(typeof result.store.delete).toBe('function');
    });

    it('should create memory store when SESSION_STORE=memory', async () => {
      vi.doMock('../config.js', () => ({
        config: {
          session: {
            store: 'memory',
            ttlSeconds: 1800,
            redis: {
              url: undefined,
              prefix: 'agent:sess:',
            },
          },
        },
      }));

      const { createSessionStore, resetSessionStoreForTesting } = await import('../session/sessionStoreFactory.js');
      resetSessionStoreForTesting();

      const result = await createSessionStore();

      expect(result.type).toBe('memory');
      expect(result.store).toBeDefined();
    });

    it('should throw error when SESSION_STORE=redis but REDIS_URL is missing', async () => {
      vi.doMock('../config.js', () => ({
        config: {
          session: {
            store: 'redis',
            ttlSeconds: 3600,
            redis: {
              url: undefined,
              prefix: 'agent:sess:',
            },
          },
        },
      }));

      const { createSessionStore, resetSessionStoreForTesting } = await import('../session/sessionStoreFactory.js');
      resetSessionStoreForTesting();

      await expect(createSessionStore()).rejects.toThrow(
        'SESSION_STORE=redis requires REDIS_URL to be set'
      );
    });

    it('should return singleton instance on subsequent calls', async () => {
      vi.doMock('../config.js', () => ({
        config: {
          session: {
            store: 'memory',
            ttlSeconds: 3600,
            redis: {
              url: undefined,
              prefix: 'agent:sess:',
            },
          },
        },
      }));

      const { createSessionStore, resetSessionStoreForTesting } = await import('../session/sessionStoreFactory.js');
      resetSessionStoreForTesting();

      const result1 = await createSessionStore();
      const result2 = await createSessionStore();

      expect(result1.store).toBe(result2.store);
    });
  });

  describe('getSessionStore', () => {
    it('should throw error if store not initialized', async () => {
      vi.doMock('../config.js', () => ({
        config: {
          session: {
            store: 'memory',
            ttlSeconds: 3600,
            redis: {
              url: undefined,
              prefix: 'agent:sess:',
            },
          },
        },
      }));

      const { getSessionStore, resetSessionStoreForTesting } = await import('../session/sessionStoreFactory.js');
      resetSessionStoreForTesting();

      expect(() => getSessionStore()).toThrow(
        'Session store not initialized'
      );
    });

    it('should return store after initialization', async () => {
      vi.doMock('../config.js', () => ({
        config: {
          session: {
            store: 'memory',
            ttlSeconds: 3600,
            redis: {
              url: undefined,
              prefix: 'agent:sess:',
            },
          },
        },
      }));

      const { createSessionStore, getSessionStore, resetSessionStoreForTesting } = await import('../session/sessionStoreFactory.js');
      resetSessionStoreForTesting();

      await createSessionStore();
      const store = getSessionStore();

      expect(store).toBeDefined();
      expect(typeof store.get).toBe('function');
    });
  });

  describe('destroySessionStore', () => {
    it('should do nothing if store not initialized', async () => {
      vi.doMock('../config.js', () => ({
        config: {
          session: {
            store: 'memory',
            ttlSeconds: 3600,
            redis: {
              url: undefined,
              prefix: 'agent:sess:',
            },
          },
        },
      }));

      const { destroySessionStore, resetSessionStoreForTesting } = await import('../session/sessionStoreFactory.js');
      resetSessionStoreForTesting();

      await expect(destroySessionStore()).resolves.toBeUndefined();
    });

    it('should destroy memory store', async () => {
      vi.doMock('../config.js', () => ({
        config: {
          session: {
            store: 'memory',
            ttlSeconds: 3600,
            redis: {
              url: undefined,
              prefix: 'agent:sess:',
            },
          },
        },
      }));

      const { createSessionStore, destroySessionStore, getSessionStore, resetSessionStoreForTesting } = await import('../session/sessionStoreFactory.js');
      resetSessionStoreForTesting();

      await createSessionStore();
      await destroySessionStore();

      expect(() => getSessionStore()).toThrow('Session store not initialized');
    });
  });
});
