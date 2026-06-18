/**
 * Storage Adapter Interface for OpenAPI Lint Orchestrator
 * 
 * Defines the contract for storing and retrieving lint job results.
 * Implementations can use different backends (memory, Redis, database, etc.)
 * 
 * @module storage/storage-adapter
 */

import type { LintJobResult, ListJobsOptions, JobSummary, DocumentLintActivity, LintResultQueryOptions, PaginatedLintResult, LintResultStats } from '../types.js';

/**
 * Storage configuration options
 */
export interface StorageOptions {
  /**
   * Time-to-live for cached results in seconds
   * If undefined, results never expire
   */
  ttl?: number;

  /**
   * Additional backend-specific options
   */
  [key: string]: any;
}

/**
 * Storage statistics
 */
export interface StorageStats {
  /**
   * Total number of jobs stored
   */
  totalJobs: number;

  /**
   * Total number of results across all jobs
   */
  totalResults: number;

  /**
   * Approximate storage size in bytes (if available)
   */
  storageSize?: number;

  /**
   * Number of expired entries (if TTL enabled)
   */
  expiredEntries?: number;

  /**
   * Failure statistics
   */
  failureStats?: {
    totalFailed: number;
    totalTimeout: number;
    totalCompleted: number;
    failureRate: number;
  };

  /**
   * Backend-specific metrics
   */
  [key: string]: any;
}

/**
 * Abstract storage adapter interface
 * 
 * All storage implementations must implement this interface.
 * Provides methods for storing, retrieving, and managing lint job results.
 */
export interface LintResultStorage {
  /**
   * Initialize the storage backend
   * 
   * @param options - Storage configuration options
   */
  initialize?(options?: StorageOptions): Promise<void>;

  /**
   * Store complete job result
   * 
   * @param result - The complete lint job result
   * @throws {Error} If storage operation fails
   */
  storeJob(result: LintJobResult): Promise<void>;

  /**
   * Retrieve job result by job ID
   * 
   * @param jobId - The unique job identifier
   * @returns The job result, or null if not found or expired
   */
  retrieveJobById(jobId: string): Promise<LintJobResult | null>;

  /**
   * Retrieve job result by document + ruleset combination
   * 
   * Useful for checking if results already exist for a specific
   * document and ruleset combination (caching).
   * 
   * @param documentId - The document identifier
   * @param rulesetName - The ruleset name
   * @param rulesetVersion - The ruleset version
   * @returns The most recent job result, or null if not found or expired
   */
  retrieveJob(
    documentId: string,
    rulesetName: string,
    rulesetVersion: string
  ): Promise<LintJobResult | null>;

  /**
   * Check if cached results exist for a document + ruleset
   * 
   * More efficient than retrieveJob when you only need existence check.
   * 
   * @param documentId - The document identifier
   * @param rulesetName - The ruleset name
   * @param rulesetVersion - The ruleset version
   * @returns True if results exist and haven't expired
   */
  exists(
    documentId: string,
    rulesetName: string,
    rulesetVersion: string
  ): Promise<boolean>;

  /**
   * Invalidate all results for a specific document
   * 
   * Useful when a document is updated and all cached results
   * should be discarded.
   * 
   * @param documentId - The document identifier
   * @returns Number of invalidated jobs
   */
  invalidate(documentId: string): Promise<number>;

  /**
   * Get storage statistics
   * 
   * @returns Storage statistics including total jobs, results, and size
   */
  getStats(): Promise<StorageStats>;

  /**
   * List jobs with filtering and pagination
   * 
   * @param options - Filter and pagination options
   * @returns Array of job summaries (lightweight, documentId only)
   */
  listJobs?(options?: ListJobsOptions): Promise<JobSummary[]>;

  /**
   * Retrieve job results with pagination and filtering
   * 
   * @param jobId - The unique job identifier
   * @param options - Pagination and filter options
   * @returns Paginated result set with metadata
   */
  queryJobResults?(jobId: string, options: LintResultQueryOptions): Promise<PaginatedLintResult | null>;

  /**
   * Get aggregated statistics for a job's lint results
   * 
   * @param jobId - The unique job identifier
   * @returns Aggregated stats including rule breakdown and top paths
   */
  getJobStats?(jobId: string): Promise<LintResultStats | null>;

  /**
   * Get lint activity for a specific document
   * 
   * @param documentId - The document identifier
   * @returns Document lint activity summary
   */
  getDocumentLintActivity?(documentId: string): Promise<DocumentLintActivity | null>;

  /**
   * Clear all stored data
   * 
   * USE WITH CAUTION: This removes all job results.
   * 
   * @returns Number of jobs cleared
   */
  clear?(): Promise<number>;

  /**
   * Close/cleanup storage connection
   * 
   * Called during graceful shutdown. Implementations should
   * close connections, flush buffers, etc.
   */
  close?(): Promise<void>;
}

/**
 * Create composite key for document + ruleset lookups
 * 
 * @param documentId - The document identifier
 * @param rulesetName - The ruleset name
 * @param rulesetVersion - The ruleset version
 * @returns Composite key string
 */
export function makeCompositeKey(
  documentId: string,
  rulesetName: string,
  rulesetVersion: string
): string {
  return `${documentId}:${rulesetName}:${rulesetVersion}`;
}

/**
 * Parse composite key back into components
 * 
 * @param key - Composite key string
 * @returns Parsed components or null if invalid
 */
export function parseCompositeKey(key: string): {
  documentId: string;
  rulesetName: string;
  rulesetVersion: string;
} | null {
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  
  return {
    documentId: parts[0],
    rulesetName: parts[1],
    rulesetVersion: parts[2]
  };
}
