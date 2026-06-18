/**
 * HTTP API Endpoint Tests
 * 
 * Tests for all 7 HTTP endpoints, validation, error responses, and status codes
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import path from 'path';
import { Orchestrator } from '../../src/orchestrator.js';
import { WorkerPoolManager } from '../../src/worker-pool.js';
import { RulesetLoader } from '../../src/ruleset-loader.js';
import { DocumentAccessor } from '../../src/document-accessor.js';
import { MemoryLintStorage } from '../../src/storage/memory-storage.js';
import type { LintJobRequest } from '../../src/types.js';

describe('HTTP API Endpoints', () => {
  let app: FastifyInstance;
  let orchestrator: Orchestrator;
  let mockWorkerPool: any;
  let mockStorage: MemoryLintStorage;
  let mockRulesetLoader: any;
  let mockDocumentAccessor: any;

  beforeAll(async () => {
    // Setup mocks
    mockWorkerPool = {
      executeTask: vi.fn().mockResolvedValue({
        taskId: 'task-1',
        success: true,
        issues: [],
        executionTime: 100,
        workerId: 'worker-1',
        cacheHit: false
      }),
      getStats: vi.fn().mockReturnValue({
        totalWorkers: 3,
        readyWorkers: 3,
        busyWorkers: 0,
        errorWorkers: 0,
        workersByRuleset: new Map([
          ['pubhub@1.1.0', 1],
          ['contract@1.0.0', 1]
        ]),
        totalTasksExecuted: 0,
        averageExecutionTime: 0
      }),
      shutdown: vi.fn().mockResolvedValue(undefined)
    };

    mockStorage = new MemoryLintStorage();
    await mockStorage.initialize({});

    mockRulesetLoader = {
      listRulesets: vi.fn().mockReturnValue([
        {
          name: 'pubhub',
          displayName: 'PubHub Readiness Analyzer',
          versions: ['1.0.0', '1.1.0'],
          defaultVersion: '1.1.0',
          ruleCount: 60,
          category: 'publishing',
          description: 'PubHub ruleset'
        },
        {
          name: 'contract',
          displayName: 'Contract Validation',
          versions: ['1.0.0'],
          defaultVersion: '1.0.0',
          ruleCount: 45,
          category: 'contract',
          description: 'Contract ruleset'
        }
      ]),
      getMetadata: vi.fn().mockReturnValue({
        name: 'pubhub',
        defaultVersion: '1.1.0',
        versions: ['1.0.0', '1.1.0']
      })
    };

    mockDocumentAccessor = {
      documentExists: vi.fn().mockResolvedValue(true),
      getDocumentPath: vi.fn().mockReturnValue('/path/to/doc.json')
    };

    // Create orchestrator
    orchestrator = new Orchestrator(
      mockWorkerPool as any,
      mockStorage,
      mockRulesetLoader as any,
      mockDocumentAccessor as any,
      {
        workerPool: {
          minWorkersPerRuleset: 1,
          maxWorkersPerRuleset: 2,
          totalMaxWorkers: 10,
          taskTimeout: 30000,
          maxRetries: 2,
          scaleUpThreshold: 10,
          scaleDownThreshold: 1,
          exponentialBackoff: {
            initialDelay: 100,
            maxDelay: 1000,
            multiplier: 2
          },
          documentCache: {
            enabled: true,
            maxDocumentsPerWorker: 1,
            maxCacheSizePerWorker: 52428800,
            evictAfterMinutes: 5
          }
        },
        maxConcurrentJobs: 100,
        enableCache: true
      }
    );

    await orchestrator.initialize();

    // Create Fastify app with endpoints
    app = Fastify({ logger: false });

    // Health endpoint
    app.get('/health', async () => {
      const stats = orchestrator.getStats();
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        stats
      };
    });

    // Submit lint job
    app.post<{ Body: LintJobRequest }>('/lint', async (request, reply) => {
      try {
        const jobRequest = request.body;

        if (!jobRequest.documentId || !jobRequest.rulesetName) {
          return reply.code(400).send({
            error: 'Missing required fields: documentId, rulesetName'
          });
        }

        const jobId = await orchestrator.submitJob(jobRequest);

        return reply.code(202).send({
          jobId,
          status: 'queued',
          message: 'Job submitted successfully'
        });
      } catch (error) {
        return reply.code(500).send({
          error: error instanceof Error ? error.message : 'Internal server error'
        });
      }
    });

    // Get job status
    app.get<{ Params: { jobId: string } }>('/lint/:jobId', async (request, reply) => {
      const { jobId } = request.params;

      try {
        const job = await orchestrator.getJobStatus(jobId);

        if (!job) {
          return reply.code(404).send({
            error: `Job not found: ${jobId}`
          });
        }

        return {
          jobId: job.jobId,
          documentId: job.documentId,
          rulesetName: job.rulesetName,
          rulesetVersion: job.rulesetVersion,
          status: job.status,
          progress: job.progress,
          startTime: job.startTime,
          endTime: job.endTime
        };
      } catch (error) {
        return reply.code(500).send({
          error: error instanceof Error ? error.message : 'Internal server error'
        });
      }
    });

    // Get job results
    app.get<{ Params: { jobId: string } }>('/lint/:jobId/results', async (request, reply) => {
      const { jobId } = request.params;

      try {
        const result = await orchestrator.getJobResult(jobId);

        if (!result) {
          return reply.code(404).send({
            error: `Job not found or not yet completed: ${jobId}`
          });
        }

        return result;
      } catch (error) {
        return reply.code(500).send({
          error: error instanceof Error ? error.message : 'Internal server error'
        });
      }
    });

    // Invalidate cache
    app.delete<{ Params: { documentId: string } }>('/cache/:documentId', async (request, reply) => {
      const { documentId } = request.params;

      try {
        await orchestrator.invalidateCache(documentId);

        return {
          message: `Cache invalidated for document: ${documentId}`
        };
      } catch (error) {
        return reply.code(500).send({
          error: error instanceof Error ? error.message : 'Internal server error'
        });
      }
    });

    // List rulesets
    app.get('/rulesets', async () => {
      try {
        const rulesets = mockRulesetLoader.listRulesets();
        return {
          rulesets: rulesets.map((metadata: any) => ({
            name: metadata.name,
            displayName: metadata.displayName,
            versions: metadata.versions,
            defaultVersion: metadata.defaultVersion,
            ruleCount: metadata.ruleCount,
            category: metadata.category,
            description: metadata.description
          }))
        };
      } catch (error) {
        throw error;
      }
    });

    // Stats endpoint
    app.get('/stats', async () => {
      return orchestrator.getStats();
    });
  });

  afterAll(async () => {
    await orchestrator.shutdown();
    await app.close();
  });

  describe('GET /health', () => {
    it('should return 200 with health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
      expect(body.stats).toBeDefined();
    });

    it('should include orchestrator stats', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      const body = JSON.parse(response.body);
      expect(body.stats.jobs).toBeDefined();
      expect(body.stats.workers).toBeDefined();
    });
  });

  describe('POST /lint', () => {
    it('should accept valid lint request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/lint',
        payload: {
          documentId: 'doc-1',
          rulesetName: 'pubhub'
        }
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.jobId).toBeDefined();
      expect(body.status).toBe('queued');
      expect(body.message).toContain('submitted successfully');
    });

    it('should return 400 for missing documentId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/lint',
        payload: {
          rulesetName: 'pubhub'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Missing required fields');
    });

    it('should return 400 for missing rulesetName', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/lint',
        payload: {
          documentId: 'doc-1'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Missing required fields');
    });

    it('should accept optional rulesetVersion', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/lint',
        payload: {
          documentId: 'doc-1',
          rulesetName: 'pubhub',
          rulesetVersion: '1.0.0'
        }
      });

      expect(response.statusCode).toBe(202);
    });

    it('should accept optional options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/lint',
        payload: {
          documentId: 'doc-1',
          rulesetName: 'pubhub',
          options: {
            forceRun: true,
            priority: 'high'
          }
        }
      });

      expect(response.statusCode).toBe(202);
    });

    it('should return 500 for non-existent document', async () => {
      mockDocumentAccessor.documentExists.mockResolvedValueOnce(false);

      const response = await app.inject({
        method: 'POST',
        url: '/lint',
        payload: {
          documentId: 'non-existent',
          rulesetName: 'pubhub'
        }
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Document not found');
    });
  });

  describe('GET /lint/:jobId', () => {
    it('should return job status for existing job', async () => {
      // Submit a job first
      const submitResponse = await app.inject({
        method: 'POST',
        url: '/lint',
        payload: {
          documentId: 'doc-1',
          rulesetName: 'pubhub'
        }
      });

      const { jobId } = JSON.parse(submitResponse.body);

      // Get status
      const response = await app.inject({
        method: 'GET',
        url: `/lint/${jobId}`
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jobId).toBe(jobId);
      expect(body.documentId).toBe('doc-1');
      expect(body.rulesetName).toBe('pubhub');
      expect(body.status).toBeDefined();
      expect(body.progress).toBeDefined();
    });

    it('should return 404 for non-existent job', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/lint/non-existent-job-id'
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Job not found');
    });

    it('should include progress information', async () => {
      const submitResponse = await app.inject({
        method: 'POST',
        url: '/lint',
        payload: {
          documentId: 'doc-1',
          rulesetName: 'pubhub'
        }
      });

      const { jobId } = JSON.parse(submitResponse.body);

      const response = await app.inject({
        method: 'GET',
        url: `/lint/${jobId}`
      });

      const body = JSON.parse(response.body);
      expect(body.progress.totalTasks).toBeDefined();
      expect(body.progress.completedTasks).toBeDefined();
      expect(body.progress.failedTasks).toBeDefined();
      expect(body.progress.runningTasks).toBeDefined();
      expect(body.progress.queuedTasks).toBeDefined();
    });
  });

  describe('GET /lint/:jobId/results', () => {
    it('should return results for completed job', async () => {
      const submitResponse = await app.inject({
        method: 'POST',
        url: '/lint',
        payload: {
          documentId: 'doc-1',
          rulesetName: 'pubhub'
        }
      });

      const { jobId } = JSON.parse(submitResponse.body);

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 200));

      const response = await app.inject({
        method: 'GET',
        url: `/lint/${jobId}/results`
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jobId).toBe(jobId);
      expect(body.summary).toBeDefined();
      expect(body.results).toBeDefined();
    });

    it('should return 404 for job not yet completed', async () => {
      // Mock slow execution
      const originalMock = mockWorkerPool.executeTask;
      mockWorkerPool.executeTask.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({
          taskId: 'task-1',
          success: true,
          issues: [],
          executionTime: 100,
          workerId: 'worker-1',
          cacheHit: false
        }), 5000))
      );

      const submitResponse = await app.inject({
        method: 'POST',
        url: '/lint',
        payload: {
          documentId: 'doc-slow',  // Different document to avoid cache
          rulesetName: 'pubhub',
          options: { forceRun: true }  // Force no cache
        }
      });

      const { jobId } = JSON.parse(submitResponse.body);

      // Check immediately
      const response = await app.inject({
        method: 'GET',
        url: `/lint/${jobId}/results`
      });

      expect(response.statusCode).toBe(404);

      // Restore mock
      mockWorkerPool.executeTask = originalMock;
    });

    it('should include summary in results', async () => {
      const submitResponse = await app.inject({
        method: 'POST',
        url: '/lint',
        payload: {
          documentId: 'doc-1',
          rulesetName: 'pubhub'
        }
      });

      const { jobId } = JSON.parse(submitResponse.body);
      await new Promise(resolve => setTimeout(resolve, 200));

      const response = await app.inject({
        method: 'GET',
        url: `/lint/${jobId}/results`
      });

      const body = JSON.parse(response.body);
      expect(body.summary.totalIssues).toBeDefined();
      expect(body.summary.errorCount).toBeDefined();
      expect(body.summary.warningCount).toBeDefined();
    });
  });

  describe('DELETE /cache/:documentId', () => {
    it('should invalidate cache for document', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/cache/doc-1'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Cache invalidated');
      expect(body.message).toContain('doc-1');
    });

    it('should work for any document ID', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/cache/any-doc-id'
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /rulesets', () => {
    it('should return list of rulesets', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/rulesets'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.rulesets).toBeDefined();
      expect(Array.isArray(body.rulesets)).toBe(true);
      expect(body.rulesets.length).toBeGreaterThan(0);
    });

    it('should include ruleset metadata', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/rulesets'
      });

      const body = JSON.parse(response.body);
      const ruleset = body.rulesets[0];
      expect(ruleset.name).toBeDefined();
      expect(ruleset.displayName).toBeDefined();
      expect(ruleset.versions).toBeDefined();
      expect(ruleset.defaultVersion).toBeDefined();
      expect(ruleset.ruleCount).toBeDefined();
      expect(ruleset.category).toBeDefined();
    });
  });

  describe('GET /stats', () => {
    it('should return orchestrator statistics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/stats'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jobs).toBeDefined();
      expect(body.jobs.total).toBeDefined();
      expect(body.jobs.queued).toBeDefined();
      expect(body.jobs.running).toBeDefined();
      expect(body.jobs.completed).toBeDefined();
      expect(body.jobs.failed).toBeDefined();
      expect(body.workers).toBeDefined();
    });

    it('should include worker pool stats', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/stats'
      });

      const body = JSON.parse(response.body);
      expect(body.workers.total).toBeDefined();
      expect(body.workers.active).toBeDefined();
      expect(body.workers.idle).toBeDefined();
    });

    it('should update stats as jobs are processed', async () => {
      const statsBefore = await app.inject({
        method: 'GET',
        url: '/stats'
      });

      const beforeBody = JSON.parse(statsBefore.body);
      const jobsCountBefore = beforeBody.jobs.total;

      // Submit a job
      await app.inject({
        method: 'POST',
        url: '/lint',
        payload: {
          documentId: 'doc-1',
          rulesetName: 'pubhub'
        }
      });

      const statsAfter = await app.inject({
        method: 'GET',
        url: '/stats'
      });

      const afterBody = JSON.parse(statsAfter.body);
      expect(afterBody.jobs.total).toBeGreaterThan(jobsCountBefore);
    });
  });
});
