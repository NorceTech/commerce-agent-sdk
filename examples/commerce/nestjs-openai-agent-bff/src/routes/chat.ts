import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ISessionStore } from '../session/ISessionStore.js';
import { AgentRunner, StreamingCallbacks } from '../agent/agentRunner.js';
import { config } from '../config.js';
import { AppError, mapError, sanitizeForLogging } from '../errors/index.js';
import { SseWriter, DevStatusEventData } from '../http/sse.js';
import { appErrorToEnvelope } from '../http/errorEnvelope.js';
import type { ChatResponse } from '../http/responseTypes.js';
import type { RunStore } from '../debug/index.js';
import {
  chatRequestSchema,
  ChatRequestBody,
  handleChat,
  createRunTracer,
  buildRunRecord,
  ChatHandlerDependencies,
} from './chatHandler.js';
import { getClientIpWithFallback } from '../http/clientIp.js';
import { simpleAuthMiddleware, isSimpleAuthEnabled } from '../auth/index.js';
import { chatRateLimitMiddleware } from '../policy/index.js';
import { resolveStatusLanguage, getLocalizedStageMessage } from '../i18n/statusI18n.js';
import { enforceMessageLimits } from '../validation/index.js';

function validateApplicationId(applicationId: string): void {
  const allowedIds = config.norce.mcp.allowedApplicationIds;
  if (allowedIds.length === 0) {
    return;
  }
  if (!allowedIds.includes(applicationId)) {
    throw AppError.forbidden(
      `applicationId '${applicationId}' is not in the allowed list`
    );
  }
}

interface ChatRouteQuery {
  debug?: string;
}

export interface ChatRouteOptions {
  sessionStore: ISessionStore;
  agentRunner: AgentRunner | null;
  runStore?: RunStore;
}

