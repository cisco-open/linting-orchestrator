import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server.js';
import { DatabaseAdapter } from '../../src/database.js';
import { ReportServiceClient } from '../../src/client/index.js';
import type { JobNotification } from '../../src/types.js';

/**
 * Helper to create a valid minimal JobNotification for tests
 */
function makeNotification(overrides: Partial<JobNotification> & { jobId: string; documentId: string }): JobNotification {
  return {
    status: 'completed',
    results: [],
    summary: {
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      hintCount: 0,
      totalIssues: 0,
      durationMs: 0,
    },
    metadata: { name: 'Test API' },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('ReportServiceClient Integration Tests', () => {
  const testDbPath = join(process.cwd(), 'test-integration.db');
  const testPendingDir = join(process.cwd(), 'test-integration-pending');
  const testDeadLetterDir = join(process.cwd(), 'test-integration-dead-letter');
  const apiKey = 'test-api-key-12345';
  const port = 3011; // Different from main service
  const url = `http://localhost:${port}`;

  let server: FastifyInstance;
  let database: DatabaseAdapter;
  let client: ReportServiceClient;

  beforeAll(async () => {
    // Clean up any previous test artifacts
    if (existsSync(testDbPath)) {
      rmSync(testDbPath, { force: true });
    }
    if (existsSync(testPendingDir)) {
      rmSync(testPendingDir, { recursive: true, force: true });
    }
    if (existsSync(testDeadLetterDir)) {
      rmSync(testDeadLetterDir, { recursive: true, force: true });
    }

    // Create database and server
    database = new DatabaseAdapter(testDbPath);
    const config = {
      apiKey,
      port,
      host: '127.0.0.1',
      logLevel: 'silent' as const,
      database: {
        type: 'sqlite' as const,
        path: testDbPath
      }
    };
    server = await createServer(config, database);
    
    await server.listen({ port, host: '127.0.0.1' });
    
    // Create client
    client = new ReportServiceClient({
      url,
      apiKey,
      pendingDir: testPendingDir,
      deadLetterDir: testDeadLetterDir,
      enableRetryJob: false // Manual control for tests
    });
    
    await client.initialize();
  });

  afterAll(async () => {
    // Stop client retry job if running
    if (client) {
      client.stopRetryJob();
    }
    
    // Close server and database
    if (server) {
      await server.close();
    }
    if (database) {
      database.close();
    }
    
    // Clean up test files
    if (existsSync(testDbPath)) {
      rmSync(testDbPath, { force: true });
    }
    if (existsSync(`${testDbPath}-shm`)) {
      rmSync(`${testDbPath}-shm`, { force: true });
    }
    if (existsSync(`${testDbPath}-wal`)) {
      rmSync(`${testDbPath}-wal`, { force: true });
    }
    if (existsSync(testPendingDir)) {
      rmSync(testPendingDir, { recursive: true, force: true });
    }
    if (existsSync(testDeadLetterDir)) {
      rmSync(testDeadLetterDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    // Clear database between tests
    database.db.exec('DELETE FROM ruleset_results');
    database.db.exec('DELETE FROM jobs');
    database.db.exec('DELETE FROM documents');

    // Clear pending and dead-letter storage between tests
    await client['storage'].clear();
  });

  describe('notify', () => {
    it('should successfully send a notification to the server', async () => {
      const notification: JobNotification = {
        jobId: 'integration-test-job-1',
        documentId: 'test-doc-1',
        status: 'completed',
        results: [
          {
            rulesetName: 'pubhub',
            rulesetVersion: '1.0.0',
            status: 'completed',
            issues: [],
            summary: {
              errorCount: 2,
              warningCount: 2,
              infoCount: 1,
              hintCount: 0,
              totalIssues: 5
            }
          }
        ],
        summary: {
          errorCount: 2,
          warningCount: 2,
          infoCount: 1,
          hintCount: 0,
          totalIssues: 5,
          durationMs: 1000
        },
        metadata: {
          name: 'Test API',
          version: '1.0.0',
          format: 'openapi'
        },
        timestamp: new Date().toISOString()
      };

      await client.notify(notification);

      // Verify it was stored in the database
      const job = database.getJobById('integration-test-job-1');
      expect(job).toBeDefined();
      expect(job?.jobId).toBe('integration-test-job-1');
      expect(job?.status).toBe('completed');
      expect(job?.summary.totalIssues).toBe(5);
      expect(job?.results).toHaveLength(1);
    });

    it('should send notification with full metadata', async () => {
      const notification: JobNotification = {
        jobId: 'integration-test-job-2',
        documentId: 'test-doc-2',
        status: 'completed',
        results: [
          {
            rulesetName: 'pubhub',
            rulesetVersion: '2.0.0',
            status: 'completed',
            issues: [],
            summary: { errorCount: 1, warningCount: 3, infoCount: 2, hintCount: 0, totalIssues: 6 }
          },
          {
            rulesetName: 'spectral-oas',
            rulesetVersion: '6.11.0',
            status: 'completed',
            issues: [],
            summary: { errorCount: 0, warningCount: 2, infoCount: 2, hintCount: 0, totalIssues: 4 }
          }
        ],
        summary: {
          errorCount: 1,
          warningCount: 5,
          infoCount: 4,
          hintCount: 0,
          totalIssues: 10,
          durationMs: 3000
        },
        metadata: {
          name: 'Test API',
          version: '1.0.0',
          organization: 'DevNet',
          format: 'openapi'
        },
        timestamp: new Date().toISOString()
      };

      await client.notify(notification);

      const job = database.getJobById('integration-test-job-2');
      expect(job).toBeDefined();
      expect(job?.results).toHaveLength(2);
      expect(job?.documentName).toBe('Test API');
      expect(job?.documentVersion).toBe('1.0.0');
      expect(job?.summary.totalIssues).toBe(10);
    });

    it('should handle failed job status', async () => {
      const notification: JobNotification = {
        jobId: 'integration-test-job-3',
        documentId: 'test-doc-3',
        status: 'failed',
        results: [],
        summary: {
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          hintCount: 0,
          totalIssues: 0,
          durationMs: 500
        },
        metadata: { name: 'Failed API', format: 'openapi' },
        timestamp: new Date().toISOString()
      };

      await client.notify(notification);

      const job = database.getJobById('integration-test-job-3');
      expect(job).toBeDefined();
      expect(job?.status).toBe('failed');
    });
  });

  describe('error handling and retry', () => {
    it('should save to pending storage when server is unreachable', async () => {
      // Create a client pointing to a non-existent server
      const failClient = new ReportServiceClient({
        url: 'http://localhost:9999',
        apiKey: 'test-key',
        pendingDir: testPendingDir,
        enableRetryJob: false
      });
      await failClient.initialize();

      const notification = makeNotification({
        jobId: 'pending-job-1',
        documentId: 'doc-1',
      });

      // This should fail but not throw
      await expect(failClient.notify(notification)).resolves.not.toThrow();

      // Check pending storage
      const pending = await failClient['storage'].list();
      expect(pending.length).toBeGreaterThan(0);
      expect(pending[0].notification.jobId).toBe('pending-job-1');
    });

    it('should retry pending notifications when server becomes available', async () => {
      const notification = makeNotification({
        jobId: 'retry-job-1',
        documentId: 'doc-1',
        results: [
          {
            rulesetName: 'test-ruleset',
            status: 'completed',
            issues: [],
            summary: {
              errorCount: 1,
              warningCount: 1,
              infoCount: 1,
              hintCount: 0,
              totalIssues: 3,
            },
          },
        ],
        summary: {
          errorCount: 1,
          warningCount: 1,
          infoCount: 1,
          hintCount: 0,
          totalIssues: 3,
          durationMs: 100,
        },
      });

      // Manually store in pending (simulating a previous failure)
      await client['storage'].store(notification);

      // Verify it's in pending storage
      const beforeRetry = await client['storage'].list();
      expect(beforeRetry).toHaveLength(1);

      // Trigger retry
      await client.retryPendingNotifications();

      // Verify it was removed from pending storage
      const afterRetry = await client['storage'].list();
      expect(afterRetry).toHaveLength(0);

      // Verify it's in the database
      const job = database.getJobById('retry-job-1');
      expect(job).toBeDefined();
      expect(job?.jobId).toBe('retry-job-1');
      expect(job?.documentId).toBe('doc-1');
      expect(job?.summary.totalIssues).toBe(3);
    });

    it('should handle authentication errors', async () => {
      const badClient = new ReportServiceClient({
        url,
        apiKey: 'wrong-api-key',
        pendingDir: testPendingDir,
        enableRetryJob: false
      });
      await badClient.initialize();

      const notification = makeNotification({
        jobId: 'auth-fail-job',
        documentId: 'doc-1',
      });

      // Should fail but save to pending storage
      await expect(badClient.notify(notification)).resolves.not.toThrow();

      // Should not be in database (auth failed)
      const job = database.getJobById('auth-fail-job');
      expect(job).toBeNull();

      // Should be in pending storage
      const pending = await badClient['storage'].list();
      expect(pending.length).toBeGreaterThan(0);
    });
  });

  describe('background retry job', () => {
    it('should start and stop retry job', async () => {
      const notification = makeNotification({
        jobId: 'background-job-1',
        documentId: 'doc-1',
      });

      // Add to pending storage
      await client['storage'].store(notification);

      // Start retry job with 1 second interval for testing
      client.startRetryJob(1000);

      // Wait for it to process
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Stop retry job
      client.stopRetryJob();

      // Verify notification was processed
      const pending = await client['storage'].list();
      expect(pending).toHaveLength(0);

      const job = database.getJobById('background-job-1');
      expect(job).toBeDefined();
    });
  });

  describe('concurrent notifications', () => {
    it('should handle multiple concurrent notifications', async () => {
      const notifications: JobNotification[] = [];
      
      for (let i = 0; i < 10; i++) {
        notifications.push(makeNotification({
          jobId: `concurrent-job-${i}`,
          documentId: `doc-${i}`,
          results: [
            {
              rulesetName: 'test-ruleset',
              status: 'completed',
              issues: [],
              summary: { errorCount: 0, warningCount: 0, infoCount: 0, hintCount: 0, totalIssues: i }
            }
          ],
          summary: { errorCount: 0, warningCount: 0, infoCount: 0, hintCount: 0, totalIssues: i, durationMs: 100 },
        }));
      }

      // Send all notifications concurrently
      await Promise.all(notifications.map(n => client.notify(n)));

      // Verify all were stored
      for (let i = 0; i < 10; i++) {
        const job = database.getJobById(`concurrent-job-${i}`);
        expect(job).toBeDefined();
        expect(job?.summary.totalIssues).toBe(i);
      }
    });
  });
});
