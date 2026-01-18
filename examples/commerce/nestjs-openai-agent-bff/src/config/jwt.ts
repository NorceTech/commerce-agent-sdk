import { createHmac } from 'crypto';

export interface JwtPayload {
  iss: string;
  aud: string;
  sid: string;
  applicationId: string;
  iat: number;
  exp: number;
  scope: string[];
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(data: string): string {
  const padded = data + '='.repeat((4 - (data.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

export function signJwt(payload: JwtPayload, secret: string): string {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const signature = createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signatureInput}.${signature}`;
}

export interface VerifyResult {
  valid: boolean;
  payload?: JwtPayload;
  error?: string;
}

export function verifyJwt(token: string, secret: string): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid token format' };
  }

  const [encodedHeader, encodedPayload, providedSignature] = parts;
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  if (providedSignature !== expectedSignature) {
    return { valid: false, error: 'Invalid signature' };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as JwtPayload;
    
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, error: 'Token expired' };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: 'Invalid payload' };
  }
}
