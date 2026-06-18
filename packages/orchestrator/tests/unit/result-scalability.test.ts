/**
 * Result Scalability Test Suite
 * 
 * Tests for pagination, filtering, statistics, and truncation
 * of lint job results.
 * 
 * Covers:
 * - queryJobResults: pagination with offset/limit
 * - queryJobResults: filtering by severity, rule, pathPrefix
 * - queryJobResults: combined filters + pagination
 * - getJobStats: rule breakdown, top paths
 * - Truncation markers on large results
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryLintStorage } from '../../src/storage/memory-storage.js';
import {
  createSampleJobResult,
  createLargeJobResult,
  createRealisticLargeJobResult,
} from '../fixtures/sample-results.js';
import type { LintJobResult } from '../../src/types.js';

describe('Result Scalability', () => {
  let storage: MemoryLintStorage;

  beforeEach(async () => {
    storage = new MemoryLintStorage();
    await storage.initialize({});
  });

  // ============================================
  // queryJobResults — Pagination
  // ============================================

  describe('queryJobResults - pagination', () => {
    it('should return all results when no pagination options', async () => {
      const job = createLargeJobResult(100);
      await storage.storeJob(job);

      const result = await storage.queryJobResults('job-large', {});
      expect(result).not.toBeNull();
      expect(result!.results).toHaveLength(100);
      expect(result!.pagination).toBeUndefined();
      expect(result!.filters).toBeUndefined();
      expect(result!.summary.totalIssues).toBe(100);
    });

    it('should paginate with offset and limit', async () => {
      const job = createLargeJobResult(200);
      await storage.storeJob(job);

      const page1 = await storage.queryJobResults('job-large', { offset: 0, limit: 50 });
      expect(page1).not.toBeNull();
      expect(page1!.results).toHaveLength(50);
      expect(page1!.pagination).toBeDefined();
      expect(page1!.pagination!.offset).toBe(0);
      expect(page1!.pagination!.limit).toBe(50);
      expect(page1!.pagination!.returned).toBe(50);
      expect(page1!.pagination!.totalMatching).toBe(200);
      expect(page1!.pagination!.hasMore).toBe(true);

      const page2 = await storage.queryJobResults('job-large', { offset: 50, limit: 50 });
      expect(page2!.results).toHaveLength(50);
      expect(page2!.pagination!.offset).toBe(50);
      expect(page2!.pagination!.hasMore).toBe(true);

      // Last page
      const lastPage = await storage.queryJobResults('job-large', { offset: 150, limit: 50 });
      expect(lastPage!.results).toHaveLength(50);
      expect(lastPage!.pagination!.hasMore).toBe(false);
    });

    it('should handle offset beyond results', async () => {
      const job = createLargeJobResult(50);
      await storage.storeJob(job);

      const result = await storage.queryJobResults('job-large', { offset: 100, limit: 50 });
      expect(result).not.toBeNull();
      expect(result!.results).toHaveLength(0);
      expect(result!.pagination!.returned).toBe(0);
      expect(result!.pagination!.hasMore).toBe(false);
    });

    it('should always include full summary regardless of pagination', async () => {
      const job = createLargeJobResult(500);
      await storage.storeJob(job);

      const result = await storage.queryJobResults('job-large', { offset: 0, limit: 10 });
      expect(result!.results).toHaveLength(10);
      // Summary always reflects the complete job, not the page
      expect(result!.summary.totalIssues).toBe(500);
    });

    it('should return null for non-existent job', async () => {
      const result = await storage.queryJobResults('non-existent', { offset: 0, limit: 10 });
      expect(result).toBeNull();
    });
  });

  // ============================================
  // queryJobResults — Filtering
  // ============================================

  describe('queryJobResults - filtering', () => {
    let realisticJob: LintJobResult;

    beforeEach(async () => {
      // 500 issues with known rule/severity distribution across 6 rule types
      realisticJob = createRealisticLargeJobResult(600);
      await storage.storeJob(realisticJob);
    });

    it('should filter by severity (errors only)', async () => {
      // In the realistic fixture, severity=0 (error) maps to ruleId 'typed-enum' 
      // which is every 3rd issue (index 2, 8, 14...) = 1/6 of 600 = 100
      const result = await storage.queryJobResults('job-realistic', { severity: 0 });
      expect(result).not.toBeNull();
      expect(result!.results).toHaveLength(100);
      expect(result!.results.every(r => r.severity === 0)).toBe(true);
      expect(result!.filters).toBeDefined();
      expect(result!.filters!.severity).toBe(0);
      // Summary always reflects ALL issues
      expect(result!.summary.totalIssues).toBe(600);
    });

    it('should filter by severity (warnings)', async () => {
      // severity=1 (warn) = description-for-every-attribute + examples-for-every-schema + info-contact
      // = 3/6 of 600 = 300
      const result = await storage.queryJobResults('job-realistic', { severity: 1 });
      expect(result!.results).toHaveLength(300);
      expect(result!.results.every(r => r.severity === 1)).toBe(true);
    });

    it('should filter by rule ID', async () => {
      // 'description-for-every-attribute' is every 6th issue starting at 0 = 100 issues
      const result = await storage.queryJobResults('job-realistic', { rule: 'description-for-every-attribute' });
      expect(result).not.toBeNull();
      expect(result!.results).toHaveLength(100);
      expect(result!.results.every(r => r.ruleId === 'description-for-every-attribute')).toBe(true);
      expect(result!.filters!.rule).toBe('description-for-every-attribute');
    });

    it('should filter by pathPrefix', async () => {
      // 'paths./pets' issues come from 'typed-enum' rule (every 3rd in cycle of 6)
      const result = await storage.queryJobResults('job-realistic', { pathPrefix: 'paths./pets' });
      expect(result).not.toBeNull();
      expect(result!.results.length).toBeGreaterThan(0);
      expect(result!.results.every(r => r.path.join('.').startsWith('paths./pets'))).toBe(true);
      expect(result!.filters!.pathPrefix).toBe('paths./pets');
    });

    it('should combine severity filter with pagination', async () => {
      const result = await storage.queryJobResults('job-realistic', {
        severity: 1,
        offset: 0,
        limit: 20
      });
      expect(result).not.toBeNull();
      expect(result!.results).toHaveLength(20);
      expect(result!.results.every(r => r.severity === 1)).toBe(true);
      expect(result!.pagination!.totalMatching).toBe(300);
      expect(result!.pagination!.hasMore).toBe(true);
    });

    it('should combine rule filter with pagination', async () => {
      const result = await storage.queryJobResults('job-realistic', {
        rule: 'typed-enum',
        offset: 0,
        limit: 10
      });
      expect(result).not.toBeNull();
      expect(result!.results).toHaveLength(10);
      expect(result!.results.every(r => r.ruleId === 'typed-enum')).toBe(true);
      expect(result!.pagination!.totalMatching).toBe(100);
    });

    it('should combine multiple filters (severity + rule)', async () => {
      // typed-enum has severity 0, so filtering severity=0 + rule=typed-enum should match
      const result = await storage.queryJobResults('job-realistic', {
        severity: 0,
        rule: 'typed-enum'
      });
      expect(result!.results).toHaveLength(100);

      // severity=1 + rule=typed-enum should match 0 (typed-enum is severity 0)
      const empty = await storage.queryJobResults('job-realistic', {
        severity: 1,
        rule: 'typed-enum'
      });
      expect(empty!.results).toHaveLength(0);
    });

    it('should return empty array for no matches', async () => {
      const result = await storage.queryJobResults('job-realistic', { rule: 'nonexistent-rule' });
      expect(result).not.toBeNull();
      expect(result!.results).toHaveLength(0);
    });
  });

  // ============================================
  // getJobStats
  // ============================================

  describe('getJobStats', () => {
    it('should return rule breakdown sorted by count', async () => {
      const job = createRealisticLargeJobResult(600);
      await storage.storeJob(job);

      const stats = await storage.getJobStats('job-realistic');
      expect(stats).not.toBeNull();
      expect(stats!.ruleBreakdown).toBeDefined();
      expect(stats!.ruleBreakdown.length).toBe(6); // 6 distinct rules

      // Each rule gets 100 issues (600 / 6)
      for (const entry of stats!.ruleBreakdown) {
        expect(entry.count).toBe(100);
        expect(entry.rule).toBeTruthy();
        expect([0, 1, 2, 3]).toContain(entry.severity);
      }

      // Summary should match the full job
      expect(stats!.summary.totalIssues).toBe(600);
      expect(stats!.jobId).toBe('job-realistic');
    });

    it('should return top paths sorted by count', async () => {
      const job = createRealisticLargeJobResult(600);
      await storage.storeJob(job);

      const stats = await storage.getJobStats('job-realistic');
      expect(stats!.topPaths).toBeDefined();
      expect(stats!.topPaths.length).toBeGreaterThan(0);

      // Verify sorted by count descending
      for (let i = 1; i < stats!.topPaths.length; i++) {
        expect(stats!.topPaths[i].count).toBeLessThanOrEqual(stats!.topPaths[i - 1].count);
      }
    });

    it('should return null for non-existent job', async () => {
      const stats = await storage.getJobStats('nonexistent');
      expect(stats).toBeNull();
    });

    it('should handle job with zero issues', async () => {
      const job = createLargeJobResult(0);
      await storage.storeJob(job);

      const stats = await storage.getJobStats('job-large');
      expect(stats).not.toBeNull();
      expect(stats!.ruleBreakdown).toHaveLength(0);
      expect(stats!.topPaths).toHaveLength(0);
      expect(stats!.summary.totalIssues).toBe(0);
    });

    it('should include truncation info when present', async () => {
      const job = createLargeJobResult(100);
      job.truncated = true;
      job.truncationInfo = { limit: 100, actualCount: 50000 };
      await storage.storeJob(job);

      const stats = await storage.getJobStats('job-large');
      expect(stats!.truncated).toBe(true);
      expect(stats!.truncationInfo).toEqual({ limit: 100, actualCount: 50000 });
    });
  });

  // ============================================
  // Truncation markers
  // ============================================

  describe('truncation handling', () => {
    it('should include truncation info in paginated queries', async () => {
      const job = createLargeJobResult(100);
      job.truncated = true;
      job.truncationInfo = { limit: 100, actualCount: 50000 };
      await storage.storeJob(job);

      const result = await storage.queryJobResults('job-large', { offset: 0, limit: 10 });
      expect(result!.truncated).toBe(true);
      expect(result!.truncationInfo).toEqual({ limit: 100, actualCount: 50000 });
    });

    it('should not include truncation when not truncated', async () => {
      const job = createLargeJobResult(100);
      await storage.storeJob(job);

      const result = await storage.queryJobResults('job-large', { offset: 0, limit: 10 });
      expect(result!.truncated).toBeUndefined();
      expect(result!.truncationInfo).toBeUndefined();
    });
  });

  // ============================================
  // Performance sanity checks
  // ============================================

  describe('performance', () => {
    it('should handle 10,000 issues with pagination in < 50ms', async () => {
      const job = createLargeJobResult(10000);
      await storage.storeJob(job);

      const start = Date.now();
      const result = await storage.queryJobResults('job-large', {
        severity: 0,
        offset: 0,
        limit: 50
      });
      const elapsed = Date.now() - start;

      expect(result).not.toBeNull();
      expect(result!.results).toHaveLength(50);
      expect(elapsed).toBeLessThan(50);
    });

    it('should compute stats for 10,000 issues in < 100ms', async () => {
      const job = createLargeJobResult(10000);
      await storage.storeJob(job);

      const start = Date.now();
      const stats = await storage.getJobStats('job-large');
      const elapsed = Date.now() - start;

      expect(stats).not.toBeNull();
      expect(elapsed).toBeLessThan(100);
    });
  });
});
