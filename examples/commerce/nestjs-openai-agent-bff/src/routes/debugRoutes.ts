import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RunStore } from '../debug/index.js';
import { ISessionStore } from '../session/ISessionStore.js';
import { AgentRunner } from '../agent/agentRunner.js';
import { config } from '../config.js';
import {
  handleChat,
  createRunTracer,
  buildRunRecord,
  ChatHandlerDependencies,
} from './chatHandler.js';

export interface DebugRouteOptions {
  runStore: RunStore;
  sessionStore: ISessionStore;
  agentRunner: AgentRunner | null;
}

const listRunsQuerySchema = z.object({
  limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 50),
  applicationId: z.string().optional(),
  sessionId: z.string().optional(),
});

const replayBodySchema = z.object({
  message: z.string().optional(),
  context: z.object({
    cultureCode: z.string().optional(),
    currencyCode: z.string().optional(),
    priceListIds: z.array(z.number()).optional(),
    salesAreaId: z.number().optional(),
    customerId: z.number().optional(),
    companyId: z.number().optional(),
  }).optional(),
});

export async function debugRoutes(
  fastify: FastifyInstance,
  options: DebugRouteOptions
) {
  const { runStore, sessionStore, agentRunner } = options;

  const deps: ChatHandlerDependencies = {
    sessionStore,
    agentRunner,
    runStore,
  };

  fastify.get<{
    Querystring: { limit?: string; applicationId?: string; sessionId?: string };
  }>('/v1/debug/runs', async (request: FastifyRequest<{ Querystring: { limit?: string; applicationId?: string; sessionId?: string } }>, reply: FastifyReply) => {
    try {
      const query = listRunsQuerySchema.parse(request.query);
      
      const summaries = runStore.listRuns({
        limit: query.limit,
        applicationId: query.applicationId,
        sessionId: query.sessionId,
      });

      return reply.send({
        runs: summaries,
        total: summaries.length,
      });
    } catch (error) {
      fastify.log.error({ msg: 'Error listing debug runs', error });
      return reply.status(500).send({
        error: {
          category: 'INTERNAL',
          code: 'INTERNAL_ERROR',
          message: 'Failed to list debug runs',
        },
      });
    }
  });

  fastify.get<{
    Params: { runId: string };
  }>('/v1/debug/runs/:runId', async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
    try {
      const { runId } = request.params;
      
      const run = runStore.getRun(runId);
      
      if (!run) {
        return reply.status(404).send({
          error: {
            category: 'NOT_FOUND',
            code: 'RUN_NOT_FOUND',
            message: `Run with id '${runId}' not found`,
          },
        });
      }

      return reply.send(run);
    } catch (error) {
      fastify.log.error({ msg: 'Error getting debug run', error });
      return reply.status(500).send({
        error: {
          category: 'INTERNAL',
          code: 'INTERNAL_ERROR',
          message: 'Failed to get debug run',
        },
      });
    }
  });

  fastify.post<{
    Params: { runId: string };
    Body: { message?: string; context?: Record<string, unknown> };
  }>('/v1/debug/replay/:runId', async (request: FastifyRequest<{ Params: { runId: string }; Body: { message?: string; context?: Record<string, unknown> } }>, reply: FastifyReply) => {
    try {
      const { runId } = request.params;
      
      const originalRun = runStore.getRun(runId);
      
      if (!originalRun) {
        return reply.status(404).send({
          error: {
            category: 'NOT_FOUND',
            code: 'RUN_NOT_FOUND',
            message: `Run with id '${runId}' not found`,
          },
        });
      }

      const body = replayBodySchema.parse(request.body ?? {});

      const message = body.message ?? originalRun.request.message;
      const context = body.context ?? originalRun.request.contextSummary ?? {};

      const newRunId = crypto.randomUUID();
      const tracer = createRunTracer(newRunId);

      const result = await handleChat(
        {
          applicationId: originalRun.applicationId,
          sessionId: originalRun.sessionId,
          message,
          context,
          debugEnabled: true,
        },
        deps,
        tracer
      );

      const runRecord = buildRunRecord(
        tracer,
        {
          applicationId: originalRun.applicationId,
          sessionId: originalRun.sessionId,
          message,
          context,
          debugEnabled: true,
        },
        result,
        originalRun.route,
        config.openai.model,
        result.agentResult?.roundsUsed ?? 1
      );
      runStore.addRun(runRecord);

      return reply.send({
        originalRunId: runId,
        newRunId: newRunId,
        result: result.body,
      });
    } catch (error) {
      fastify.log.error({ msg: 'Error replaying debug run', error });
      return reply.status(500).send({
        error: {
          category: 'INTERNAL',
          code: 'INTERNAL_ERROR',
          message: 'Failed to replay debug run',
        },
      });
    }
  });
}
