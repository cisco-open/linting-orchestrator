/**
 * In-Memory Storage Implementation for OpenAPI Lint Orchestrator
 * 
 * Fast, local storage implementation using JavaScript Maps.
 * Suitable for development, testing, and single-instance deployments.
 * 
 * Features:
 * - Optional TTL (time-to-live) support with automatic expiration
 * - Fast O(1) lookups by job ID
 * - Efficient indexing by document ID for invalidation
 * - Memory-efficient storage with periodic cleanup
 * 
 * Limitations:
 * - Data lost on process restart
 * - Not shared across multiple instances
 * - Memory usage grows with stored jobs
 * 
 * @module storage/memory-storage
 */

import type { LintJobResult, LintIssue, ListJobsOptions, JobSummary, DocumentLintActivity, JobStatus, LintResultQueryOptions, PaginatedLintResult, LintResultStats, RuleBreakdownEntry } from '../types.js';
import type {
  LintResultStorage,
  StorageOptions,
  StorageStats
} from './storage-adapter.js';
import { makeCompositeKey } from './storage-adapter.js';

/**
 * Storage entry with metadata
 */
interface StorageEntry {
  result: LintJobResult;
  storedAt: Date;
  expiresAt?: Date;
}

/**
 * In-memory storage implementation
 * 
 * Uses JavaScript Maps for fast lookups and indexing.
 */
export class MemoryLintStorage implements LintResultStorage {
  /**
   * Main storage: jobId -> StorageEntry
   */
  private jobResults = new Map<string, StorageEntry>();

  /**
   * Index: documentId -> Set of jobIds
   * Used for efficient invalidation of all jobs for a document
   */
  private documentIndex = new Map<string, Set<string>>();

  /**
   * Index: composite key -> jobId
   * Used for retrieving results by document + ruleset
   */
  private compositeIndex = new Map<string, string>();

  /**
   * Index: status -> Set of jobIds
   * Used for efficient filtering by job status
   */
  private statusIndex = new Map<JobStatus, Set<string>>();

  /**
   * Index: rulesetName -> Set of jobIds
   * Used for efficient filtering by ruleset
   */
  private rulesetIndex = new Map<string, Set<string>>();

  /**
   * Index: timestamp -> jobId (sorted)
   * Used for efficient time-based filtering and sorting
   */
  private timestampIndex: Array<{ timestamp: number; jobId: string }> = [];

  /**
   * TTL in milliseconds (if enabled)
   */
  private ttlMs?: number;

  /**
   * Cleanup interval timer
   */
  private cleanupInterval?: NodeJS.Timeout;

  /**
   * Statistics
   */
  private stats = {
    totalStored: 0,
    totalExpired: 0,
    totalInvalidated: 0
  };

  /**
   * Initialize storage with optional configuration
   * 
   * @param options - Storage options including TTL
   */
  async initialize(options?: StorageOptions): Promise<void> {
    if (options?.ttl) {
      this.ttlMs = options.ttl * 1000; // Convert seconds to milliseconds
      
      // Start periodic cleanup every minute
      // Use unref() to allow process to exit if this is the only active timer
      this.cleanupInterval = setInterval(() => {
        this.cleanupExpired();
      }, 60000);
      this.cleanupInterval.unref();
    }
  }

  /**
   * Store complete job result
   * 
   * @param result - The lint job result
   */
  async storeJob(result: LintJobResult): Promise<void> {
    const entry: StorageEntry = {
      result,
      storedAt: new Date(),
      expiresAt: this.ttlMs ? new Date(Date.now() + this.ttlMs) : undefined
    };

    // Store by job ID
    this.jobResults.set(result.jobId, entry);

    // Index by document ID
    if (!this.documentIndex.has(result.documentId)) {
      this.documentIndex.set(result.documentId, new Set());
    }
    this.documentIndex.get(result.documentId)!.add(result.jobId);

    // Index by composite key (document + ruleset + version)
    const compositeKey = makeCompositeKey(
      result.documentId,
      result.rulesetName,
      result.rulesetVersion
    );
    this.compositeIndex.set(compositeKey, result.jobId);

    // Index by status
    if (!this.statusIndex.has(result.status)) {
      this.statusIndex.set(result.status, new Set());
    }
    this.statusIndex.get(result.status)!.add(result.jobId);

    // Index by ruleset
    if (!this.rulesetIndex.has(result.rulesetName)) {
      this.rulesetIndex.set(result.rulesetName, new Set());
    }
    this.rulesetIndex.get(result.rulesetName)!.add(result.jobId);

    // Index by timestamp (maintain sorted order)
    const timestamp = result.timestamp.getTime();
    this.timestampIndex.push({ timestamp, jobId: result.jobId });
    // Keep sorted by timestamp (descending - newest first)
    this.timestampIndex.sort((a, b) => b.timestamp - a.timestamp);

    this.stats.totalStored++;
  }

