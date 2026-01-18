import type { IncomingMessage } from 'http';

/**
 * Extracts the client IP address from an HTTP request.
 * 
 * Priority order:
 * 1. X-Forwarded-For header (first IP before comma, trimmed)
 * 2. X-Real-IP header
 * 3. req.socket.remoteAddress
 * 
 * IPv6-mapped IPv4 addresses (e.g., "::ffff:127.0.0.1") are normalized to IPv4.
 * 
 * @param req - The incoming HTTP request (Node.js IncomingMessage or Fastify request.raw)
 * @returns The client IP address, or null if it cannot be determined
 */
export function getClientIp(req: IncomingMessage): string | null {
  let ip: string | null = null;

  // 1. Check X-Forwarded-For header (first IP in the list)
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    const forwardedValue = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
    if (forwardedValue) {
      // Take the first IP before comma and trim whitespace
      const firstIp = forwardedValue.split(',')[0]?.trim();
      if (firstIp) {
        ip = firstIp;
      }
    }
  }

  // 2. Check X-Real-IP header
  if (!ip) {
    const xRealIp = req.headers['x-real-ip'];
    if (xRealIp) {
      const realIpValue = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;
      if (realIpValue?.trim()) {
        ip = realIpValue.trim();
      }
    }
  }

  // 3. Fall back to socket.remoteAddress
  if (!ip && req.socket?.remoteAddress) {
    ip = req.socket.remoteAddress;
  }

  // Normalize IPv6-mapped IPv4 addresses (e.g., "::ffff:127.0.0.1" -> "127.0.0.1")
  if (ip) {
    ip = normalizeIpv6MappedIpv4(ip);
  }

  return ip || null;
}

/**
 * Normalizes IPv6-mapped IPv4 addresses to plain IPv4.
 * E.g., "::ffff:127.0.0.1" -> "127.0.0.1"
 * 
 * @param ip - The IP address to normalize
 * @returns The normalized IP address
 */
function normalizeIpv6MappedIpv4(ip: string): string {
  const ipv6MappedPrefix = '::ffff:';
  if (ip.toLowerCase().startsWith(ipv6MappedPrefix)) {
    return ip.substring(ipv6MappedPrefix.length);
  }
  return ip;
}

/**
 * Gets the client IP with a fallback for development environments.
 * 
 * @param req - The incoming HTTP request
 * @param isDevelopment - Whether the app is running in development mode
 * @returns The client IP address, with "127.0.0.1" as fallback in development
 */
export function getClientIpWithFallback(req: IncomingMessage, isDevelopment: boolean = false): string {
  const ip = getClientIp(req);
  
  if (ip) {
    return ip;
  }
  
  // In development, fall back to localhost
  if (isDevelopment) {
    return '127.0.0.1';
  }
  
  // In production, use req.socket.remoteAddress or localhost as last resort
  // This ensures we always have a value rather than failing the request
  return req.socket?.remoteAddress || '127.0.0.1';
}
