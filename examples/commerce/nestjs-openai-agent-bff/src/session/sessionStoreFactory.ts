import { config } from '../config.js';
import { ISessionStore } from './ISessionStore.js';
import { InMemorySessionStore } from './InMemorySessionStore.js';
import { RedisSessionStore } from './RedisSessionStore.js';

let sessionStoreInstance: ISessionStore | null = null;

export interface SessionStoreFactoryResult {
  store: ISessionStore;
  type: 'memory' | 'redis';
}

export async function createSessionStore(): Promise<SessionStoreFactoryResult> {
  if (sessionStoreInstance) {
    return {
      store: sessionStoreInstance,
      type: config.session.store,
    };
  }

  const storeType = config.session.store;
  const ttlSeconds = config.session.ttlSeconds;

  if (storeType === 'redis') {
    const redisUrl = config.session.redis.url;
    if (!redisUrl) {
      throw new Error(
        'SESSION_STORE=redis requires REDIS_URL to be set. ' +
        'Example: REDIS_URL=redis://localhost:6379'
      );
    }

    const redisStore = new RedisSessionStore({
      redisUrl,
      prefix: config.session.redis.prefix,
      ttlSeconds,
    });

    const isConnected = await redisStore.ping();
    if (!isConnected) {
      throw new Error(
        `Failed to connect to Redis at ${redisUrl}. ` +
        'Ensure Redis is running and the URL is correct.'
      );
    }

    console.log(`[SessionStore] Using Redis session store (prefix: ${config.session.redis.prefix})`);
    sessionStoreInstance = redisStore;
    return {
      store: redisStore,
      type: 'redis',
    };
  }

  console.log('[SessionStore] Using in-memory session store');
  const memoryStore = new InMemorySessionStore({
    ttlSeconds,
  });
  sessionStoreInstance = memoryStore;
  return {
    store: memoryStore,
    type: 'memory',
  };
}

export function getSessionStore(): ISessionStore {
  if (!sessionStoreInstance) {
    throw new Error(
      'Session store not initialized. Call createSessionStore() first.'
    );
  }
  return sessionStoreInstance;
}

export async function destroySessionStore(): Promise<void> {
  if (!sessionStoreInstance) {
    return;
  }

  if (sessionStoreInstance instanceof RedisSessionStore) {
    await sessionStoreInstance.disconnect();
  } else if (sessionStoreInstance instanceof InMemorySessionStore) {
    sessionStoreInstance.destroy();
  }

  sessionStoreInstance = null;
}

export function resetSessionStoreForTesting(): void {
  sessionStoreInstance = null;
}
