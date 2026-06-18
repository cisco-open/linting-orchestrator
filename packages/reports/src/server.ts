/**
 * Fastify server setup
 * Configures and initializes the HTTP server
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'fs';
import type { ReportServiceConfig } from './types.js';
import type { DatabaseAdapter } from './database.js';
import { createAuthMiddleware } from './auth.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerWebRoutes } from './routes/web.js';

export async function createServer(
  config: ReportServiceConfig,
  database: DatabaseAdapter
): Promise<FastifyInstance> {
  // Create Fastify instance
  const app = Fastify({
    // Raise global body limit so the content-type parser doesn't reject
    // large payloads before the route-level bodyLimit kicks in.
    bodyLimit: 10 * 1024 * 1024, // 10 MiB — matches route-level limit
    logger: {
      level: config.logLevel,
      // Use pino-pretty for human-readable logs unless explicitly disabled
      transport:
        process.env.LOG_FORMAT !== 'json'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname',
                colorize: true,
                singleLine: true,
              },
            }
          : undefined,
    },
    disableRequestLogging: true, // Disable automatic request logging
  });

  // Create authentication middleware
  const authenticateApiKey = createAuthMiddleware(config.apiKey);

  // Helper: count .json files in a directory (returns 0 if missing)
  async function countJsonFiles(dir: string | undefined): Promise<number> {
    if (!dir) return 0;
    try {
      const files = await fs.readdir(dir);
      return files.filter(f => f.endsWith('.json')).length;
    } catch {
      return 0;
    }
  }

  // Health check endpoint (no auth required)
  app.get('/health', async (_request, reply) => {
    const dbHealthy = database.healthCheck();

    if (!dbHealthy) {
      return reply.code(503).send({
        status: 'error',
        timestamp: new Date().toISOString(),
        server: {
          version: process.env.npm_package_version || 'unknown',
          environment: config.environment || process.env.NODE_ENV || 'development',
          nodeVersion: process.version,
        },
        clientLibrary: {
          version: process.env.npm_package_clientVersion || '1.0.0',
          compatible: '^1.0.0',
        },
        database: {
          connected: false,
          type: config.database.type,
        },
      });
    }

    const timestamps = database.getJobTimestamps();
    const dbSize = database.getDatabaseSize();

    // Count pending and dead-letter notifications
    const pendingCount = await countJsonFiles(config.pendingDir);
    const deadLetterCount = await countJsonFiles(config.deadLetterDir);

    return reply.code(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      server: {
        version: process.env.npm_package_version || '0.2.2',
        environment: config.environment || process.env.NODE_ENV || 'development',
        uptime: process.uptime(),
        nodeVersion: process.version,
      },
      clientLibrary: {
        version: process.env.npm_package_clientVersion || '1.0.0',
        compatible: '^1.0.0',
      },
      database: {
        connected: true,
        type: config.database.type,
        path: database.getDatabasePath(),
        sizeBytes: dbSize,
        totalJobs: database.getTotalJobs(),
        oldestJob: timestamps.oldest,
        newestJob: timestamps.newest,
      },
      notificationQueue: {
        pending: pendingCount,
        deadLetter: deadLetterCount,
      },
      features: {
        authEnabled: !!config.apiKey,
      },
    });
  });

  // Register routes
  await registerReportRoutes(app, database, authenticateApiKey);
  await registerJobRoutes(app, database);
  await registerWebRoutes(app, database);

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, 'Unhandled error');
    reply.code(500).send({
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });

  // 404 handler
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({
      success: false,
      error: 'Not found',
      code: 'NOT_FOUND',
    });
  });

  return app;
}
