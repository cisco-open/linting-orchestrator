/**
 * Job API routes
 * Provides read-only access to stored job results
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseAdapter } from '../database.js';
import type { JobListQuery, JobListResponse, JobDetailsResponse, ApiErrorResponse } from '../types.js';

export async function registerJobRoutes(
  app: FastifyInstance,
  database: DatabaseAdapter
): Promise<void> {
  /**
   * GET /jobs
   * List jobs with optional filtering and pagination
   */
  app.get<{
    Querystring: JobListQuery;
    Reply: JobListResponse | ApiErrorResponse;
  }>('/jobs', async (request, reply) => {
    try {
      const query = request.query;

      // Parse numeric query params
      const parsedQuery: JobListQuery = {
        ...query,
        limit: query.limit ? parseInt(String(query.limit)) : 50,
        offset: query.offset ? parseInt(String(query.offset)) : 0,
      };

      const { jobs, total } = database.listJobs(parsedQuery);

      return reply.code(200).send({
        jobs,
        total,
        limit: parsedQuery.limit || 50,
        offset: parsedQuery.offset || 0,
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to list jobs');
      return reply.code(500).send({
        success: false,
        error: 'Failed to list jobs',
        code: 'QUERY_ERROR',
      });
    }
  });

  /**
   * GET /jobs/:id
   * Get job details by ID
   */
  app.get<{
    Params: { id: string };
    Reply: JobDetailsResponse | ApiErrorResponse;
  }>('/jobs/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const job = database.getJobById(id);

      if (!job) {
        return reply.code(404).send({
          success: false,
          error: 'Job not found',
          code: 'NOT_FOUND',
        });
      }

      return reply.code(200).send(job);
    } catch (error) {
      request.log.error({ error, jobId: request.params.id }, 'Failed to get job');
      return reply.code(500).send({
        success: false,
        error: 'Failed to get job',
        code: 'QUERY_ERROR',
      });
    }
  });
}
