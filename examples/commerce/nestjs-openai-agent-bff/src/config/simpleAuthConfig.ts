import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export const SIMPLE_AUTH_ISSUER = 'norce-agent-bff';
export const SIMPLE_AUTH_AUDIENCE = 'norce-agent-widget';

const MIN_SECRET_LENGTH = 32;
const DEFAULT_TTL_SECONDS = 600;

let deprecationWarningLogged = false;

function logDeprecationWarning(varName: string): void {
  if (!deprecationWarningLogged) {
    console.warn(
      `DEPRECATED: ${varName} env var is deprecated; use SIMPLE_AUTH_* instead (e.g., SIMPLE_AUTH_ENABLED, SIMPLE_AUTH_JWT_SECRET, SIMPLE_AUTH_JWT_TTL_SECONDS)`
    );
    deprecationWarningLogged = true;
  }
}

function getEnvWithFallback(newVar: string, oldVar: string): string | undefined {
  const newValue = process.env[newVar];
  if (newValue !== undefined) {
    return newValue;
  }
  const oldValue = process.env[oldVar];
  if (oldValue !== undefined) {
    logDeprecationWarning(oldVar);
    return oldValue;
  }
  return undefined;
}

function parseSimpleAuthConfig() {
  const enabledStr = getEnvWithFallback('SIMPLE_AUTH_ENABLED', 'DEMO_AUTH_ENABLED');
  const enabled = enabledStr === '1' || enabledStr === 'true';
  
  const jwtSecret = getEnvWithFallback('SIMPLE_AUTH_JWT_SECRET', 'DEMO_JWT_SECRET') ?? '';
  
  const ttlStr = getEnvWithFallback('SIMPLE_AUTH_JWT_TTL_SECONDS', 'DEMO_JWT_TTL_SECONDS');
  const ttlSeconds = parseInt(ttlStr ?? String(DEFAULT_TTL_SECONDS), 10);

  if (enabled && jwtSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SIMPLE_AUTH_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters when SIMPLE_AUTH_ENABLED=1`
    );
  }

  return {
    enabled,
    jwtSecret,
    ttlSeconds: isNaN(ttlSeconds) ? DEFAULT_TTL_SECONDS : ttlSeconds,
    issuer: SIMPLE_AUTH_ISSUER,
    audience: SIMPLE_AUTH_AUDIENCE,
  };
}

export const simpleAuthConfig = parseSimpleAuthConfig();

export type SimpleAuthConfig = typeof simpleAuthConfig;
