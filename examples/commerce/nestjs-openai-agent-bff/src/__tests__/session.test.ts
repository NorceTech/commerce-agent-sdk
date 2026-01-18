import { describe, it, expect, afterEach, vi } from 'vitest';
import { InMemorySessionStore } from '../session/InMemorySessionStore.js';
import { SessionState } from '../session/sessionTypes.js';

function createSessionState(overrides: Partial<SessionState> = {}): SessionState {
  const now = Date.now();
  return {
    conversation: [],
    mcp: { nextRpcId: 1 },
    updatedAt: now,
    expiresAt: now + 1800000,
    ...overrides,
  };
}

describe('InMemorySessionStore', () => {
  let store: InMemorySessionStore;

  afterEach(() => {
    store?.destroy();
  });

  it('should store and retrieve session data (set/get)', async () => {
    store = new InMemorySessionStore({ ttlSeconds: 1800 });
    const key = 'applicationId:session-123';
    const state = createSessionState({
      conversation: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
    });

    await store.set(key, state);
    const retrieved = await store.get(key);

    expect(retrieved).toEqual(state);
  });

  it('should return null for non-existent session', async () => {
    store = new InMemorySessionStore({ ttlSeconds: 1800 });
    const retrieved = await store.get('non-existent');

    expect(retrieved).toBeNull();
  });

  it('should check if session exists', async () => {
    store = new InMemorySessionStore({ ttlSeconds: 1800 });
    const key = 'applicationId:session-456';

    expect(await store.exists(key)).toBe(false);

    await store.set(key, createSessionState());

    expect(await store.exists(key)).toBe(true);
  });

  it('should delete session', async () => {
    store = new InMemorySessionStore({ ttlSeconds: 1800 });
    const key = 'applicationId:session-789';

    await store.set(key, createSessionState());
    expect(await store.exists(key)).toBe(true);

    await store.delete(key);
    expect(await store.exists(key)).toBe(false);
  });

  it('should remove session after TTL expiry', async () => {
    vi.useFakeTimers();
    try {
      store = new InMemorySessionStore({ ttlSeconds: 1, cleanupIntervalSeconds: 60 });
      const key = 'applicationId:expiring-session';
      const now = Date.now();
      const state = createSessionState({
        updatedAt: now,
        expiresAt: now + 1000,
      });

      await store.set(key, state);
      expect(await store.get(key)).toEqual(state);

      vi.advanceTimersByTime(1001);

      expect(await store.get(key)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should extend TTL when touch is called', async () => {
    vi.useFakeTimers();
    try {
      store = new InMemorySessionStore({ ttlSeconds: 2, cleanupIntervalSeconds: 60 });
      const key = 'applicationId:touch-session';
      const now = Date.now();
      const state = createSessionState({
        updatedAt: now,
        expiresAt: now + 2000,
      });

      await store.set(key, state);

      vi.advanceTimersByTime(1500);

      const touched = await store.touch(key);
      expect(touched).toBe(true);

      vi.advanceTimersByTime(1500);

      const retrieved = await store.get(key);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.updatedAt).toBeGreaterThan(now);
      expect(retrieved!.expiresAt).toBeGreaterThan(now + 2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should return false when touching non-existent session', async () => {
    store = new InMemorySessionStore({ ttlSeconds: 1800 });
    const touched = await store.touch('non-existent');
    expect(touched).toBe(false);
  });

  it('should return false when touching expired session', async () => {
    vi.useFakeTimers();
    try {
      store = new InMemorySessionStore({ ttlSeconds: 1, cleanupIntervalSeconds: 60 });
      const key = 'applicationId:expired-touch';
      const now = Date.now();
      const state = createSessionState({
        updatedAt: now,
        expiresAt: now + 1000,
      });

      await store.set(key, state);

      vi.advanceTimersByTime(1001);

      const touched = await store.touch(key);
      expect(touched).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should cleanup expired sessions periodically', async () => {
    vi.useFakeTimers();
    try {
      store = new InMemorySessionStore({ ttlSeconds: 1, cleanupIntervalSeconds: 1 });
      const key = 'applicationId:cleanup-session';
      const now = Date.now();
      const state = createSessionState({
        updatedAt: now,
        expiresAt: now + 1000,
      });

      await store.set(key, state);

      vi.advanceTimersByTime(2000);

      expect(await store.exists(key)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
