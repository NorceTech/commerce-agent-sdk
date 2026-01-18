import type {
  RunRecord,
  RunRecordSummary,
  ListRunsOptions,
  RunStoreOptions,
} from './runTypes.js';
import { toRunRecordSummary } from './runTypes.js';

export class RunStore {
  private readonly maxRuns: number;
  private readonly ttlMs: number;
  private readonly buffer: RunRecord[] = [];
  private readonly index: Map<string, number> = new Map();

  constructor(options: RunStoreOptions) {
    this.maxRuns = options.maxRuns;
    this.ttlMs = options.ttlMs;
  }

  addRun(run: RunRecord): void {
    this.cleanup();

    if (this.buffer.length >= this.maxRuns) {
      const oldest = this.buffer.shift();
      if (oldest) {
        this.index.delete(oldest.runId);
      }
      this.rebuildIndex();
    }

    this.buffer.push(run);
    this.index.set(run.runId, this.buffer.length - 1);
  }

  listRuns(options: ListRunsOptions = {}): RunRecordSummary[] {
    this.cleanup();

    const { limit = 50, applicationId, sessionId } = options;

    let filtered = this.buffer;

    if (applicationId) {
      filtered = filtered.filter((r) => r.applicationId === applicationId);
    }

    if (sessionId) {
      filtered = filtered.filter((r) => r.sessionId === sessionId);
    }

    const sorted = [...filtered].sort((a, b) => b.createdAt - a.createdAt);

    const limited = sorted.slice(0, limit);

    return limited.map(toRunRecordSummary);
  }

  getRun(runId: string): RunRecord | null {
    this.cleanup();

    const idx = this.index.get(runId);
    if (idx === undefined) {
      return null;
    }

    const run = this.buffer[idx];
    if (!run || run.runId !== runId) {
      this.rebuildIndex();
      const newIdx = this.index.get(runId);
      if (newIdx === undefined) {
        return null;
      }
      return this.buffer[newIdx] ?? null;
    }

    return run;
  }

  cleanup(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const run = this.buffer[i];
      if (run && now - run.createdAt > this.ttlMs) {
        expiredIds.push(run.runId);
        this.buffer.splice(i, 1);
      }
    }

    if (expiredIds.length > 0) {
      this.rebuildIndex();
    }

    while (this.buffer.length > this.maxRuns) {
      const oldest = this.buffer.shift();
      if (oldest) {
        this.index.delete(oldest.runId);
      }
    }

    if (this.buffer.length > 0 && this.buffer.length <= this.maxRuns) {
      this.rebuildIndex();
    }
  }

  clear(): void {
    this.buffer.length = 0;
    this.index.clear();
  }

  get size(): number {
    return this.buffer.length;
  }

  private rebuildIndex(): void {
    this.index.clear();
    for (let i = 0; i < this.buffer.length; i++) {
      const run = this.buffer[i];
      if (run) {
        this.index.set(run.runId, i);
      }
    }
  }
}
