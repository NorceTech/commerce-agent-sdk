import { describe, it, expect } from 'vitest';
import { getClientIp, getClientIpWithFallback } from '../http/clientIp.js';
import type { IncomingMessage } from 'http';
import type { Socket } from 'net';

function createMockRequest(options: {
  xForwardedFor?: string | string[];
  xRealIp?: string | string[];
  remoteAddress?: string;
}): IncomingMessage {
  const headers: Record<string, string | string[] | undefined> = {};
  
  if (options.xForwardedFor !== undefined) {
    headers['x-forwarded-for'] = options.xForwardedFor;
  }
  if (options.xRealIp !== undefined) {
    headers['x-real-ip'] = options.xRealIp;
  }

  const socket = options.remoteAddress 
    ? { remoteAddress: options.remoteAddress } as Socket
    : undefined;

  return {
    headers,
    socket,
  } as IncomingMessage;
}

describe('getClientIp', () => {
  describe('X-Forwarded-For header', () => {
    it('should extract first IP from X-Forwarded-For list', () => {
      const req = createMockRequest({
        xForwardedFor: '1.1.1.1, 2.2.2.2, 3.3.3.3',
      });
      expect(getClientIp(req)).toBe('1.1.1.1');
    });

    it('should handle single IP in X-Forwarded-For', () => {
      const req = createMockRequest({
        xForwardedFor: '192.168.1.100',
      });
      expect(getClientIp(req)).toBe('192.168.1.100');
    });

    it('should trim whitespace from X-Forwarded-For IPs', () => {
      const req = createMockRequest({
        xForwardedFor: '  10.0.0.1  ,  10.0.0.2  ',
      });
      expect(getClientIp(req)).toBe('10.0.0.1');
    });

    it('should handle X-Forwarded-For as array', () => {
      const req = createMockRequest({
        xForwardedFor: ['203.0.113.50', '198.51.100.178'],
      });
      expect(getClientIp(req)).toBe('203.0.113.50');
    });
  });

  describe('X-Real-IP header', () => {
    it('should use X-Real-IP when X-Forwarded-For is not present', () => {
      const req = createMockRequest({
        xRealIp: '172.16.0.1',
      });
      expect(getClientIp(req)).toBe('172.16.0.1');
    });

    it('should prefer X-Forwarded-For over X-Real-IP', () => {
      const req = createMockRequest({
        xForwardedFor: '1.2.3.4',
        xRealIp: '5.6.7.8',
      });
      expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('should trim whitespace from X-Real-IP', () => {
      const req = createMockRequest({
        xRealIp: '  192.0.2.1  ',
      });
      expect(getClientIp(req)).toBe('192.0.2.1');
    });
  });

  describe('socket.remoteAddress fallback', () => {
    it('should use socket.remoteAddress when headers are not present', () => {
      const req = createMockRequest({
        remoteAddress: '127.0.0.1',
      });
      expect(getClientIp(req)).toBe('127.0.0.1');
    });

    it('should prefer headers over socket.remoteAddress', () => {
      const req = createMockRequest({
        xForwardedFor: '8.8.8.8',
        remoteAddress: '127.0.0.1',
      });
      expect(getClientIp(req)).toBe('8.8.8.8');
    });
  });

  describe('IPv6-mapped IPv4 normalization', () => {
    it('should normalize ::ffff:127.0.0.1 to 127.0.0.1', () => {
      const req = createMockRequest({
        remoteAddress: '::ffff:127.0.0.1',
      });
      expect(getClientIp(req)).toBe('127.0.0.1');
    });

    it('should normalize ::ffff: prefix case-insensitively', () => {
      const req = createMockRequest({
        xForwardedFor: '::FFFF:192.168.1.1',
      });
      expect(getClientIp(req)).toBe('192.168.1.1');
    });

    it('should not modify regular IPv4 addresses', () => {
      const req = createMockRequest({
        xForwardedFor: '10.0.0.1',
      });
      expect(getClientIp(req)).toBe('10.0.0.1');
    });

    it('should not modify regular IPv6 addresses', () => {
      const req = createMockRequest({
        xForwardedFor: '2001:db8::1',
      });
      expect(getClientIp(req)).toBe('2001:db8::1');
    });
  });

  describe('edge cases', () => {
    it('should return null when no IP can be determined', () => {
      const req = createMockRequest({});
      expect(getClientIp(req)).toBeNull();
    });

    it('should return null for empty X-Forwarded-For', () => {
      const req = createMockRequest({
        xForwardedFor: '',
      });
      expect(getClientIp(req)).toBeNull();
    });

    it('should return null for whitespace-only X-Forwarded-For', () => {
      const req = createMockRequest({
        xForwardedFor: '   ',
      });
      expect(getClientIp(req)).toBeNull();
    });

    it('should handle empty array for X-Forwarded-For', () => {
      const req = createMockRequest({
        xForwardedFor: [],
      });
      expect(getClientIp(req)).toBeNull();
    });
  });
});

describe('getClientIpWithFallback', () => {
  it('should return extracted IP when available', () => {
    const req = createMockRequest({
      xForwardedFor: '203.0.113.195',
    });
    expect(getClientIpWithFallback(req, false)).toBe('203.0.113.195');
  });

  it('should return 127.0.0.1 in development mode when IP cannot be determined', () => {
    const req = createMockRequest({});
    expect(getClientIpWithFallback(req, true)).toBe('127.0.0.1');
  });

  it('should return 127.0.0.1 in production mode when IP cannot be determined (last resort fallback)', () => {
    const req = createMockRequest({});
    expect(getClientIpWithFallback(req, false)).toBe('127.0.0.1');
  });

  it('should use socket.remoteAddress in production when headers are missing', () => {
    const req = createMockRequest({
      remoteAddress: '10.10.10.10',
    });
    expect(getClientIpWithFallback(req, false)).toBe('10.10.10.10');
  });
});
