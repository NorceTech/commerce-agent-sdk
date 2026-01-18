import { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { simpleAuthConfig } from '../config/simpleAuthConfig.js';
import { verifySimpleJwt, SimpleJwtClaims } from './simpleJwt.js';
import { AppError } from '../errors/index.js';
import { appErrorToEnvelope } from '../http/errorEnvelope.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: SimpleAuthContext;
  }
}

export interface SimpleAuthContext {
  sid: string;
  applicationId: string;
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }
  return parts[1];
}

export const simpleAuthMiddleware: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  if (!simpleAuthConfig.enabled) {
    return;
  }

  const authHeader = request.headers.authorization;
  const token = extractBearerToken(authHeader);

  if (!token) {
    const error = AppError.unauthorized('Authorization header with Bearer token is required');
    const envelope = appErrorToEnvelope(error, request.id, false);
    return reply.status(401).send({
      error: envelope,
    });
  }

  const result = verifySimpleJwt(token);

  if (!result.valid || !result.claims) {
    const error = AppError.unauthorized(result.error ?? 'Invalid token');
    const envelope = appErrorToEnvelope(error, request.id, false);
    return reply.status(401).send({
      error: envelope,
    });
  }

  const claims: SimpleJwtClaims = result.claims;

  request.auth = {
    sid: claims.sid,
    applicationId: claims.applicationId,
  };
};

export function isSimpleAuthEnabled(): boolean {
  return simpleAuthConfig.enabled;
}