export async function chatRoutes(
  fastify: FastifyInstance,
  options: ChatRouteOptions
) {
  const deps: ChatHandlerDependencies = {
    sessionStore: options.sessionStore,
    agentRunner: options.agentRunner,
    runStore: options.runStore,
  };

  fastify.post<{
    Body: ChatRequestBody;
    Querystring: ChatRouteQuery;
  }>('/v1/chat', {
    preHandler: [simpleAuthMiddleware, chatRateLimitMiddleware],
  }, async (request: FastifyRequest<{ Body: ChatRequestBody; Querystring: ChatRouteQuery }>, reply: FastifyReply) => {
    const runId = crypto.randomUUID();
    const tracer = options.runStore ? createRunTracer(runId) : undefined;

    try {
      const body = chatRequestSchema.parse(request.body);
      const query = request.query as ChatRouteQuery;
      const debugEnabled = query.debug === '1' || config.debug;

      const applicationId = isSimpleAuthEnabled() && request.auth
        ? request.auth.applicationId
        : body.applicationId;

      validateApplicationId(applicationId);

      // Enforce message limits (estimated token cap) before any OpenAI call
      enforceMessageLimits(body.message, {
        maxChars: config.limits.maxMessageChars,
        maxTokensEst: config.limits.maxMessageTokensEst,
      });

      // Extract client IP from request for cart operations
      // clientIp is required for cart.addItem MCP calls
      const clientIp = getClientIpWithFallback(request.raw, config.debug);

      const result = await handleChat(
        {
          applicationId,
          sessionId: body.sessionId,
          message: body.message,
          context: { ...body.context, clientIp },
          debugEnabled,
        },
        deps,
        tracer
      );

      if (options.runStore && tracer) {
        const runRecord = buildRunRecord(
          tracer,
          {
            applicationId,
            sessionId: body.sessionId,
            message: body.message,
            context: body.context,
            debugEnabled,
          },
          result,
          'POST /v1/chat',
          config.openai.model,
          result.agentResult?.roundsUsed ?? 1
        );
        options.runStore.addRun(runRecord);
      }

      if (result.error) {
        // Return ChatResponse with error envelope for consistent frontend handling
        const errorEnvelope = appErrorToEnvelope(result.error, request.id, debugEnabled);
        const errorResponse: ChatResponse = {
          turnId: crypto.randomUUID(),
          sessionId: body.sessionId,
          text: result.error.safeMessage,
          error: errorEnvelope,
        };
        return reply.status(result.httpStatus).send(errorResponse);
      }

      return reply.status(result.httpStatus).send(result.body);
    } catch (error) {
      const appError = mapError(error);
      const requestId = request.id;
      const query = request.query as ChatRouteQuery;
      const debugEnabled = query.debug === '1' || config.debug;

      const logPayload: Record<string, unknown> = {
        msg: 'Request error',
        category: appError.category,
        code: appError.code,
        requestId,
        httpStatus: appError.httpStatus,
      };

      if (config.debug && appError.details) {
        logPayload.details = sanitizeForLogging(appError.details);
      }

      if (appError.category === 'VALIDATION') {
        fastify.log.warn(logPayload);
      } else {
        fastify.log.error(logPayload);
      }

      const turnId = crypto.randomUUID();
      const sessionId = (request.body as ChatRequestBody)?.sessionId ?? 'unknown';

      if (options.runStore && tracer) {
        const errorResult = {
          httpStatus: appError.httpStatus,
          body: {
            turnId,
            sessionId,
            text: appError.safeMessage,
          },
        };
        const runRecord = buildRunRecord(
          tracer,
          {
            applicationId: (request.body as ChatRequestBody)?.applicationId ?? 'unknown',
            sessionId,
            message: (request.body as ChatRequestBody)?.message ?? '',
            context: (request.body as ChatRequestBody)?.context ?? {},
          },
          errorResult,
          'POST /v1/chat',
          config.openai.model,
          0,
          [{ category: appError.category, message: appError.safeMessage, details: appError.details }]
        );
        options.runStore.addRun(runRecord);
      }

      // Return ChatResponse with error envelope for consistent frontend handling
      const errorEnvelope = appErrorToEnvelope(appError, requestId, debugEnabled);
      const errorResponse: ChatResponse = {
        turnId,
        sessionId,
        text: appError.safeMessage,
        error: errorEnvelope,
      };

      return reply.status(appError.httpStatus).send(errorResponse);
    }
  });

  fastify.get('/v1/health',async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  fastify.post<{
    Body: ChatRequestBody;
    Querystring: ChatRouteQuery;
  }>('/v1/chat/stream', {
    preHandler: [simpleAuthMiddleware, chatRateLimitMiddleware],
  }, async (request: FastifyRequest<{ Body: ChatRequestBody; Querystring: ChatRouteQuery }>, reply: FastifyReply) => {
    let sseInitialized = false;
    // Pass origin header to SSE writer for CORS headers (writeHead bypasses Fastify's CORS middleware)
    const origin = request.headers.origin;
    const sse = new SseWriter(reply, origin);
    const runId = crypto.randomUUID();
    const tracer = options.runStore ? createRunTracer(runId) : undefined;

    try {
      const body = chatRequestSchema.parse(request.body);
      const query = request.query as ChatRouteQuery;
      const debugEnabled = query.debug === '1' || config.debug;

      const applicationId = isSimpleAuthEnabled() && request.auth
        ? request.auth.applicationId
        : body.applicationId;

      validateApplicationId(applicationId);

      // Enforce message limits (estimated token cap) before any OpenAI call
      // Must be done before sse.init() to reject with 413 before starting SSE stream
      enforceMessageLimits(body.message, {
        maxChars: config.limits.maxMessageChars,
        maxTokensEst: config.limits.maxMessageTokensEst,
      });

      // Extract client IP from request for cart operations
      // clientIp is required for cart.addItem MCP calls
      const clientIp = getClientIpWithFallback(request.raw, config.debug);

      // Compute language once per request for localized status messages
      const statusLang = resolveStatusLanguage({ cultureCode: body.context?.cultureCode });

      sse.init();
      sseInitialized = true;
      sse.status(getLocalizedStageMessage(statusLang, 'start'));

      const callbacks: StreamingCallbacks = {
        onStatus: (message) => sse.status(message),
        onDevStatus: debugEnabled 
          ? (data) => sse.devStatus(data as DevStatusEventData)
          : undefined,
        onToolStart: (tool, displayName, args) => sse.toolStart(tool, displayName, args),
        onToolEnd: (tool, displayName, ok, resultSummary, error) => sse.toolEnd(tool, displayName, ok, resultSummary, error),
        onDelta: (text) => sse.delta(text),
      };

      const result = await handleChat(
        {
          applicationId,
          sessionId: body.sessionId,
          message: body.message,
          context: { ...body.context, clientIp },
          debugEnabled,
          callbacks,
          statusLang,
        },
        deps,
        tracer
      );

      if (options.runStore && tracer) {
        const runRecord = buildRunRecord(
          tracer,
          {
            applicationId,
            sessionId: body.sessionId,
            message: body.message,
            context: body.context,
            debugEnabled,
          },
          result,
          'POST /v1/chat/stream',
          config.openai.model,
          result.agentResult?.roundsUsed ?? 1
        );
        options.runStore.addRun(runRecord);
      }

      if (result.error) {
        // Emit error event with the error envelope
        const errorEnvelope = appErrorToEnvelope(result.error, request.id, debugEnabled);
        sse.error(errorEnvelope);
        
        // Emit final event with error envelope included in the response
        const errorResponse: ChatResponse = {
          turnId: crypto.randomUUID(),
          sessionId: body.sessionId,
          text: result.error.safeMessage,
          error: errorEnvelope,
        };
        sse.final(errorResponse);
        return;
      }

      sse.final(result.body);
    } catch (error) {
      const appError = mapError(error);
      const requestId = request.id;
      const query = request.query as ChatRouteQuery;
      const debugEnabled = query.debug === '1' || config.debug;

      const logPayload: Record<string, unknown> = {
        msg: 'Stream request error',
        category: appError.category,
        code: appError.code,
        requestId,
        httpStatus: appError.httpStatus,
      };

      if (config.debug && appError.details) {
        logPayload.details = sanitizeForLogging(appError.details);
      }

      if (appError.category === 'VALIDATION') {
        fastify.log.warn(logPayload);
      } else {
        fastify.log.error(logPayload);
      }

      const turnId = crypto.randomUUID();
      const sessionId = (request.body as ChatRequestBody)?.sessionId ?? 'unknown';

      if (options.runStore && tracer) {
        const errorResult = {
          httpStatus: appError.httpStatus,
          body: {
            turnId,
            sessionId,
            text: appError.safeMessage,
          },
        };
        const runRecord = buildRunRecord(
          tracer,
          {
            applicationId: (request.body as ChatRequestBody)?.applicationId ?? 'unknown',
            sessionId,
            message: (request.body as ChatRequestBody)?.message ?? '',
            context: (request.body as ChatRequestBody)?.context ?? {},
          },
          errorResult,
          'POST /v1/chat/stream',
          config.openai.model,
          0,
          [{ category: appError.category, message: appError.safeMessage, details: appError.details }]
        );
        options.runStore.addRun(runRecord);
      }

      if (sse.isTerminated()) {
        return;
      }

      // Create error envelope for consistent frontend handling
      const errorEnvelope = appErrorToEnvelope(appError, requestId, debugEnabled);

      if (!sseInitialized) {
        // If SSE not initialized, return ChatResponse with error envelope
        const errorResponse: ChatResponse = {
          turnId,
          sessionId,
          text: appError.safeMessage,
          error: errorEnvelope,
        };
        return reply.status(appError.httpStatus).send(errorResponse);
      }

      // Emit error event with the error envelope
      sse.error(errorEnvelope);
      
      // Emit final event with error envelope included in the response
      const errorResponse: ChatResponse = {
        turnId,
        sessionId,
        text: appError.safeMessage,
        error: errorEnvelope,
      };
      sse.final(errorResponse);
    }
  });
}
