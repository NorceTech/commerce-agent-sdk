import { signJwt, verifyJwt, JwtPayload, VerifyResult } from '../config/jwt.js';
import { simpleAuthConfig } from '../config/simpleAuthConfig.js';

export interface SimpleJwtClaims {
  sid: string;
  applicationId: string;
  scope: string[];
  iat: number;
  exp: number;
}

export interface SimpleJwtVerifyResult {
  valid: boolean;
  claims?: SimpleJwtClaims;
  error?: string;
}

export function signSimpleJwt(payload: JwtPayload): string {
  return signJwt(payload, simpleAuthConfig.jwtSecret);
}

export function verifySimpleJwt(token: string): SimpleJwtVerifyResult {
  const result: VerifyResult = verifyJwt(token, simpleAuthConfig.jwtSecret);

  if (!result.valid || !result.payload) {
    return {
      valid: false,
      error: result.error ?? 'Invalid token',
    };
  }

  const payload = result.payload;

  if (payload.iss !== simpleAuthConfig.issuer) {
    return {
      valid: false,
      error: 'Invalid issuer',
    };
  }

  if (payload.aud !== simpleAuthConfig.audience) {
    return {
      valid: false,
      error: 'Invalid audience',
    };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    return {
      valid: false,
      error: 'Token expired',
    };
  }

  return {
    valid: true,
    claims: {
      sid: payload.sid,
      applicationId: payload.applicationId,
      scope: payload.scope,
      iat: payload.iat,
      exp: payload.exp,
    },
  };
}
