/**
 * Authentication middleware for Fastify
 * Implements Bearer token authentication for API key validation
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * API key authentication middleware
 * Validates Bearer token against configured API key
 */
export function createAuthMiddleware(apiKey: string) {
  return async function authenticateApiKey(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      return reply.code(401).send({
        success: false,
        error: 'Missing Authorization header',
        code: 'MISSING_AUTH',
      });
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer') {
      return reply.code(401).send({
        success: false,
        error: 'Invalid authentication scheme. Expected: Bearer',
        code: 'INVALID_SCHEME',
      });
    }

    if (!token) {
      return reply.code(401).send({
        success: false,
        error: 'Missing API key',
        code: 'MISSING_TOKEN',
      });
    }

    if (token !== apiKey) {
      return reply.code(401).send({
        success: false,
        error: 'Invalid API key',
        code: 'INVALID_TOKEN',
      });
    }

    // Authentication successful - continue to route handler
  };
}
