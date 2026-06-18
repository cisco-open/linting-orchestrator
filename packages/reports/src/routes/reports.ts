/**
 * Report notification routes.
 * Handles incoming job notifications from the linting orchestrator.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseAdapter } from '../database.js';
import type { JobNotification, ApiSuccessResponse, ApiErrorResponse } from '../types.js';

export async function registerReportRoutes(
  app: FastifyInstance,
  database: DatabaseAdapter,
  authenticateApiKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
): Promise<void> {
  /**
   * POST /reports/jobs
   * Receive job completion notification from the linting orchestrator.
   */
  app.post<{
    Body: JobNotification;
    Reply: ApiSuccessResponse | ApiErrorResponse;
  }>(
    '/reports/jobs',
    {
      preHandler: [authenticateApiKey],
      bodyLimit: 10 * 1024 * 1024, // 10 MB — large lint reports can exceed Fastify's 1 MiB default
    },
    async (request, reply) => {
      try {
        const notification = request.body;

        // Validate required fields
        if (!notification.jobId || !notification.documentId) {
          return reply.code(400).send({
            success: false,
            error: 'Missing required fields: jobId, documentId',
            code: 'INVALID_REQUEST',
          });
        }

        // Store job in database
        database.storeJob(notification);

        request.log.info({ jobId: notification.jobId }, 'Job notification stored');

        return reply.code(200).send({
          success: true,
          jobId: notification.jobId,
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to store job notification');
        return reply.code(500).send({
          success: false,
          error: 'Failed to store job notification',
          code: 'STORAGE_ERROR',
        });
      }
    }
  );
}
