import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RunStore } from '../debug/RunStore.js';
import type { RunRecord } from '../debug/runTypes.js';

function createRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  const now = Date.now();
  return {
    runId: `run-${Math.random().toString(36).slice(2)}`,
    createdAt: now,
    durationMs: 100,
    route: 'POST /v1/chat',
    applicationId: 'test-app',
    sessionId: 'test-session',
    request: {
      message: 'test message',
      contextPresent: false,
    },
    result: {
      status: 'ok',
      httpStatus: 200,
      textSnippet: 'test response',
      responseShape: {
        hasCards: false,
        hasComparison: false,
        toolCalls: 0,
      },
    },
    toolTrace: [],
    openaiTrace: {
      rounds: 1,
      model: 'gpt-4o-mini',
    },
    ...overrides,
  };
}

describe('RunStore', () => {
  let store: RunStore;

  beforeEach(() => {
    store = new RunStore({ maxRuns: 5, ttlMs: 60000 });
  });

  describe('addRun and getRun', () => {
    it('should add and retrieve a run', () => {
      const run = createRunRecord({ runId: 'run-1' });
      store.addRun(run);

      const retrieved = store.getRun('run-1');
      expect(retrieved).toEqual(run);
    });

    it('should return null for non-existent run', () => {
      const retrieved = store.getRun('non-existent');
      expect(retrieved).toBeNull();
    });
  });

  describe('listRuns', () => {
    it('should list runs in reverse chronological order', () => {
      const now = Date.now();
      const run1 = createRunRecord({ runId: 'run-1', createdAt: now - 2000 });
      const run2 = createRunRecord({ runId: 'run-2', createdAt: now - 1000 });
      const run3 = createRunRecord({ runId: 'run-3', createdAt: now });

      store.addRun(run1);
      store.addRun(run2);
      store.addRun(run3);

      const summaries = store.listRuns();
      expect(summaries).toHaveLength(3);
      expect(summaries[0].runId).toBe('run-3');
      expect(summaries[1].runId).toBe('run-2');
      expect(summaries[2].runId).toBe('run-1');
    });

    it('should filter by applicationId', () => {
      const run1 = createRunRecord({ runId: 'run-1', applicationId: 'app-a' });
      const run2 = createRunRecord({ runId: 'run-2', applicationId: 'app-b' });
      const run3 = createRunRecord({ runId: 'run-3', applicationId: 'app-a' });

      store.addRun(run1);
      store.addRun(run2);
      store.addRun(run3);

      const summaries = store.listRuns({ applicationId: 'app-a' });
      expect(summaries).toHaveLength(2);
      expect(summaries.every((s) => s.applicationId === 'app-a')).toBe(true);
    });

    it('should filter by sessionId', () => {
      const run1 = createRunRecord({ runId: 'run-1', sessionId: 'session-a' });
      const run2 = createRunRecord({ runId: 'run-2', sessionId: 'session-b' });
      const run3 = createRunRecord({ runId: 'run-3', sessionId: 'session-a' });

      store.addRun(run1);
      store.addRun(run2);
      store.addRun(run3);

      const summaries = store.listRuns({ sessionId: 'session-a' });
      expect(summaries).toHaveLength(2);
      expect(summaries.every((s) => s.sessionId === 'session-a')).toBe(true);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 5; i++) {
        store.addRun(createRunRecord({ runId: `run-${i}` }));
      }

      const summaries = store.listRuns({ limit: 2 });
      expect(summaries).toHaveLength(2);
    });

    it('should return summary with correct fields', () => {
      const run = createRunRecord({
        runId: 'run-1',
        applicationId: 'my-app',
        sessionId: 'my-session',
        durationMs: 500,
        toolTrace: [
          { t: 0, tool: 'product_search', args: {}, outcome: 'ok' },
          { t: 100, tool: 'product_get', args: {}, outcome: 'ok' },
        ],
        result: {
          status: 'ok',
          textSnippet: 'Hello world',
          responseShape: { hasCards: true, hasComparison: false, toolCalls: 2 },
        },
      });
      store.addRun(run);

      const summaries = store.listRuns();
      expect(summaries[0]).toEqual({
        runId: 'run-1',
        createdAt: run.createdAt,
        applicationId: 'my-app',
        sessionId: 'my-session',
        status: 'ok',
        durationMs: 500,
        toolCalls: 2,
        textSnippet: 'Hello world',
      });
    });
  });

  describe('maxRuns enforcement', () => {
    it('should drop oldest run when maxRuns is exceeded', () => {
      const store = new RunStore({ maxRuns: 3, ttlMs: 60000 });
      const now = Date.now();

      store.addRun(createRunRecord({ runId: 'run-1', createdAt: now - 3000 }));
      store.addRun(createRunRecord({ runId: 'run-2', createdAt: now - 2000 }));
      store.addRun(createRunRecord({ runId: 'run-3', createdAt: now - 1000 }));

      expect(store.size).toBe(3);
      expect(store.getRun('run-1')).not.toBeNull();

      store.addRun(createRunRecord({ runId: 'run-4', createdAt: now }));

      expect(store.size).toBe(3);
      expect(store.getRun('run-1')).toBeNull();
      expect(store.getRun('run-2')).not.toBeNull();
      expect(store.getRun('run-3')).not.toBeNull();
      expect(store.getRun('run-4')).not.toBeNull();
    });
  });

  describe('TTL cleanup', () => {
    it('should remove expired runs on cleanup', () => {
      vi.useFakeTimers();
      try {
        const store = new RunStore({ maxRuns: 10, ttlMs: 1000 });
        const now = Date.now();

        store.addRun(createRunRecord({ runId: 'run-1', createdAt: now }));
        store.addRun(createRunRecord({ runId: 'run-2', createdAt: now }));

        expect(store.size).toBe(2);

        vi.advanceTimersByTime(1001);

        store.cleanup();

        expect(store.size).toBe(0);
        expect(store.getRun('run-1')).toBeNull();
        expect(store.getRun('run-2')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('should keep non-expired runs after cleanup', () => {
      vi.useFakeTimers();
      try {
        const store = new RunStore({ maxRuns: 10, ttlMs: 2000 });
        const now = Date.now();

        store.addRun(createRunRecord({ runId: 'run-1', createdAt: now }));

        vi.advanceTimersByTime(1000);

        store.addRun(createRunRecord({ runId: 'run-2', createdAt: Date.now() }));

        vi.advanceTimersByTime(1001);

        store.cleanup();

        expect(store.getRun('run-1')).toBeNull();
        expect(store.getRun('run-2')).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('clear', () => {
    it('should remove all runs', () => {
      store.addRun(createRunRecord({ runId: 'run-1' }));
      store.addRun(createRunRecord({ runId: 'run-2' }));

      expect(store.size).toBe(2);

      store.clear();

      expect(store.size).toBe(0);
      expect(store.getRun('run-1')).toBeNull();
      expect(store.getRun('run-2')).toBeNull();
    });
  });
});