  /**
   * Retrieve job result by job ID
   * 
   * @param jobId - The job identifier
   * @returns The job result, or null if not found or expired
   */
  async retrieveJobById(jobId: string): Promise<LintJobResult | null> {
    const entry = this.jobResults.get(jobId);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      await this.removeEntry(jobId);
      return null;
    }

    return entry.result;
  }

  /**
   * Retrieve job result by document + ruleset
   * 
   * @param documentId - The document identifier
   * @param rulesetName - The ruleset name
   * @param rulesetVersion - The ruleset version
   * @returns The job result, or null if not found or expired
   */
  async retrieveJob(
    documentId: string,
    rulesetName: string,
    rulesetVersion: string
  ): Promise<LintJobResult | null> {
    const compositeKey = makeCompositeKey(documentId, rulesetName, rulesetVersion);
    const jobId = this.compositeIndex.get(compositeKey);

    if (!jobId) {
      return null;
    }

    return this.retrieveJobById(jobId);
  }

  /**
   * Check if cached results exist
   * 
   * @param documentId - The document identifier
   * @param rulesetName - The ruleset name
   * @param rulesetVersion - The ruleset version
   * @returns True if results exist and haven't expired
   */
  async exists(
    documentId: string,
    rulesetName: string,
    rulesetVersion: string
  ): Promise<boolean> {
    const result = await this.retrieveJob(documentId, rulesetName, rulesetVersion);
    return result !== null;
  }

  /**
   * Invalidate all results for a document
   * 
   * @param documentId - The document identifier
   * @returns Number of invalidated jobs
   */
  async invalidate(documentId: string): Promise<number> {
    const jobIds = this.documentIndex.get(documentId);
    
    if (!jobIds || jobIds.size === 0) {
      return 0;
    }

    let count = 0;
    for (const jobId of jobIds) {
      await this.removeEntry(jobId);
      count++;
    }

    this.documentIndex.delete(documentId);
    this.stats.totalInvalidated += count;

    return count;
  }

  /**
   * Get storage statistics
   * 
   * @returns Storage statistics
   */
  async getStats(): Promise<StorageStats> {
    // Calculate total results and failure stats
    let totalResults = 0;
    let storageSize = 0;
    let totalFailed = 0;
    let totalTimeout = 0;
    let totalCompleted = 0;

    for (const entry of this.jobResults.values()) {
      totalResults += entry.result.results.length;
      // Rough estimate of storage size
      storageSize += JSON.stringify(entry.result).length;
      
      // Track failure statistics
      if (entry.result.status === 'failed') {
        totalFailed++;
      } else if (entry.result.status === 'timeout') {
        totalTimeout++;
      } else if (entry.result.status === 'completed' || entry.result.status === 'completed_with_errors') {
        totalCompleted++;
      }
    }

    const totalJobs = this.jobResults.size;
    const failureRate = totalJobs > 0 ? (totalFailed + totalTimeout) / totalJobs : 0;

    return {
      totalJobs,
      totalResults,
      storageSize,
      expiredEntries: this.stats.totalExpired,
      failureStats: {
        totalFailed,
        totalTimeout,
        totalCompleted,
        failureRate
      },
      totalStored: this.stats.totalStored,
      totalInvalidated: this.stats.totalInvalidated,
      activeJobs: this.jobResults.size,
      indexedDocuments: this.documentIndex.size,
      compositeKeys: this.compositeIndex.size
    };
  }

  /**
   * Clear all stored data
   * 
   * @returns Number of jobs cleared
   */
  async clear(): Promise<number> {
    const count = this.jobResults.size;
    
    this.jobResults.clear();
    this.documentIndex.clear();
    this.compositeIndex.clear();
    this.statusIndex.clear();
    this.rulesetIndex.clear();
    this.timestampIndex = [];

    return count;
  }

  /**
   * Close storage and cleanup resources
   */
  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Final cleanup
    await this.clear();
  }

  /**
   * Check if entry has expired
   * 
   * @param entry - Storage entry
   * @returns True if expired
   */
  private isExpired(entry: StorageEntry): boolean {
    if (!entry.expiresAt) {
      return false;
    }

    return Date.now() > entry.expiresAt.getTime();
  }

  /**
   * Remove a single entry and update indexes
   * 
   * @param jobId - Job identifier
   */
  private async removeEntry(jobId: string): Promise<void> {
    const entry = this.jobResults.get(jobId);
    
    if (!entry) {
      return;
    }

    const result = entry.result;

    // Remove from main storage
    this.jobResults.delete(jobId);

    // Remove from document index
    const documentJobs = this.documentIndex.get(result.documentId);
    if (documentJobs) {
      documentJobs.delete(jobId);
      if (documentJobs.size === 0) {
        this.documentIndex.delete(result.documentId);
      }
    }

    // Remove from composite index
    const compositeKey = makeCompositeKey(
      result.documentId,
      result.rulesetName,
      result.rulesetVersion
    );
    
    // Only remove if this job is the current entry for this composite key
    if (this.compositeIndex.get(compositeKey) === jobId) {
      this.compositeIndex.delete(compositeKey);
    }

    // Remove from status index
    const statusJobs = this.statusIndex.get(result.status);
    if (statusJobs) {
      statusJobs.delete(jobId);
      if (statusJobs.size === 0) {
        this.statusIndex.delete(result.status);
      }
    }

    // Remove from ruleset index
    const rulesetJobs = this.rulesetIndex.get(result.rulesetName);
    if (rulesetJobs) {
      rulesetJobs.delete(jobId);
      if (rulesetJobs.size === 0) {
        this.rulesetIndex.delete(result.rulesetName);
      }
    }

    // Remove from timestamp index
    const timestampIdx = this.timestampIndex.findIndex(item => item.jobId === jobId);
    if (timestampIdx !== -1) {
      this.timestampIndex.splice(timestampIdx, 1);
    }

    if (this.isExpired(entry)) {
      this.stats.totalExpired++;
    }
  }

  /**
   * Clean up expired entries
   * 
   * Called periodically when TTL is enabled.
   * 
   * @returns Number of entries cleaned up
   */
  private cleanupExpired(): number {
    if (!this.ttlMs) {
      return 0;
    }

    let count = 0;
    const jobsToRemove: string[] = [];

    // Find expired entries
    for (const [jobId, entry] of this.jobResults.entries()) {
      if (this.isExpired(entry)) {
        jobsToRemove.push(jobId);
      }
    }

    // Remove them
    for (const jobId of jobsToRemove) {
      this.removeEntry(jobId);
      count++;
    }

    return count;
  }

  /**
   * List jobs with filtering and pagination
   * 
   * @param options - Filter and pagination options
   * @returns Array of job summaries (lightweight, documentId only)
   */
  async listJobs(options: ListJobsOptions = {}): Promise<JobSummary[]> {
    const {
      status,
      documentId,
      rulesetName,
      startDate,
      endDate,
      // sessionId,  // Future: filter by runtime session ID
      limit = 50,
      offset = 0,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = options;

    // Start with all job IDs
    let candidateJobIds: Set<string> = new Set(this.jobResults.keys());

    // Apply filters using indexes for efficiency
    if (status) {
      const statusArray = Array.isArray(status) ? status : [status];
      const statusMatches = new Set<string>();
      for (const s of statusArray) {
        const jobIds = this.statusIndex.get(s);
        if (jobIds) {
          jobIds.forEach(id => statusMatches.add(id));
        }
      }
      candidateJobIds = new Set([...candidateJobIds].filter(id => statusMatches.has(id)));
    }

    if (documentId) {
      const docJobs = this.documentIndex.get(documentId) || new Set();
      candidateJobIds = new Set([...candidateJobIds].filter(id => docJobs.has(id)));
    }

    if (rulesetName) {
      const rulesetJobs = this.rulesetIndex.get(rulesetName) || new Set();
      candidateJobIds = new Set([...candidateJobIds].filter(id => rulesetJobs.has(id)));
    }

    // Filter by date range and sessionId (requires full scan of candidates)
    const filteredResults: LintJobResult[] = [];
    for (const jobId of candidateJobIds) {
      const entry = this.jobResults.get(jobId);
      if (!entry || this.isExpired(entry)) {
        continue;
      }

      const result = entry.result;

      // Date range filter
      if (startDate && result.timestamp < startDate) continue;
      if (endDate && result.timestamp > endDate) continue;

      // Session ID filter (if provided)
      // Note: sessionId would need to be added to LintJobResult in future
      // For now, we skip this filter
      // if (sessionId && result.sessionId !== sessionId) continue;

      filteredResults.push(result);
    }

    // Sort results
    filteredResults.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'timestamp':
          comparison = a.timestamp.getTime() - b.timestamp.getTime();
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'documentId':
          comparison = a.documentId.localeCompare(b.documentId);
          break;
        case 'rulesetName':
          comparison = a.rulesetName.localeCompare(b.rulesetName);
          break;
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });

    // Apply pagination
    const paginatedResults = filteredResults.slice(offset, offset + limit);

    // Convert to JobSummary (lightweight, documentId only)
    return paginatedResults.map(result => ({
      jobId: result.jobId,
      documentId: result.documentId,  // ID only, no metadata
      rulesetName: result.rulesetName,
      rulesetVersion: result.rulesetVersion,
      status: result.status,
      timestamp: result.timestamp,
      totalExecutionTime: result.totalExecutionTime,
      summary: result.summary
    }));
  }

  /**
   * Get lint activity for a specific document
   * 
   * @param documentId - The document identifier
   * @returns Document lint activity summary
   */
  async getDocumentLintActivity(documentId: string): Promise<DocumentLintActivity | null> {
    const jobIds = this.documentIndex.get(documentId);
    
    if (!jobIds || jobIds.size === 0) {
      return null;
    }

    const jobsByStatus: Record<string, number> = {};
    const jobsByRuleset: Record<string, number> = {};
    let lastLintedAt: Date | undefined;
    let totalJobs = 0;

    for (const jobId of jobIds) {
      const entry = this.jobResults.get(jobId);
      if (!entry || this.isExpired(entry)) {
        continue;
      }

      const result = entry.result;
      totalJobs++;

      // Track by status
      jobsByStatus[result.status] = (jobsByStatus[result.status] || 0) + 1;

      // Track by ruleset
      jobsByRuleset[result.rulesetName] = (jobsByRuleset[result.rulesetName] || 0) + 1;

      // Track most recent lint
      if (!lastLintedAt || result.timestamp > lastLintedAt) {
        lastLintedAt = result.timestamp;
      }
    }

    return {
      documentId,
      totalJobs,
      lastLintedAt,
      jobsByStatus: jobsByStatus as Record<JobStatus, number>,
      jobsByRuleset
    };
  }

  /**
   * Get all job IDs for a document (for testing/debugging)
   * 
   * @param documentId - Document identifier
   * @returns Set of job IDs
   */
  getJobsForDocument(documentId: string): Set<string> {
    return this.documentIndex.get(documentId) || new Set();
  }

  /**
   * Get all stored job IDs (for testing/debugging)
   * 
   * @returns Array of job IDs
   */
  getAllJobIds(): string[] {
    return Array.from(this.jobResults.keys());
  }

  // ============================================
  // Paginated Result Queries
  // ============================================

  /**
   * Filter issues based on query options
   */
  private filterIssues(issues: LintIssue[], options: LintResultQueryOptions): LintIssue[] {
    let filtered = issues;

    if (options.severity !== undefined) {
      filtered = filtered.filter(i => i.severity === options.severity);
    }

    if (options.rule) {
      filtered = filtered.filter(i => i.ruleId === options.rule || i.code === options.rule);
    }

    if (options.pathPrefix) {
      const prefix = options.pathPrefix;
      filtered = filtered.filter(i => {
        const pathStr = i.path.join('.');
        return pathStr.startsWith(prefix);
      });
    }

    return filtered;
  }

  /**
   * Retrieve job results with pagination and filtering
   */
  async queryJobResults(jobId: string, options: LintResultQueryOptions): Promise<PaginatedLintResult | null> {
    const entry = this.jobResults.get(jobId);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      await this.removeEntry(jobId);
      return null;
    }

    const result = entry.result;
    const hasFilters = options.severity !== undefined || options.rule !== undefined || options.pathPrefix !== undefined;
    const hasPagination = options.offset !== undefined || options.limit !== undefined;

    // Apply filters
    const filtered = hasFilters ? this.filterIssues(result.results, options) : result.results;
    const totalMatching = filtered.length;

    // Apply pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? filtered.length;
    const paginated = filtered.slice(offset, offset + limit);

    const response: PaginatedLintResult = {
      jobId: result.jobId,
      documentId: result.documentId,
      rulesetName: result.rulesetName,
      rulesetVersion: result.rulesetVersion,
      status: result.status,
      timestamp: result.timestamp,
      totalExecutionTime: result.totalExecutionTime,
      summary: result.summary,
      results: paginated,
    };

    if (hasPagination) {
      response.pagination = {
        offset,
        limit,
        returned: paginated.length,
        totalMatching,
        hasMore: offset + paginated.length < totalMatching,
      };
    }

    if (hasFilters) {
      response.filters = {
        severity: options.severity ?? null,
        rule: options.rule ?? null,
        pathPrefix: options.pathPrefix ?? null,
      };
    }

    if (result.truncated) {
      response.truncated = result.truncated;
      response.truncationInfo = result.truncationInfo;
    }

    return response;
  }

  /**
   * Get aggregated statistics for a job's lint results
   */
  async getJobStats(jobId: string): Promise<LintResultStats | null> {
    const entry = this.jobResults.get(jobId);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      await this.removeEntry(jobId);
      return null;
    }

    const result = entry.result;
    const issues = result.results;

    // Build rule breakdown: count issues per rule, track severity
    const ruleMap = new Map<string, { count: number; severity: 0 | 1 | 2 | 3 }>();
    for (const issue of issues) {
      const rule = issue.ruleId || issue.code;
      const existing = ruleMap.get(rule);
      if (existing) {
        existing.count++;
      } else {
        ruleMap.set(rule, { count: 1, severity: issue.severity });
      }
    }

    const ruleBreakdown: RuleBreakdownEntry[] = Array.from(ruleMap.entries())
      .map(([rule, data]) => ({ rule, count: data.count, severity: data.severity }))
      .sort((a, b) => b.count - a.count);

    // Build top paths: group by first 2 path segments (e.g., "paths./pets")
    const pathMap = new Map<string, number>();
    for (const issue of issues) {
      if (issue.path.length >= 2) {
        const prefix = issue.path.slice(0, 2).join('.');
        pathMap.set(prefix, (pathMap.get(prefix) || 0) + 1);
      }
    }

    const topPaths = Array.from(pathMap.entries())
      .map(([pathPrefix, count]) => ({ pathPrefix, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20); // Top 20 paths

    const stats: LintResultStats = {
      jobId: result.jobId,
      documentId: result.documentId,
      rulesetName: result.rulesetName,
      rulesetVersion: result.rulesetVersion,
      status: result.status,
      summary: result.summary,
      ruleBreakdown,
      topPaths,
    };

    if (result.truncated) {
      stats.truncated = result.truncated;
      stats.truncationInfo = result.truncationInfo;
    }

    return stats;
  }
}
