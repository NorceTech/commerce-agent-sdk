import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { SessionState } from '../session/sessionTypes.js';
import RedisMock from 'ioredis-mock';

vi.mock('ioredis', () => ({
  Redis: RedisMock,
}));

import { RedisSessionStore } from '../session/RedisSessionStore.js';

function createSessionState(overrides: Partial<SessionState> = {}): SessionState {
  const now = Date.now();
  return {
    conversation: [],
    mcp: { nextRpcId: 1 },
    updatedAt: now,
    expiresAt: now + 3600000,
    ...overrides,
  };
}

describe('RedisSessionStore', () => {
  let store: RedisSessionStore;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (store) {
      await store.disconnect();
    }
  });

  it('should store and retrieve session data (set/get)', async () => {
    store = new RedisSessionStore({
      redisUrl: 'redis://localhost:6379',
      prefix: 'test:sess:',
      ttlSeconds: 3600,
    });

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
    store = new RedisSessionStore({
      redisUrl: 'redis://localhost:6379',
      prefix: 'test:sess:',
      ttlSeconds: 3600,
    });

    const retrieved = await store.get('non-existent');
    expect(retrieved).toBeNull();
  });

  it('should check if session exists', async () => {
    store = new RedisSessionStore({
      redisUrl: 'redis://localhost:6379',
      prefix: 'test:sess:',
      ttlSeconds: 3600,
    });

    const key = 'applicationId:session-456';

    expect(await store.exists(key)).toBe(false);

    await store.set(key, createSessionState());

    expect(await store.exists(key)).toBe(true);
  });

  it('should delete session', async () => {
    store = new RedisSessionStore({
      redisUrl: 'redis://localhost:6379',
      prefix: 'test:sess:',
      ttlSeconds: 3600,
    });

    const key = 'applicationId:session-789';

    await store.set(key, createSessionState());
    expect(await store.exists(key)).toBe(true);

    await store.delete(key);
    expect(await store.exists(key)).toBe(false);
  });

  it('should use the configured prefix for keys', async () => {
    store = new RedisSessionStore({
      redisUrl: 'redis://localhost:6379',
      prefix: 'custom:prefix:',
      ttlSeconds: 3600,
    });

    const key = 'app:sess-001';
    const state = createSessionState();

    await store.set(key, state);
    const retrieved = await store.get(key);

    expect(retrieved).toEqual(state);
  });

  it('should use default prefix when not specified', async () => {
    store = new RedisSessionStore({
      redisUrl: 'redis://localhost:6379',
      ttlSeconds: 3600,
    });

    const key = 'app:sess-002';
    const state = createSessionState();

    await store.set(key, state);
    const retrieved = await store.get(key);

    expect(retrieved).toEqual(state);
  });

  it('should return null for expired session based on expiresAt', async () => {
    store = new RedisSessionStore({
      redisUrl: 'redis://localhost:6379',
      prefix: 'test:sess:',
      ttlSeconds: 3600,
    });

    const key = 'applicationId:expired-session';
    const now = Date.now();
    const state = createSessionState({
      updatedAt: now - 2000,
      expiresAt: now - 1000,
    });

    await store.set(key, state);

    const retrieved = await store.get(key);
    expect(retrieved).toBeNull();
  });

  it('should extend TTL when touch is called', async () => {
    store = new RedisSessionStore({
      redisUrl: 'redis://localhost:6379',
      prefix: 'test:sess:',
      ttlSeconds: 3600,
    });

    const key = 'applicationId:touch-session';
    const now = Date.now();
    const state = createSessionState({
      updatedAt: now,
      expiresAt: now + 3600000,
    });

    await store.set(key, state);

    const touched = await store.touch(key);
    expect(touched).toBe(true);

    const retrieved = await store.get(key);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.updatedAt).toBeGreaterThanOrEqual(now);
  });

  it('should return false when touching non-existent session', async () => {
    store = new RedisSessionStore({
      redisUrl: 'redis://localhost:6379',
      prefix: 'test:sess:',
      ttlSeconds: 3600,
    });

    const touched = await store.touch('non-existent');
    expect(touched).toBe(false);
  });

  it('should handle JSON parse errors gracefully', async () => {
    store = new RedisSessionStore({
      redisUrl: 'redis://localhost:6379',
      prefix: 'test:sess:',
      ttlSeconds: 3600,
    });

    const key = 'applicationId:invalid-json';
    const state = createSessionState();
    await store.set(key, state);

    const retrieved = await store.get(key);
    expect(retrieved).toEqual(state);
  });

  it('should ping successfully when connected', async () => {
    store = new RedisSessionStore({
      redisUrl: 'redis://localhost:6379',
      prefix: 'test:sess:',
      ttlSeconds: 3600,
    });

    const result = await store.ping();
    expect(result).toBe(true);
  });
});
