/**
 * Orchestrator Unit Tests
 * 
 * Tests for job lifecycle, cache logic, retry logic, and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Orchestrator } from '../../src/orchestrator.js';
import { WorkerPoolManager } from '../../src/worker-pool.js';
import { RulesetLoader } from '../../src/ruleset-loader.js';
import { MemoryLintStorage } from '../../src/storage/memory-storage.js';
import type { LintJobRequest, LintJobResult } from '../../src/types.js';

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;
  let mockWorkerPool: any;
  let mockStorage: MemoryLintStorage;
  let mockRulesetLoader: any;
  let mockDocumentStore: any;

  beforeEach(async () => {
    // Mock WorkerPoolManager
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
        workersByRuleset: new Map(),
        totalTasksExecuted: 0,
        averageExecutionTime: 0,
        pendingWaiters: 0
      }),
      shutdown: vi.fn().mockResolvedValue(undefined)
    };

    // Real storage
    mockStorage = new MemoryLintStorage();
    await mockStorage.initialize({});

    // Mock RulesetLoader
    mockRulesetLoader = {
      getMetadata: vi.fn().mockReturnValue({
        name: 'pubhub',
        defaultVersion: '1.1.0',
        versions: ['1.0.0', '1.1.0']
      })
    };

    // Mock DocumentStore
    mockDocumentStore = {
      documentExists: vi.fn().mockResolvedValue(true),
      getDocumentPath: vi.fn().mockResolvedValue('/path/to/doc.json')
    };

    // Create orchestrator
    orchestrator = new Orchestrator(
      mockWorkerPool as any,
      mockStorage,
      mockRulesetLoader as any,
      mockDocumentStore as any,
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
  });

  afterEach(async () => {
    await orchestrator.shutdown();
  });

  describe('Job Submission', () => {
    it('should submit a new job and return jobId', async () => {
      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub',
        rulesetVersion: '1.1.0'
      };

      const jobId = await orchestrator.submitJob(request);

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
      expect(jobId.length).toBeGreaterThan(0);
    });

    it('should throw error if document does not exist', async () => {
      mockDocumentStore.documentExists.mockResolvedValueOnce(false);

      const request: LintJobRequest = {
        documentId: 'non-existent',
        rulesetName: 'pubhub'
      };

      await expect(orchestrator.submitJob(request)).rejects.toThrow(
        'Document not found: non-existent'
      );
    });

    it('should use default version if not specified', async () => {
      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
        // No version specified
      };

      await orchestrator.submitJob(request);

      expect(mockRulesetLoader.getMetadata).toHaveBeenCalledWith('pubhub');
    });

    it('should execute job asynchronously', async () => {
      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
      };

      const jobId = await orchestrator.submitJob(request);

      // Job submitted but may not be complete yet
      const status = await orchestrator.getJobStatus(jobId);
      expect(status).toBeDefined();
      expect(['queued', 'running', 'completed']).toContain(status?.status);
    });
  });

  describe('Cache Logic', () => {
    it('should return cached result if available', async () => {
      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub',
        rulesetVersion: '1.1.0'
      };

      // Submit first job
      const jobId1 = await orchestrator.submitJob(request);
      
      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 200));

      // Submit same job again
      const jobId2 = await orchestrator.submitJob(request);

      // Should return same jobId (cached)
      expect(jobId2).toBe(jobId1);
    });

    it('should bypass cache when forceRun is true', async () => {
      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub',
        rulesetVersion: '1.1.0'
      };

      // Submit first job
      const jobId1 = await orchestrator.submitJob(request);
      
      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 200));

      // Submit with forceRun
      const jobId2 = await orchestrator.submitJob({
        ...request,
        options: { forceRun: true }
      });

      // Should create new job
      expect(jobId2).not.toBe(jobId1);
    });

    it('should invalidate cache for a document', async () => {
      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
      };

      // Submit and complete job
      const jobId1 = await orchestrator.submitJob(request);
      await new Promise(resolve => setTimeout(resolve, 200));

      // Invalidate cache
      await orchestrator.invalidateCache('doc-1');

      // Submit again - should create new job
      const jobId2 = await orchestrator.submitJob(request);
      expect(jobId2).not.toBe(jobId1);
    });
  });

  describe('Job Status Tracking', () => {
    it('should track job status through lifecycle', async () => {
      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
      };

      const jobId = await orchestrator.submitJob(request);

      // Check initial status (may already be completed if job runs quickly)
      const status1 = await orchestrator.getJobStatus(jobId);
      expect(status1?.status).toMatch(/queued|running|completed/);

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check final status
      const status2 = await orchestrator.getJobStatus(jobId);
      expect(status2?.status).toBe('completed');
    });

    it('should return null for non-existent job', async () => {
      const status = await orchestrator.getJobStatus('non-existent');
      expect(status).toBeNull();
    });

    it('should track progress correctly', async () => {
      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
      };

      const jobId = await orchestrator.submitJob(request);
      await new Promise(resolve => setTimeout(resolve, 200));

      const status = await orchestrator.getJobStatus(jobId);
      expect(status?.progress).toBeDefined();
      expect(status?.progress.totalTasks).toBe(1);
      expect(status?.progress.completedTasks + status?.progress.failedTasks).toBe(1);
    });
  });

  describe('Result Retrieval', () => {
    it('should return results after job completion', async () => {
      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
      };

      const jobId = await orchestrator.submitJob(request);
      await new Promise(resolve => setTimeout(resolve, 200));

      const result = await orchestrator.getJobResult(jobId);
      expect(result).toBeDefined();
      expect(result?.jobId).toBe(jobId);
      expect(result?.summary).toBeDefined();
      expect(result?.results).toBeDefined();
    });

    it('should return null if job not yet completed', async () => {
      // Mock slow execution
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

      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
      };

      const jobId = await orchestrator.submitJob(request);

      // Check immediately (should not be complete)
      const result = await orchestrator.getJobResult(jobId);
      expect(result).toBeNull();
    });

    it('should include execution summary in results', async () => {
      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
      };

      const jobId = await orchestrator.submitJob(request);
      await new Promise(resolve => setTimeout(resolve, 200));

      const result = await orchestrator.getJobResult(jobId);
      expect(result?.summary).toHaveProperty('totalIssues');
      expect(result?.summary).toHaveProperty('errorCount');
      expect(result?.summary).toHaveProperty('warningCount');
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed tasks with exponential backoff', async () => {
      let attempts = 0;
      mockWorkerPool.executeTask.mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          return Promise.reject(new Error('Task failed'));
        }
        return Promise.resolve({
          taskId: 'task-1',
          success: true,
          issues: [],
          executionTime: 100,
          workerId: 'worker-1',
          cacheHit: false
        });
      });

      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
      };

      const jobId = await orchestrator.submitJob(request);
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(attempts).toBeGreaterThan(1);
      
      const status = await orchestrator.getJobStatus(jobId);
      expect(status?.status).toBe('completed');
    });

    it('should fail job after max retries exceeded', async () => {
      mockWorkerPool.executeTask.mockRejectedValue(new Error('Task failed'));

      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
      };

      const jobId = await orchestrator.submitJob(request);
      await new Promise(resolve => setTimeout(resolve, 1000));

      const status = await orchestrator.getJobStatus(jobId);
      expect(['failed', 'completed_with_errors']).toContain(status?.status);
    });
  });

  describe('Error Handling', () => {
    it('should handle worker pool errors gracefully', async () => {
      mockWorkerPool.executeTask.mockRejectedValue(new Error('Worker crashed'));

      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
      };

      const jobId = await orchestrator.submitJob(request);
      await new Promise(resolve => setTimeout(resolve, 1000));

      const status = await orchestrator.getJobStatus(jobId);
      expect(status?.progress.failedTasks).toBe(1);
    });

    it('should continue on storage errors', async () => {
      const storageSpy = vi.spyOn(mockStorage, 'storeJob');
      storageSpy.mockRejectedValueOnce(new Error('Storage error'));

      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
      };

      // Should not throw
      const jobId = await orchestrator.submitJob(request);
      await new Promise(resolve => setTimeout(resolve, 200));

      const status = await orchestrator.getJobStatus(jobId);
      expect(status?.status).toBe('completed');
    });
  });

  describe('Statistics', () => {
    it('should return orchestrator statistics', () => {
      const stats = orchestrator.getStats();

      expect(stats).toHaveProperty('jobs');
      expect(stats.jobs).toHaveProperty('total');
      expect(stats.jobs).toHaveProperty('queued');
      expect(stats.jobs).toHaveProperty('running');
      expect(stats.jobs).toHaveProperty('completed');
      expect(stats.jobs).toHaveProperty('failed');
      expect(stats).toHaveProperty('workers');
    });

    it('should update statistics as jobs are processed', async () => {
      const stats1 = orchestrator.getStats();
      expect(stats1.jobs.total).toBe(0);

      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
      };

      await orchestrator.submitJob(request);
      const stats2 = orchestrator.getStats();
      expect(stats2.jobs.total).toBe(1);

      await new Promise(resolve => setTimeout(resolve, 200));
      const stats3 = orchestrator.getStats();
      expect(stats3.jobs.completed).toBe(1);
    });
  });

  describe('Shutdown', () => {
    it('should wait for running jobs to complete', async () => {
      mockWorkerPool.executeTask.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({
          taskId: 'task-1',
          success: true,
          issues: [],
          executionTime: 100,
          workerId: 'worker-1',
          cacheHit: false
        }), 100))
      );

      const request: LintJobRequest = {
        documentId: 'doc-1',
        rulesetName: 'pubhub'
      };

      await orchestrator.submitJob(request);

      const shutdownPromise = orchestrator.shutdown();
      await shutdownPromise;

      const stats = orchestrator.getStats();
      expect(stats.jobs.running).toBe(0);
    });
  });
});
