/**
 * Unit Tests for Auth Module
 *
 * Tests authentication utilities and middleware.
 */

import { describe, it, expect, vi } from 'vitest';
import { createMockRequest, createMockResponse } from '../fixtures/mock-data.js';

// Import the auth module
import { authMiddleware, getClientIP } from '../../src/auth.js';

describe('Auth Module', () => {
  describe('getClientIP', () => {
    it('should extract IP from x-forwarded-for header', () => {
      const req = createMockRequest({
        headers: {
          'x-forwarded-for': '192.168.1.100, 10.0.0.1, 172.16.0.1',
        },
      });

      const ip = getClientIP(req);
      expect(ip).toBe('192.168.1.100');
    });

    it('should extract single IP from x-forwarded-for header', () => {
      const req = createMockRequest({
        headers: {
          'x-forwarded-for': '203.0.113.50',
        },
      });

      const ip = getClientIP(req);
      expect(ip).toBe('203.0.113.50');
    });

    it('should trim whitespace from x-forwarded-for IP', () => {
      const req = createMockRequest({
        headers: {
          'x-forwarded-for': '  192.168.1.100  , 10.0.0.1',
        },
      });

      const ip = getClientIP(req);
      expect(ip).toBe('192.168.1.100');
    });

    it('should fall back to socket.remoteAddress when no x-forwarded-for', () => {
      const req = createMockRequest({
        headers: {},
        socket: {
          remoteAddress: '10.0.0.5',
        },
      });

      const ip = getClientIP(req);
      expect(ip).toBe('10.0.0.5');
    });

    it('should fall back to req.ip when socket.remoteAddress is undefined', () => {
      const req = createMockRequest({
        headers: {},
        socket: {
          remoteAddress: undefined,
        },
        ip: '127.0.0.1',
      });

      const ip = getClientIP(req);
      expect(ip).toBe('127.0.0.1');
    });

    it('should handle IPv6 addresses', () => {
      const req = createMockRequest({
        headers: {
          'x-forwarded-for': '::1',
        },
      });

      const ip = getClientIP(req);
      expect(ip).toBe('::1');
    });

    it('should handle IPv6 mapped IPv4 addresses', () => {
      const req = createMockRequest({
        headers: {},
        socket: {
          remoteAddress: '::ffff:127.0.0.1',
        },
      });

      const ip = getClientIP(req);
      expect(ip).toBe('::ffff:127.0.0.1');
    });
  });

  describe('authMiddleware', () => {
    it('should set req.auth with local type and client IP', async () => {
      const req = createMockRequest({
        headers: {},
        socket: { remoteAddress: '192.168.1.50' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await authMiddleware(req, res, next);

      expect(req.auth).toBeDefined();
      expect(req.auth.type).toBe('local');
      expect(req.auth.ip).toBe('192.168.1.50');
      expect(next).toHaveBeenCalled();
    });

    it('should call next() to continue middleware chain', async () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should use x-forwarded-for IP when available', async () => {
      const req = createMockRequest({
        headers: {
          'x-forwarded-for': '203.0.113.100',
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await authMiddleware(req, res, next);

      expect(req.auth.ip).toBe('203.0.113.100');
    });
  });
});
