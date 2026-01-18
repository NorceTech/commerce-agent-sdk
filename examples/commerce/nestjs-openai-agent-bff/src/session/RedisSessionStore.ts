import { Redis } from 'ioredis';
import { ISessionStore } from './ISessionStore.js';
import { SessionState } from './sessionTypes.js';

export interface RedisSessionStoreOptions {
  redisUrl: string;
  prefix?: string;
  ttlSeconds: number;
}

export class RedisSessionStore implements ISessionStore {
  private readonly redis: Redis;
  private readonly prefix: string;
  private readonly ttlSeconds: number;

  constructor(options: RedisSessionStoreOptions) {
    this.redis = new Redis(options.redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 3) {
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    });
    this.prefix = options.prefix ?? 'agent:sess:';
    this.ttlSeconds = options.ttlSeconds;

    this.redis.on('error', (err: Error) => {
      console.error('[RedisSessionStore] Redis connection error:', err.message);
    });
  }

  private getFullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get(key: string): Promise<SessionState | null> {
    const fullKey = this.getFullKey(key);
    try {
      const raw = await this.redis.get(fullKey);
      if (!raw) {
        return null;
      }

      try {
        const session = JSON.parse(raw) as SessionState;
        if (Date.now() >= session.expiresAt) {
          await this.delete(key);
          return null;
        }
        return session;
      } catch (parseError) {
        console.error(
          `[RedisSessionStore] Failed to parse session for key ${fullKey}, deleting poisoned entry:`,
          parseError instanceof Error ? parseError.message : parseError
        );
        await this.redis.del(fullKey);
        return null;
      }
    } catch (error) {
      console.error(
        `[RedisSessionStore] Failed to get session for key ${fullKey}:`,
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }

  async set(key: string, state: SessionState): Promise<void> {
    const fullKey = this.getFullKey(key);
    try {
      const serialized = JSON.stringify(state);
      await this.redis.set(fullKey, serialized, 'EX', this.ttlSeconds);
    } catch (error) {
      console.error(
        `[RedisSessionStore] Failed to set session for key ${fullKey}:`,
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const fullKey = this.getFullKey(key);
    try {
      await this.redis.del(fullKey);
    } catch (error) {
      console.error(
        `[RedisSessionStore] Failed to delete session for key ${fullKey}:`,
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    try {
      const result = await this.redis.exists(fullKey);
      if (result === 0) {
        return false;
      }
      const session = await this.get(key);
      return session !== null;
    } catch (error) {
      console.error(
        `[RedisSessionStore] Failed to check existence for key ${fullKey}:`,
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }

  async touch(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    try {
      const session = await this.get(key);
      if (!session) {
        return false;
      }

      const now = Date.now();
      session.updatedAt = now;
      session.expiresAt = now + this.ttlSeconds * 1000;
      await this.set(key, session);
      return true;
    } catch (error) {
      console.error(
        `[RedisSessionStore] Failed to touch session for key ${fullKey}:`,
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (error) {
      console.error(
        '[RedisSessionStore] Failed to disconnect from Redis:',
        error instanceof Error ? error.message : error
      );
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
