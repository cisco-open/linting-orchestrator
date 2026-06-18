/**
 * Storage Layer Test Suite
 * 
 * Comprehensive tests for storage implementations
 * Target: >80% coverage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryLintStorage } from '../../src/storage/memory-storage.js';
import { makeCompositeKey, parseCompositeKey } from '../../src/storage/storage-adapter.js';
import {
  createSampleJobResult,
  createMultipleJobsForDocument,
  createMultipleJobsForDifferentDocuments,
  createLargeJobResult,
  createFailedJobResult
} from '../fixtures/sample-results.js';

describe('Storage Adapter Utilities', () => {
  describe('makeCompositeKey', () => {
    it('should create composite key from components', () => {
      const key = makeCompositeKey('doc-123', 'pubhub', '1.1.0');
      expect(key).toBe('doc-123:pubhub:1.1.0');
    });

    it('should handle special characters', () => {
      const key = makeCompositeKey('doc-with-dash', 'ruleset_name', '1.0.0-beta');
      expect(key).toBe('doc-with-dash:ruleset_name:1.0.0-beta');
    });
  });

  describe('parseCompositeKey', () => {
    it('should parse valid composite key', () => {
      const parsed = parseCompositeKey('doc-123:pubhub:1.1.0');
      expect(parsed).toEqual({
        documentId: 'doc-123',
        rulesetName: 'pubhub',
        rulesetVersion: '1.1.0'
      });
    });

    it('should return null for invalid key', () => {
      expect(parseCompositeKey('invalid')).toBeNull();
      expect(parseCompositeKey('only:two')).toBeNull();
      expect(parseCompositeKey('too:many:parts:here')).toBeNull();
    });
  });
});

describe('MemoryLintStorage', () => {
  let storage: MemoryLintStorage;

  beforeEach(async () => {
    storage = new MemoryLintStorage();
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
  });

  describe('initialization', () => {
    it('should initialize without options', async () => {
      const newStorage = new MemoryLintStorage();
      await expect(newStorage.initialize()).resolves.not.toThrow();
      await newStorage.close();
    });

    it('should initialize with TTL option', async () => {
      const newStorage = new MemoryLintStorage();
      await expect(newStorage.initialize({ ttl: 3600 })).resolves.not.toThrow();
      await newStorage.close();
    });
  });

  describe('storeJob', () => {
    it('should store a job result', async () => {
      const result = createSampleJobResult();
      await storage.storeJob(result);

      const retrieved = await storage.retrieveJobById(result.jobId);
      expect(retrieved).toEqual(result);
    });

    it('should store multiple job results', async () => {
      const results = createMultipleJobsForDifferentDocuments();
      
      for (const result of results) {
        await storage.storeJob(result);
      }

      for (const result of results) {
        const retrieved = await storage.retrieveJobById(result.jobId);
        expect(retrieved).toEqual(result);
      }
    });

    it('should store large job result', async () => {
      const result = createLargeJobResult(1000);
      await storage.storeJob(result);

      const retrieved = await storage.retrieveJobById(result.jobId);
      expect(retrieved).toEqual(result);
      expect(retrieved?.results.length).toBe(1000);
    });

    it('should store failed job result', async () => {
      const result = createFailedJobResult();
      await storage.storeJob(result);

      const retrieved = await storage.retrieveJobById(result.jobId);
      expect(retrieved).toEqual(result);
      expect(retrieved?.status).toBe('failed');
    });
  });

  describe('retrieveJobById', () => {
    it('should retrieve existing job', async () => {
      const result = createSampleJobResult('job-123', 'doc-456');
      await storage.storeJob(result);

      const retrieved = await storage.retrieveJobById('job-123');
      expect(retrieved).toEqual(result);
    });

    it('should return null for non-existent job', async () => {
      const retrieved = await storage.retrieveJobById('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should return null after job expires with TTL', async () => {
      const storageWithTTL = new MemoryLintStorage();
      await storageWithTTL.initialize({ ttl: 1 }); // 1 second TTL

      const result = createSampleJobResult();
      await storageWithTTL.storeJob(result);

      // Should exist immediately
      const retrievedBefore = await storageWithTTL.retrieveJobById(result.jobId);
      expect(retrievedBefore).toEqual(result);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be expired and return null
      const retrievedAfter = await storageWithTTL.retrieveJobById(result.jobId);
      expect(retrievedAfter).toBeNull();

      await storageWithTTL.close();
    });
  });

  describe('retrieveJob', () => {
    it('should retrieve job by document + ruleset', async () => {
      const result = createSampleJobResult('job-1', 'doc-1', 'pubhub', '1.1.0');
      await storage.storeJob(result);

      const retrieved = await storage.retrieveJob('doc-1', 'pubhub', '1.1.0');
      expect(retrieved).toEqual(result);
    });

    it('should return null for non-existent combination', async () => {
      const retrieved = await storage.retrieveJob('doc-999', 'pubhub', '1.1.0');
      expect(retrieved).toBeNull();
    });

    it('should return latest job for duplicate document + ruleset', async () => {
      const result1 = createSampleJobResult('job-1', 'doc-1', 'pubhub', '1.1.0');
      const result2 = createSampleJobResult('job-2', 'doc-1', 'pubhub', '1.1.0');

      await storage.storeJob(result1);
      await storage.storeJob(result2);

      const retrieved = await storage.retrieveJob('doc-1', 'pubhub', '1.1.0');
      expect(retrieved?.jobId).toBe('job-2'); // Latest
    });

    it('should differentiate between ruleset versions', async () => {
      const result1 = createSampleJobResult('job-1', 'doc-1', 'pubhub', '1.0.0');
      const result2 = createSampleJobResult('job-2', 'doc-1', 'pubhub', '1.1.0');

      await storage.storeJob(result1);
      await storage.storeJob(result2);

      const retrieved1 = await storage.retrieveJob('doc-1', 'pubhub', '1.0.0');
      const retrieved2 = await storage.retrieveJob('doc-1', 'pubhub', '1.1.0');

      expect(retrieved1?.jobId).toBe('job-1');
      expect(retrieved2?.jobId).toBe('job-2');
    });
  });

  describe('exists', () => {
    it('should return true for existing job', async () => {
      const result = createSampleJobResult('job-1', 'doc-1', 'pubhub', '1.1.0');
      await storage.storeJob(result);

      const exists = await storage.exists('doc-1', 'pubhub', '1.1.0');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent job', async () => {
      const exists = await storage.exists('doc-999', 'pubhub', '1.1.0');
      expect(exists).toBe(false);
    });

    it('should return false after TTL expiration', async () => {
      const storageWithTTL = new MemoryLintStorage();
      await storageWithTTL.initialize({ ttl: 1 }); // 1 second TTL

      const result = createSampleJobResult();
      await storageWithTTL.storeJob(result);

      // Should exist immediately
      const existsBefore = await storageWithTTL.exists(
        result.documentId,
        result.rulesetName,
        result.rulesetVersion
      );
      expect(existsBefore).toBe(true);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should not exist after expiration
      const existsAfter = await storageWithTTL.exists(
        result.documentId,
        result.rulesetName,
        result.rulesetVersion
      );
      expect(existsAfter).toBe(false);

      await storageWithTTL.close();
    });
  });

  describe('invalidate', () => {
    it('should invalidate all jobs for a document', async () => {
      const results = createMultipleJobsForDocument('doc-123');
      
      for (const result of results) {
        await storage.storeJob(result);
      }

      // Verify all exist
      for (const result of results) {
        const exists = await storage.retrieveJobById(result.jobId);
        expect(exists).not.toBeNull();
      }

      // Invalidate
      const count = await storage.invalidate('doc-123');
      expect(count).toBe(3);

      // Verify all removed
      for (const result of results) {
        const retrieved = await storage.retrieveJobById(result.jobId);
        expect(retrieved).toBeNull();
      }
    });

    it('should return 0 for non-existent document', async () => {
      const count = await storage.invalidate('non-existent');
      expect(count).toBe(0);
    });

    it('should only invalidate specified document', async () => {
      const results = createMultipleJobsForDifferentDocuments();
      
      for (const result of results) {
        await storage.storeJob(result);
      }

      // Invalidate doc-1
      await storage.invalidate('doc-1');

      // doc-1 jobs should be gone
      const doc1Job1 = await storage.retrieveJobById('job-1');
      const doc1Job4 = await storage.retrieveJobById('job-4');
      expect(doc1Job1).toBeNull();
      expect(doc1Job4).toBeNull();

      // Other jobs should remain
      const doc2Job = await storage.retrieveJobById('job-2');
      const doc3Job = await storage.retrieveJobById('job-3');
      expect(doc2Job).not.toBeNull();
      expect(doc3Job).not.toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return stats for empty storage', async () => {
      const stats = await storage.getStats();
      
      expect(stats.totalJobs).toBe(0);
      expect(stats.totalResults).toBe(0);
      expect(stats.activeJobs).toBe(0);
      expect(stats.indexedDocuments).toBe(0);
    });

    it('should return stats for populated storage', async () => {
      const results = createMultipleJobsForDifferentDocuments();
      
      for (const result of results) {
        await storage.storeJob(result);
      }

      const stats = await storage.getStats();
      
      expect(stats.totalJobs).toBe(4);
      expect(stats.activeJobs).toBe(4);
      expect(stats.indexedDocuments).toBe(3); // doc-1, doc-2, doc-3
      expect(stats.totalResults).toBeGreaterThan(0);
      expect(stats.storageSize).toBeGreaterThan(0);
    });

    it('should track total stored count', async () => {
      const result1 = createSampleJobResult('job-1');
      const result2 = createSampleJobResult('job-2');

      await storage.storeJob(result1);
      await storage.storeJob(result2);

      const stats = await storage.getStats();
      expect(stats.totalStored).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all data', async () => {
      const results = createMultipleJobsForDifferentDocuments();
      
      for (const result of results) {
        await storage.storeJob(result);
      }

      const count = await storage.clear();
      expect(count).toBe(4);

      const stats = await storage.getStats();
      expect(stats.totalJobs).toBe(0);
      expect(stats.activeJobs).toBe(0);
    });

    it('should return 0 for empty storage', async () => {
      const count = await storage.clear();
      expect(count).toBe(0);
    });
  });

  describe('close', () => {
    it('should clean up resources', async () => {
      const storageWithTTL = new MemoryLintStorage();
      await storageWithTTL.initialize({ ttl: 3600 });

      const result = createSampleJobResult();
      await storageWithTTL.storeJob(result);

      await storageWithTTL.close();

      const stats = await storageWithTTL.getStats();
      expect(stats.totalJobs).toBe(0);
    });
  });

  describe('TTL and expiration', () => {
    it('should expire entries after TTL and clean up on retrieval', async () => {
      const storageWithTTL = new MemoryLintStorage();
      await storageWithTTL.initialize({ ttl: 1 }); // 1 second TTL

      const result1 = createSampleJobResult('job-1');
      const result2 = createSampleJobResult('job-2');

      await storageWithTTL.storeJob(result1);
      await storageWithTTL.storeJob(result2);

      // Verify both exist immediately
      expect(await storageWithTTL.retrieveJobById('job-1')).not.toBeNull();
      expect(await storageWithTTL.retrieveJobById('job-2')).not.toBeNull();

      // Wait for expiration (use minimal wait)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Accessing expired entries should trigger lazy cleanup and return null
      const retrieved1 = await storageWithTTL.retrieveJobById('job-1');
      const retrieved2 = await storageWithTTL.retrieveJobById('job-2');
      expect(retrieved1).toBeNull();
      expect(retrieved2).toBeNull();

      // Stats should show entries were removed
      const stats = await storageWithTTL.getStats();
      expect(stats.totalJobs).toBe(0);

      await storageWithTTL.close();
    });

    it('should handle entries with different expiration times', async () => {
      // Test that TTL is calculated from storage time, not from a fixed point
      const storageWithTTL = new MemoryLintStorage();
      await storageWithTTL.initialize({ ttl: 1 }); // 1 second TTL

      const result1 = createSampleJobResult('job-1');
      const result2 = createSampleJobResult('job-2');
      
      // Store both
      await storageWithTTL.storeJob(result1);
      await storageWithTTL.storeJob(result2);

      // Both should exist
      expect(await storageWithTTL.retrieveJobById('job-1')).not.toBeNull();
      expect(await storageWithTTL.retrieveJobById('job-2')).not.toBeNull();

      // After TTL, both should be expired
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      expect(await storageWithTTL.retrieveJobById('job-1')).toBeNull();
      expect(await storageWithTTL.retrieveJobById('job-2')).toBeNull();

      await storageWithTTL.close();
    });
  });

  describe('helper methods (for testing/debugging)', () => {
    it('getJobsForDocument should return job IDs for document', async () => {
      const results = createMultipleJobsForDocument('doc-123');
      
      for (const result of results) {
        await storage.storeJob(result);
      }

      const jobIds = storage.getJobsForDocument('doc-123');
      expect(jobIds.size).toBe(3);
      expect(jobIds.has('job-1')).toBe(true);
      expect(jobIds.has('job-2')).toBe(true);
      expect(jobIds.has('job-3')).toBe(true);
    });

    it('getAllJobIds should return all job IDs', async () => {
      const results = createMultipleJobsForDifferentDocuments();
      
      for (const result of results) {
        await storage.storeJob(result);
      }

      const allJobIds = storage.getAllJobIds();
      expect(allJobIds.length).toBe(4);
      expect(allJobIds).toContain('job-1');
      expect(allJobIds).toContain('job-2');
      expect(allJobIds).toContain('job-3');
      expect(allJobIds).toContain('job-4');
    });
  });

  describe('edge cases', () => {
    it('should handle empty job results', async () => {
      const result = createSampleJobResult();
      result.results = [];
      result.summary.totalIssues = 0;

      await storage.storeJob(result);
      const retrieved = await storage.retrieveJobById(result.jobId);
      
      expect(retrieved).toEqual(result);
      expect(retrieved?.results.length).toBe(0);
    });

    it('should handle special characters in document IDs', async () => {
      const result = createSampleJobResult('job-1', 'doc-with-special-chars_123');
      await storage.storeJob(result);

      const retrieved = await storage.retrieveJobById('job-1');
      expect(retrieved?.documentId).toBe('doc-with-special-chars_123');
    });

    it('should handle concurrent store operations', async () => {
      const results = createMultipleJobsForDifferentDocuments();
      
      // Store all concurrently
      await Promise.all(results.map(r => storage.storeJob(r)));

      // All should be retrievable
      for (const result of results) {
        const retrieved = await storage.retrieveJobById(result.jobId);
        expect(retrieved).not.toBeNull();
      }
    });

    it('should handle overwriting same composite key', async () => {
      const result1 = createSampleJobResult('job-1', 'doc-1', 'pubhub', '1.1.0');
      const result2 = createSampleJobResult('job-2', 'doc-1', 'pubhub', '1.1.0');

      await storage.storeJob(result1);
      await storage.storeJob(result2);

      // Both jobs exist
      expect(await storage.retrieveJobById('job-1')).not.toBeNull();
      expect(await storage.retrieveJobById('job-2')).not.toBeNull();

      // But composite index points to latest
      const retrieved = await storage.retrieveJob('doc-1', 'pubhub', '1.1.0');
      expect(retrieved?.jobId).toBe('job-2');

      // Invalidating should remove both
      const count = await storage.invalidate('doc-1');
      expect(count).toBe(2);
    });
  });
});
