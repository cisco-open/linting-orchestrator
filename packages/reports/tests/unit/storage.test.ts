import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { PendingStorage } from '../../src/client/storage.js';
import type { PendingNotification, JobNotification } from '../../src/client/types.js';

describe('PendingStorage', () => {
  const testDir = join(process.cwd(), 'test-pending-reports');
  const testDeadLetterDir = join(process.cwd(), 'test-dead-letter-reports');
  let storage: PendingStorage;

  beforeEach(() => {
    // Clean up before each test
    for (const dir of [testDir, testDeadLetterDir]) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
      mkdirSync(dir, { recursive: true });
    }
    storage = new PendingStorage(testDir, testDeadLetterDir);
  });

  afterEach(() => {
    // Clean up after each test
    for (const dir of [testDir, testDeadLetterDir]) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  describe('store', () => {
    it('should store a notification to disk', async () => {
      const notification: JobNotification = {
        jobId: 'test-job-1',
        documentId: 'test-doc-1',
        status: 'completed',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalIssues: 5,
        rulesets: []
      };

      await storage.store(notification);
      const files = await storage.list();
      
      expect(files).toHaveLength(1);
      expect(files[0].notification.jobId).toBe('test-job-1');
    });

    it('should generate unique filenames for multiple notifications', async () => {
      const notification1: JobNotification = {
        jobId: 'job-1',
        documentId: 'doc-1',
        status: 'completed',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalIssues: 1,
        rulesets: []
      };

      const notification2: JobNotification = {
        jobId: 'job-2',
        documentId: 'doc-2',
        status: 'completed',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalIssues: 2,
        rulesets: []
      };

      await storage.store(notification1);
      await storage.store(notification2);
      
      const files = await storage.list();
      expect(files).toHaveLength(2);
    });
  });

  describe('list', () => {
    it('should return empty array when no notifications exist', async () => {
      const files = await storage.list();
      expect(files).toEqual([]);
    });

    it('should return all stored notifications', async () => {
      const notification1: JobNotification = {
        jobId: 'job-1',
        documentId: 'doc-1',
        status: 'completed',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalIssues: 1,
        rulesets: []
      };

      const notification2: JobNotification = {
        jobId: 'job-2',
        documentId: 'doc-2',
        status: 'failed',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        errorMessage: 'Test error',
        rulesets: []
      };

      await storage.store(notification1);
      await storage.store(notification2);

      const files = await storage.list();
      
      expect(files).toHaveLength(2);
      expect(files.map(f => f.notification.jobId)).toContain('job-1');
      expect(files.map(f => f.notification.jobId)).toContain('job-2');
    });

    it('should skip invalid JSON files', async () => {
      // Store a valid notification
      const validNotification: JobNotification = {
        jobId: 'valid-job',
        documentId: 'doc-1',
        status: 'completed',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalIssues: 1,
        rulesets: []
      };

      await storage.store(validNotification);

      // Manually create an invalid JSON file
      const invalidPath = join(testDir, 'invalid.json');
      const fs = await import('fs/promises');
      await fs.writeFile(invalidPath, '{ invalid json }', 'utf-8');

      const files = await storage.list();
      
      // Should only return the valid notification
      expect(files).toHaveLength(1);
      expect(files[0].notification.jobId).toBe('valid-job');
    });
  });

  describe('remove', () => {
    it('should remove a notification file by filename', async () => {
      const notification: JobNotification = {
        jobId: 'test-job',
        documentId: 'doc-1',
        status: 'completed',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalIssues: 1,
        rulesets: []
      };

      await storage.store(notification);
      const files = await storage.list();
      expect(files).toHaveLength(1);

      await storage.remove(notification.jobId);

      const remainingFiles = await storage.list();
      expect(remainingFiles).toHaveLength(0);
    });

    it('should not throw when removing non-existent file', async () => {
      await expect(storage.remove('nonexistent.json')).resolves.not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle notifications with special characters in jobId', async () => {
      const notification: JobNotification = {
        jobId: 'test-job-with-special-chars',
        documentId: 'doc-1',
        status: 'completed',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalIssues: 1,
        rulesets: []
      };

      await storage.store(notification);
      const files = await storage.list();
      
      expect(files).toHaveLength(1);
      expect(files[0].notification.jobId).toBe('test-job-with-special-chars');
    });

    it('should preserve all notification fields', async () => {
      const notification: JobNotification = {
        jobId: 'job-1',
        documentId: 'doc-1',
        status: 'failed',
        startTime: '2026-02-04T10:00:00Z',
        endTime: '2026-02-04T10:05:00Z',
        errorMessage: 'Network timeout',
        totalIssues: 42,
        rulesets: [
          {
            name: 'pubhub',
            version: '1.0.0',
            issueCount: 42,
            errorCount: 10,
            warningCount: 20,
            infoCount: 12
          }
        ],
        documentMetadata: {
          name: 'Test API',
          version: '1.0.0',
          organization: 'Test Org'
        }
      };

      await storage.store(notification);
      const files = await storage.list();
      
      expect(files).toHaveLength(1);
      const retrieved = files[0];
      
      expect(retrieved.notification.jobId).toBe('job-1');
      expect(retrieved.notification.status).toBe('failed');
      expect(retrieved.notification.errorMessage).toBe('Network timeout');
      expect(retrieved.notification.totalIssues).toBe(42);
      expect(retrieved.notification.rulesets).toHaveLength(1);
      expect(retrieved.notification.rulesets![0].name).toBe('pubhub');
      expect(retrieved.notification.documentMetadata?.name).toBe('Test API');
      expect(retrieved.attempts).toBe(0);
      expect(retrieved.createdAt).toBeDefined();
    });
  });

  describe('dead-letter', () => {
    it('should move a notification to dead-letter directory', async () => {
      const notification: JobNotification = {
        jobId: 'dead-letter-job-1',
        documentId: 'doc-1',
        status: 'completed',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalIssues: 1,
        rulesets: []
      };

      await storage.store(notification);
      expect(await storage.count()).toBe(1);

      await storage.moveToDeadLetter('dead-letter-job-1', 'HTTP 413: Request body is too large');

      // Should be removed from pending
      expect(await storage.count()).toBe(0);

      // Should be in dead-letter
      expect(await storage.deadLetterCount()).toBe(1);

      const deadLetterItems = await storage.listDeadLetter();
      expect(deadLetterItems).toHaveLength(1);
      expect(deadLetterItems[0].notification.jobId).toBe('dead-letter-job-1');
    });

    it('should annotate dead-letter file with reason and timestamp', async () => {
      const notification: JobNotification = {
        jobId: 'annotated-dl-job',
        documentId: 'doc-1',
        status: 'completed',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalIssues: 1,
        rulesets: []
      };

      await storage.store(notification);
      await storage.moveToDeadLetter('annotated-dl-job', 'HTTP 413: body too large');

      const filepath = join(testDeadLetterDir, 'annotated-dl-job.json');
      const fs = await import('fs/promises');
      const content = JSON.parse(await fs.readFile(filepath, 'utf-8'));

      expect(content.deadLetterReason).toBe('HTTP 413: body too large');
      expect(content.movedAt).toBeDefined();
    });

    it('should not throw when moving a non-existent notification', async () => {
      await expect(
        storage.moveToDeadLetter('nonexistent-job', 'test reason')
      ).resolves.not.toThrow();
    });

    it('should return 0 dead-letter count when directory is empty', async () => {
      expect(await storage.deadLetterCount()).toBe(0);
    });

    it('should list empty array when no dead-letter notifications', async () => {
      const items = await storage.listDeadLetter();
      expect(items).toEqual([]);
    });
  });
});
