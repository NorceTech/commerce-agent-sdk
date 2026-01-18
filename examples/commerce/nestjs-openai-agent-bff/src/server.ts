import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { createSessionStore, destroySessionStore } from './session/sessionStoreFactory.js';
import { NorceTokenProvider } from './norce/NorceTokenProvider.js';
import { NorceMcpClient } from './norce/NorceMcpClient.js';
import { createTools } from './agent/tools.js';
import { AgentRunner } from './agent/agentRunner.js';
import { chatRoutes } from './routes/chat.js';
import { debugRoutes } from './routes/debugRoutes.js';
import { simpleTokenRoutes } from './routes/simpleTokenRoute.js';
import { RunStore } from './debug/index.js';
import { simpleAuthConfig } from './config/simpleAuthConfig.js';

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.debug ? 'debug' : 'info',
    },
    bodyLimit: config.limits.bodyLimitBytes,
  });

  // Register CORS with explicit configuration
  // This must be registered BEFORE routes to ensure preflight OPTIONS requests are handled
  await fastify.register(cors, {
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }
      // Check if origin is in the allowed list
      if (config.cors.origins.includes(origin)) {
        callback(null, true);
        return;
      }
      // Reject other origins
      callback(new Error('Not allowed by CORS'), false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
  });

  // Initialize session store (memory or redis based on config)
  const { store: sessionStore, type: sessionStoreType } = await createSessionStore();
  fastify.log.info(`Session store initialized: ${sessionStoreType}`);

  // Register shutdown hook for session store cleanup
  fastify.addHook('onClose', async () => {
    await destroySessionStore();
    fastify.log.info('Session store destroyed');
  });
  
  const tokenProvider = new NorceTokenProvider({
    clientId: config.norce.oauth.clientId,
    clientSecret: config.norce.oauth.clientSecret,
    tokenUrl: config.norce.oauth.tokenUrl,
    scope: config.norce.oauth.scope,
  });
  
  const mcpClient = new NorceMcpClient({
    baseUrl: config.norce.mcp.baseUrl,
  });

  const tools = createTools({ tokenProvider, mcpClient });
  
  const agentRunner = new AgentRunner({
    tools,
  });

  // Initialize RunStore for debug runs (only when enabled)
  const runStore = config.debugRuns.enabled
    ? new RunStore({
        maxRuns: config.debugRuns.maxRuns,
        ttlMs: config.debugRuns.ttlSeconds * 1000,
      })
    : undefined;

  // Register routes
  await fastify.register(chatRoutes, {
    sessionStore,
    agentRunner,
    runStore,
  });

  // Register debug routes only when enabled
  if (config.debugRuns.enabled && runStore) {
    await fastify.register(debugRoutes, {
      runStore,
      sessionStore,
      agentRunner,
    });
    fastify.log.info('Debug runs enabled - debug routes registered at /v1/debug/*');
  }

  // Register simple auth token route only when enabled
  if (simpleAuthConfig.enabled) {
    await fastify.register(simpleTokenRoutes);
    fastify.log.info('Simple Auth enabled - token route registered at POST /v1/auth/simple/token');
  }

  return fastify;
}

export async function startServer() {
  const fastify = await buildServer();

  try {
    await fastify.listen({
      port: config.port,
      host: '0.0.0.0',
    });
    fastify.log.info(`Server listening on port ${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
