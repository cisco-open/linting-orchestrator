// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Request Validation and Error Handling Middleware
 * 
 * Provides validation schemas and error handling for HTTP endpoints
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

// ============================================
// Validation Schemas
// ============================================

export const lintJobRequestSchema = {
  type: 'object',
  required: ['documentId', 'rulesetName'],
  properties: {
    documentId: {
      type: 'string',
      minLength: 1,
      maxLength: 255,
      pattern: '^[a-zA-Z0-9-_]+$',
      description: 'Document identifier (UUID or alphanumeric)'
    },
    rulesetName: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      pattern: '^[a-z][a-z0-9-]*$',
      description: 'Ruleset name (lowercase, alphanumeric, hyphens)'
    },
    rulesetVersion: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
      description: 'Semantic version (e.g., 1.2.3)'
    },
    callbackUrl: {
      type: 'string',
      format: 'uri',
      description: 'URL to POST job results to on completion (optional)'
    },
    ruleOverrides: {
      type: 'object',
      description: 'Override rule severities or disable rules. Keys are rule IDs, values are severity levels.',
      additionalProperties: {
        type: 'string',
        enum: ['off', 'error', 'warn', 'info', 'hint']
      },
      maxProperties: 200
    },
    options: {
      type: 'object',
      properties: {
        forceRun: {
          type: 'boolean',
          description: 'Skip cache and force re-execution'
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high'],
          description: 'Job priority level'
        }
      }
    }
  }
};

export const jobIdParamSchema = {
  type: 'object',
  required: ['jobId'],
  properties: {
    jobId: {
      type: 'string',
      pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',
      description: 'Job UUID'
    }
  }
};

export const documentIdParamSchema = {
  type: 'object',
  required: ['documentId'],
  properties: {
    documentId: {
      type: 'string',
      minLength: 1,
      maxLength: 255,
      description: 'Document identifier'
    }
  }
};

// ============================================
// Error Responses
// ============================================

export interface ErrorResponse {
  error: string;
  message?: string;
  details?: any;
  timestamp: string;
  path?: string;
}

export function createErrorResponse(
  error: string,
  message?: string,
  details?: any
): ErrorResponse {
  return {
    error,
    message,
    details,
    timestamp: new Date().toISOString()
  };
}

// ============================================
// Error Handler
// ============================================

export function errorHandler(
  error: Error,
  _request: FastifyRequest,
  reply: FastifyReply
): void {
  // Validation errors
  if (error.name === 'ValidationError' || (error as any).validation) {
    reply.status(400).send(
      createErrorResponse(
        'Validation Error',
        error.message,
        (error as any).validation
      )
    );
    return;
  }

  // Not found errors
  if (error.message.includes('not found')) {
    reply.status(404).send(
      createErrorResponse('Not Found', error.message)
    );
    return;
  }

  // Document errors
  if (error.message.includes('Document')) {
    reply.status(404).send(
      createErrorResponse('Document Error', error.message)
    );
    return;
  }

  // Ruleset errors
  if (error.message.includes('Ruleset')) {
    reply.status(404).send(
      createErrorResponse('Ruleset Error', error.message)
    );
    return;
  }

  // Timeout errors
  if (error.message.includes('timeout') || error.message.includes('Timeout')) {
    reply.status(504).send(
      createErrorResponse('Gateway Timeout', error.message)
    );
    return;
  }

  // Service unavailable (worker pool issues)
  if (error.message.includes('worker') || error.message.includes('Worker')) {
    reply.status(503).send(
      createErrorResponse('Service Unavailable', error.message)
    );
    return;
  }

  // Generic server error
  console.error('Internal error:', error);
  reply.status(500).send(
    createErrorResponse(
      'Internal Server Error',
      process.env.NODE_ENV === 'production' 
        ? 'An unexpected error occurred' 
        : error.message
    )
  );
}

// ============================================
// Request Sanitization
// ============================================

export function sanitizeDocumentId(documentId: string): string {
  // Remove any potentially harmful characters
  return documentId.replace(/[^a-zA-Z0-9-_]/g, '');
}

export function sanitizeRulesetName(rulesetName: string): string {
  // Ensure lowercase, alphanumeric with hyphens only
  return rulesetName.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

export function sanitizeVersion(version: string): string {
  // Ensure valid semver format
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error('Invalid version format. Expected: X.Y.Z');
  }
  return version;
}
