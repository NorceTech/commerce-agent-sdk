/**
 * In-memory fixed-window rate limiter.
 * Designed for demo endpoints to prevent abuse during partner demos.
 * 
 * Features:
 * - Fixed window rate limiting (simpler than sliding window, deterministic)
 * - Automatic pruning of expired entries
 * - Key cap to prevent memory leaks (max 5k keys by default)
 * - No external dependencies (no Redis)
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

interface WindowEntry {
  count: number;
  windowStart: number;
}

export interface FixedWindowRateLimiterOptions {
  windowMs: number;
  limit: number;
  maxKeys?: number;
  pruneIntervalMs?: number;
}

const DEFAULT_MAX_KEYS = 5000;
const DEFAULT_PRUNE_INTERVAL_MS = 60_000; // 1 minute

export class FixedWindowRateLimiter {
  private readonly windowMs: number;
  private readonly limit: number;
  private readonly maxKeys: number;
  private readonly pruneIntervalMs: number;
  private readonly windows: Map<string, WindowEntry> = new Map();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private lastPruneTime: number = Date.now();

  constructor(options: FixedWindowRateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.limit = options.limit;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
    this.pruneIntervalMs = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;

    // Start periodic pruning
    this.startPruning();
  }

  /**
   * Record a hit for the given key and check if the request is allowed.
   * Returns the result with remaining quota and reset time.
   */
  hit(key: string): RateLimitResult {
    const now = Date.now();
    
    // Opportunistic prune if we're over the key limit
    if (this.windows.size >= this.maxKeys) {
      this.prune();
      
      // If still over limit after pruning, evict oldest entries
      if (this.windows.size >= this.maxKeys) {
        this.evictOldest(Math.ceil(this.maxKeys * 0.1)); // Evict 10%
      }
    }

    const entry = this.windows.get(key);
    const windowStart = this.getWindowStart(now);
    const resetAt = windowStart + this.windowMs;

    if (!entry || entry.windowStart !== windowStart) {
      // New window - reset count
      this.windows.set(key, { count: 1, windowStart });
      return {
        allowed: true,
        remaining: this.limit - 1,
        resetAt,
      };
    }

    // Same window - increment count
    entry.count++;

    if (entry.count > this.limit) {
      const retryAfterMs = resetAt - now;
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    return {
      allowed: true,
      remaining: this.limit - entry.count,
      resetAt,
    };
  }

  /**
   * Get the current count for a key without incrementing.
   * Useful for testing and debugging.
   */
  peek(key: string): { count: number; windowStart: number } | undefined {
    const entry = this.windows.get(key);
    if (!entry) {
      return undefined;
    }
    
    const now = Date.now();
    const currentWindowStart = this.getWindowStart(now);
    
    // Return undefined if the entry is from an old window
    if (entry.windowStart !== currentWindowStart) {
      return undefined;
    }
    
    return { count: entry.count, windowStart: entry.windowStart };
  }

  /**
   * Remove expired entries from the map.
   * Called periodically and opportunistically.
   */
  prune(): number {
    const now = Date.now();
    const currentWindowStart = this.getWindowStart(now);
    let pruned = 0;

    for (const [key, entry] of this.windows) {
      // Remove entries from previous windows
      if (entry.windowStart < currentWindowStart) {
        this.windows.delete(key);
        pruned++;
      }
    }

    this.lastPruneTime = now;
    return pruned;
  }

  /**
   * Evict the oldest entries when we're over the key limit.
   * This is a safety mechanism to prevent unbounded memory growth.
   */
  private evictOldest(count: number): void {
    // Sort entries by windowStart (oldest first)
    const entries = Array.from(this.windows.entries())
      .sort((a, b) => a[1].windowStart - b[1].windowStart);

    for (let i = 0; i < Math.min(count, entries.length); i++) {
      this.windows.delete(entries[i][0]);
    }
  }

  /**
   * Get the start of the current window.
   */
  private getWindowStart(now: number): number {
    return Math.floor(now / this.windowMs) * this.windowMs;
  }

  /**
   * Start periodic pruning.
   */
  private startPruning(): void {
    if (this.pruneTimer) {
      return;
    }

    this.pruneTimer = setInterval(() => {
      this.prune();
    }, this.pruneIntervalMs);

    // Don't prevent Node.js from exiting
    if (this.pruneTimer.unref) {
      this.pruneTimer.unref();
    }
  }

  /**
   * Stop periodic pruning and clear all entries.
   * Call this when shutting down to clean up resources.
   */
  destroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.windows.clear();
  }

  /**
   * Get the current number of tracked keys.
   * Useful for monitoring and testing.
   */
  get size(): number {
    return this.windows.size;
  }

  /**
   * Reset all rate limit state.
   * Useful for testing.
   */
  reset(): void {
    this.windows.clear();
  }
}
