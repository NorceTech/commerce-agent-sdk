import { ISessionStore } from './ISessionStore.js';
import { SessionState } from './sessionTypes.js';

export interface InMemorySessionStoreOptions {
  ttlSeconds: number;
  cleanupIntervalSeconds?: number;
}

export class InMemorySessionStore implements ISessionStore {
  private sessions: Map<string, SessionState>;
  private readonly ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: InMemorySessionStoreOptions) {
    this.sessions = new Map();
    this.ttlMs = options.ttlSeconds * 1000;

    const cleanupIntervalMs = (options.cleanupIntervalSeconds ?? 60) * 1000;
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  async get(key: string): Promise<SessionState | null> {
    const state = this.sessions.get(key);
    if (!state) {
      return null;
    }

    if (Date.now() >= state.expiresAt) {
      this.sessions.delete(key);
      return null;
    }

    return state;
  }

  async set(key: string, state: SessionState): Promise<void> {
    this.sessions.set(key, state);
  }

  async delete(key: string): Promise<void> {
    this.sessions.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const state = await this.get(key);
    return state !== null;
  }

  async touch(key: string): Promise<boolean> {
    const state = this.sessions.get(key);
    if (!state) {
      return false;
    }

    if (Date.now() >= state.expiresAt) {
      this.sessions.delete(key);
      return false;
    }

    const now = Date.now();
    state.updatedAt = now;
    state.expiresAt = now + this.ttlMs;
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, state] of this.sessions) {
      if (now >= state.expiresAt) {
        this.sessions.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }
}
