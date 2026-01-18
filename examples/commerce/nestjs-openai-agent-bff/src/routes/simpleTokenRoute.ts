import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { simpleAuthConfig } from '../config/simpleAuthConfig.js';
import { config } from '../config.js';
import { signJwt, JwtPayload } from '../config/jwt.js';
import { AppError } from '../errors/index.js';
import { tokenRateLimitMiddleware } from '../policy/index.js';

const simpleTokenRequestSchema = z.object({
  applicationId: z.string().min(1, 'applicationId is required'),
});

type SimpleTokenRequestBody = z.infer<typeof simpleTokenRequestSchema>;

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

export async function simpleTokenRoutes(
  fastify: FastifyInstance
) {
  fastify.post<{
    Body: SimpleTokenRequestBody;
  }>('/v1/auth/simple/token', {
    preHandler: tokenRateLimitMiddleware,
  }, async (request: FastifyRequest<{ Body: SimpleTokenRequestBody }>, reply: FastifyReply) => {
    try {
      const body = simpleTokenRequestSchema.parse(request.body);

      validateApplicationId(body.applicationId);

      const sid = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const exp = now + simpleAuthConfig.ttlSeconds;

      const payload: JwtPayload = {
        iss: simpleAuthConfig.issuer,
        aud: simpleAuthConfig.audience,
        sid,
        applicationId: body.applicationId,
        iat: now,
        exp,
        scope: ['chat'],
      };

      const token = signJwt(payload, simpleAuthConfig.jwtSecret);

      return reply.status(200).send({
        token,
        expiresInSeconds: simpleAuthConfig.ttlSeconds,
        sid,
      });
    } catch (error) {
      if (error instanceof AppError) {
        return reply.status(error.httpStatus).send({
          error: {
            category: error.category.toLowerCase(),
            code: error.code,
            message: error.safeMessage,
            requestId: request.id,
          },
        });
      }

      if (error instanceof z.ZodError) {
        const messages = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
        return reply.status(400).send({
          error: {
            category: 'validation',
            code: 'VALIDATION_REQUEST_INVALID',
            message: messages,
            requestId: request.id,
          },
        });
      }

      fastify.log.error({ msg: 'Simple auth token generation error', error });
      return reply.status(500).send({
        error: {
          category: 'internal',
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          requestId: request.id,
        },
      });
    }
  });
}
