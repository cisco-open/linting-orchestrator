// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Job Orchestrator
 * 
 * Manages the complete lifecycle of lint jobs:
 * - Job submission and queue management
 * - Task distribution to worker pool
 * - Result aggregation
 * - Retry logic with exponential backoff
 * - Job status tracking
 * 
 * Architecture:
 * - One job = one document + one ruleset
 * - Job creates tasks for execution
 * - Tasks executed by worker pool
 * - Results aggregated and stored
 * 
 * @module orchestrator
 */

import { randomUUID } from 'crypto';
import { WorkerPoolManager, ExecuteTaskRequest, TaskResult } from './worker-pool.js';
import { RulesetLoader } from './ruleset-loader.js';
import type { DocumentStoreAdapter } from '@cisco-open/linting-document-store';
import { LintResultStorage } from './storage/storage-adapter.js';
import { ReportServiceClient, CLIENT_VERSION } from '@cisco-open/linting-reports/client';
import type { ReportServiceConfig } from './types.js';
import type {
  LintJob,
  LintJobRequest,
  LintJobResult,
  RuleOverrides,
  RulesetExecutionResult,
  RuleTask,
  WorkerPoolConfig,
  ListJobsOptions,
  JobSummary,
  JobDetailed,
  ListJobsResponse,
  DocumentLintActivity
} from './types.js';

// ============================================
// Custom Error Classes
// ============================================

/**
 * Thrown when the orchestrator has reached its maximum concurrent job capacity.
 * The HTTP layer should translate this into a 429 Too Many Requests response.
 */
export class CapacityExceededError extends Error {
  public readonly activeJobs: number;
  public readonly maxJobs: number;

  constructor(message: string, activeJobs: number, maxJobs: number) {
    super(message);
    this.name = 'CapacityExceededError';
    this.activeJobs = activeJobs;
    this.maxJobs = maxJobs;
  }
}

// ============================================
// Orchestrator Configuration
// ============================================

export interface OrchestratorConfig {
  workerPool: WorkerPoolConfig;
  maxConcurrentJobs?: number;
  enableCache?: boolean;
  reportService?: ReportServiceConfig;
  /** Maximum number of issues to collect per job (safety limit). Default: 100000 */
  maxIssuesPerJob?: number;
}

// ============================================
// Job Orchestrator
// ============================================

export class Orchestrator {
  private jobs: Map<string, LintJob> = new Map();
  private config: OrchestratorConfig;
  private initialized = false;
  private cacheHits = 0;
  private cacheMisses = 0;
  private activeJobCount = 0; // O(1) atomic counter for active (queued + running) jobs
  private reportClient: ReportServiceClient | null = null;
  private reportServiceConfig: typeof this.config.reportService = undefined;

  constructor(
    private workerPool: WorkerPoolManager,
    private storage: LintResultStorage,
    private rulesetLoader: RulesetLoader,
    private documentStore: DocumentStoreAdapter,
    config: OrchestratorConfig
  ) {
    this.config = {
      maxConcurrentJobs: 100,
      enableCache: true,
      maxIssuesPerJob: 100000,
      ...config
    };
  }

  /**
   * Initialize orchestrator
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('🔧 Initializing Job Orchestrator...');

    // Storage initialization handled externally
    console.log('   ✅ Storage initialized');

    // Worker pool should already be initialized
    console.log('   ✅ Worker pool ready');

    // Initialize Report Service integration if configured
    await this.initializeReportClient();

    this.initialized = true;
    console.log('✅ Job Orchestrator initialized\n');
  }

  /**
   * Initialize Report Service client integration
   * 
   * Requirements:
   * - Info logs on successful start showing version compatibility
   * - Always try to start if configured, warn if unavailable (graceful degradation)
   * - stopIfUnavailable flag to fail startup for production safety
   */
  private async initializeReportClient(): Promise<void> {
    if (!this.config.reportService?.enabled) {
      return;
    }

    const config = this.config.reportService;
    this.reportServiceConfig = config;
    console.log(`🔗 Initializing Report Service integration...`);
    console.log(`   URL: ${config.url}`);
    console.log(`   Client Version: ${CLIENT_VERSION}`);

    // Always create client instance - it handles connection failures gracefully
    this.reportClient = new ReportServiceClient({
      url: config.url,
      apiKey: config.apiKey,
      timeout: config.timeout,
      maxRetries: config.maxRetries,
      baseRetryDelay: config.baseRetryDelay,
      pendingDir: config.pendingDir,
      enableRetryJob: config.enableRetryJob,
      retryJobInterval: config.retryJobInterval,
    });

    await this.reportClient.initialize();

    // Test connectivity, but don't fail if unavailable
    try {
      const compatibility = await this.reportClient.checkCompatibility();

      if (compatibility.compatible) {
        console.log(`   ✅ Report Service CONNECTED`);
        console.log(`   Server Version: ${compatibility.serverVersion}`);
        console.log(`   Status: Compatible`);
      } else {
        const message = `Report Service version incompatible (server: ${compatibility.serverVersion}, client: ${CLIENT_VERSION})`;
        console.warn(`   ⚠️  ${message}`);
        if (compatibility.details) {
          console.warn(`   Details: ${compatibility.details}`);
        }

        if (config.stopIfUnavailable) {
          throw new Error(`${message} - startup blocked by stopIfUnavailable flag`);
        }

        console.warn(`   Continuing in DEGRADED MODE (notifications will queue to pending directory)`);
      }
    } catch (error: any) {
      const message = `Report Service unavailable: ${error.message}`;

      if (config.stopIfUnavailable) {
        console.error(`   ❌ ${message} (startup blocked by stopIfUnavailable flag)`);
        throw new Error(message);
      }

      console.warn(`   ⚠️  ${message}`);
      console.warn(`   Continuing in DEGRADED MODE (notifications will queue to pending directory)`);
    }
  }

  /**
   * Submit a new lint job
   */
  async submitJob(request: LintJobRequest): Promise<string> {
    if (!this.initialized) {
      throw new Error('Orchestrator not initialized');
    }

    const { documentId, rulesetName, rulesetVersion, callbackUrl, ruleOverrides, options } = request;

    // Enforce concurrent job capacity (backpressure)
    const maxConcurrent = this.config.maxConcurrentJobs ?? 100;
    if (this.activeJobCount >= maxConcurrent) {
      console.warn(`⚠️  Job rejected: capacity exceeded (${this.activeJobCount}/${maxConcurrent} active jobs)`);
      throw new CapacityExceededError(
        `Server at capacity: ${this.activeJobCount}/${maxConcurrent} concurrent jobs. Retry after a short delay.`,
        this.activeJobCount,
        maxConcurrent
      );
    }

    // Check cache first (if enabled)
    if (this.config.enableCache && !options?.forceRun) {
      const cached = await this.checkCache(documentId, rulesetName, rulesetVersion, ruleOverrides);
      if (cached) {
        this.cacheHits++;
        console.log(`📦 Cache hit for ${documentId} + ${rulesetName} - returning cached result`);
        return cached.jobId;
      }
    }

    // Verify document exists
    const documentExists = await this.documentStore.documentExists(documentId);
    if (!documentExists) {
      throw new Error(`Document not found: ${documentId}`);
    }

    // Cache miss - create new job
    this.cacheMisses++;

    // Resolve ruleset version
    const version = rulesetVersion || this.rulesetLoader.getMetadata(rulesetName).defaultVersion;

    // Create job
    const jobId = randomUUID();
    const job: LintJob = {
      jobId,
      documentId,
      rulesetName,
      rulesetVersion: version,
      callbackUrl,
      ruleOverrides,
      status: 'queued',
      progress: {
        totalTasks: 1,
        completedTasks: 0,
        failedTasks: 0,
        timeoutTasks: 0,
        runningTasks: 0,
        queuedTasks: 1
      },
      startTime: new Date(),
      priority: options?.priority || 'normal',
      tasks: []
    };

    // Create task for execution
    const task: RuleTask = {
      taskId: randomUUID(),
      jobId,
      documentId,
      documentPath: await this.documentStore.getDocumentPath(documentId),
      rulesetName,
      rulesetVersion: version,
      ruleOverrides,
      status: 'queued',
      attempt: 0,
      maxAttempts: this.config.workerPool?.maxRetries || 3
    };

    job.tasks.push(task);
    this.jobs.set(jobId, job);
    this.activeJobCount++; // Increment active job counter

    console.log(`📝 Job submitted: ${jobId} (${documentId} + ${rulesetName}@${version}) [active: ${this.activeJobCount}/${maxConcurrent}]`);

    // Execute job asynchronously
    this.executeJob(job).catch(error => {
      console.error(`❌ Job ${jobId} failed:`, error);
      job.status = 'failed';
      job.endTime = job.endTime || new Date();

      // Build a minimal failure result so callback/notification still fires
      const failureResult: LintJobResult = {
        jobId: job.jobId,
        documentId: job.documentId,
        rulesetName: job.rulesetName,
        rulesetVersion: job.rulesetVersion,
        ruleOverrides: job.ruleOverrides,
        status: 'failed',
        timestamp: job.endTime,
        totalExecutionTime: job.endTime.getTime() - (job.startTime?.getTime() || job.endTime.getTime()),
        summary: { totalIssues: 0, errorCount: 0, warningCount: 0, infoCount: 0, hintCount: 0 },
        results: [],
        executionDetails: {
          rulesetName: job.rulesetName,
          rulesetVersion: job.rulesetVersion,
          executionTime: 0,
          success: false,
          issueCount: 0,
          issues: [],
          metadata: { ruleEngine: 'spectral', documentId: job.documentId }
        }
      };

      // Store failure result (best-effort)
      this.storage.storeJob(failureResult).catch(storeErr => {
        console.error(`⚠️  Failed to store failure result for ${jobId}:`, storeErr);
      });

      // Notify Report Service about failure (best-effort)
      this.notifyReportService(failureResult).catch(notifyErr => {
        console.warn(`⚠️  Report Service notification failed for failed job ${jobId}: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`);
      });

      // Deliver callback even on failure
      if (job.callbackUrl) {
        this.deliverCallback(job.callbackUrl, failureResult).catch(cbErr => {
          console.warn(`⚠️  Callback delivery failed for failed job ${jobId}: ${cbErr instanceof Error ? cbErr.message : String(cbErr)}`);
        });
      }
    }).finally(() => {
      this.activeJobCount--; // Decrement active job counter when job completes or fails
    });

    return jobId;
  }

  /**
   * Execute a job (run tasks via worker pool)
   */
  private async executeJob(job: LintJob): Promise<void> {
    job.status = 'running';
    job.startTime = new Date();

    const results: any[] = [];
    const errors: string[] = [];
    const maxIssues = this.config.maxIssuesPerJob ?? 100000;
    let truncated = false;
    let actualPreTruncationCount = 0;

    for (const task of job.tasks) {
      try {
        // Update task status
        task.status = 'running';
        task.attempt++;
        task.startTime = new Date();
        job.progress.runningTasks++;
        job.progress.queuedTasks--;

        // Execute task with retry logic
        const result = await this.executeTaskWithRetry(task);

        // Update task status
        task.status = 'completed';
        task.endTime = new Date();
        task.result = {
          rulesetName: task.rulesetName,
          rulesetVersion: task.rulesetVersion,
          executionTime: result.executionTime,
          success: result.success,
          issueCount: result.issues?.length || 0,
          issues: result.issues || [],
          metadata: {
            ruleEngine: 'spectral',
            documentId: task.documentId,
            cacheHit: result.cacheHit
          }
        };

        job.progress.runningTasks--;
        job.progress.completedTasks++;

        // Collect issues (worker returns 'results' array)
        if (result.results) {
          const incoming = result.results;
          actualPreTruncationCount += incoming.length;
          if (results.length < maxIssues) {
            const remaining = maxIssues - results.length;
            if (incoming.length <= remaining) {
              results.push(...incoming);
            } else {
              results.push(...incoming.slice(0, remaining));
              truncated = true;
              console.warn(`⚠️  Job ${job.jobId}: maxIssuesPerJob limit (${maxIssues}) reached, truncating results`);
            }
          } else {
            truncated = true;
          }
        }

      } catch (error) {
        // Detect timeout vs. other failures
        const isTimeout = error instanceof Error && (error as any).code === 'TIMEOUT';

        task.status = isTimeout ? 'timeout' : 'failed';
        task.endTime = new Date();
        task.error = error instanceof Error ? error.message : String(error);

        job.progress.runningTasks--;
        if (isTimeout) {
          job.progress.timeoutTasks++;
          console.error(`⏱️  Task ${task.taskId} timed out`);
        } else {
          job.progress.failedTasks++;
          console.error(`❌ Task ${task.taskId} failed:`, task.error);
        }

        errors.push(task.error);
      }
    }

    // Job complete - determine final status
    job.endTime = new Date();
    if (job.progress.timeoutTasks > 0) {
      job.status = 'timeout';
    } else if (errors.length > 0) {
      job.status = 'completed_with_errors';
    } else {
      job.status = 'completed';
    }

    // Aggregate and store results
    const taskResult = job.tasks[0]?.result;
    // Avoid duplicating issues in executionDetails — only store metadata
    const executionDetails: RulesetExecutionResult = taskResult ? {
      ...taskResult,
      issues: [], // issues live in results[], not duplicated here
      issueCount: taskResult.issueCount
    } : {
      rulesetName: job.rulesetName,
      rulesetVersion: job.rulesetVersion,
      executionTime: job.endTime.getTime() - job.startTime.getTime(),
      success: errors.length === 0,
      issueCount: results.length,
      issues: [], // issues live in results[], not duplicated here
      metadata: {
        ruleEngine: 'spectral',
        documentId: job.documentId
      }
    };

    const jobResult: LintJobResult = {
      jobId: job.jobId,
      documentId: job.documentId,
      rulesetName: job.rulesetName,
      rulesetVersion: job.rulesetVersion,
      ruleOverrides: job.ruleOverrides,
      status: job.status,
      timestamp: job.endTime,
      totalExecutionTime: job.endTime.getTime() - job.startTime.getTime(),
      summary: {
        totalIssues: results.length,
        errorCount: results.filter(r => r.severity === 0).length,
        warningCount: results.filter(r => r.severity === 1).length,
        infoCount: results.filter(r => r.severity === 2).length,
        hintCount: results.filter(r => r.severity === 3).length
      },
      results,
      executionDetails,
      ...(truncated ? {
        truncated: true,
        truncationInfo: {
          limit: maxIssues,
          actualCount: actualPreTruncationCount
        }
      } : {})
    };

    // Store result (errors here must not block callback/notification delivery)
    try {
      await this.storage.storeJob(jobResult);
      console.log(`✅ Job ${job.jobId} completed: ${results.length} issues found`);
    } catch (error) {
      console.error(`⚠️  Failed to store job result for ${job.jobId}:`, error);
    }

    // Notify Report Service (fire-and-forget, non-blocking)
    // Runs independently — failures here never block callback delivery
    this.notifyReportService(jobResult).catch(err => {
      console.warn(`⚠️  Report Service notification failed for job ${job.jobId}: ${err instanceof Error ? err.message : String(err)}`);
    });

    // Deliver callback if URL was provided (fire-and-forget)
    // Always attempted regardless of storage or notification outcome
    if (job.callbackUrl) {
      this.deliverCallback(job.callbackUrl, jobResult).catch(err => {
        console.warn(`⚠️  Callback delivery failed for job ${job.jobId}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  /**
   * Execute task with exponential backoff retry
   */
  private async executeTaskWithRetry(task: RuleTask): Promise<TaskResult> {
    let lastError: Error | undefined;
    const backoff = this.config.workerPool?.exponentialBackoff || {
      initialDelay: 1000,
      maxDelay: 30000,
      multiplier: 2
    };

    for (let attempt = 1; attempt <= task.maxAttempts; attempt++) {
      try {
        // Execute task via worker pool
        const request: ExecuteTaskRequest = {
          taskId: task.taskId,
          documentId: task.documentId,
          rulesetName: task.rulesetName,
          rulesetVersion: task.rulesetVersion,
          ruleOverrides: task.ruleOverrides,
          timeout: this.config.workerPool?.taskTimeout
        };

        const result = await this.workerPool.executeTask(request);

        if (!result.success) {
          throw new Error(result.error || 'Task execution failed');
        }

        return result;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < task.maxAttempts) {
          // Calculate delay with exponential backoff
          const delay = Math.min(
            backoff.initialDelay * Math.pow(backoff.multiplier, attempt - 1),
            backoff.maxDelay
          );

          console.log(`⚠️  Task ${task.taskId} attempt ${attempt} failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Task failed after all retry attempts');
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<LintJob | null> {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get job result
   */
  async getJobResult(jobId: string): Promise<LintJobResult | null> {
    const job = this.jobs.get(jobId);
    if (!job) {
      // Try to retrieve from storage
      return await this.storage.retrieveJobById(jobId);
    }

    // If job still in progress, return null
    if (job.status === 'queued' || job.status === 'running') {
      return null;
    }

    // Retrieve from storage
    return await this.storage.retrieveJobById(jobId);
  }

  /**
   * Check cache for existing result
   */
  private async checkCache(
    documentId: string,
    rulesetName: string,
    rulesetVersion?: string,
    ruleOverrides?: RuleOverrides
  ): Promise<LintJobResult | null> {
    // Skip cache when rule overrides are present — overrides make results unique
    if (ruleOverrides && Object.keys(ruleOverrides).length > 0) {
      return null;
    }

    try {
      const version = rulesetVersion || this.rulesetLoader.getMetadata(rulesetName).defaultVersion;
      const exists = await this.storage.exists(documentId, rulesetName, version);

      if (exists) {
        return await this.storage.retrieveJob(documentId, rulesetName, version);
      }
    } catch (error) {
      // Cache check failed, continue with new job
      console.warn('Cache check failed:', error);
    }

    return null;
  }

  /**
   * Invalidate cache for a document
   */
  async invalidateCache(documentId: string): Promise<void> {
    await this.storage.invalidate(documentId);
    console.log(`🗑️  Cache invalidated for document: ${documentId}`);
  }

  /**
   * Get orchestrator statistics
   */
  getStats(): {
    jobs: {
      total: number;
      queued: number;
      running: number;
      completed: number;
      failed: number;
    };
    capacity: {
      activeJobs: number;
      maxConcurrentJobs: number;
      utilizationPercent: number;
    };
    cache: {
      hits: number;
      misses: number;
      hitRate: number;
    };
    workers: {
      total: number;
      active: number;
      idle: number;
    };
  } {
    const workerStats = this.workerPool.getStats();
    const maxConcurrent = this.config.maxConcurrentJobs ?? 100;

    const jobStats = {
      total: this.jobs.size,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0
    };

    for (const job of this.jobs.values()) {
      if (job.status === 'queued') jobStats.queued++;
      else if (job.status === 'running') jobStats.running++;
      else if (job.status === 'completed' || job.status === 'completed_with_errors') jobStats.completed++;
      else if (job.status === 'failed') jobStats.failed++;
    }

    return {
      jobs: jobStats,
      capacity: {
        activeJobs: this.activeJobCount,
        maxConcurrentJobs: maxConcurrent,
        utilizationPercent: maxConcurrent > 0
          ? Math.round((this.activeJobCount / maxConcurrent) * 100)
          : 0
      },
      cache: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: this.cacheHits + this.cacheMisses > 0
          ? this.cacheHits / (this.cacheHits + this.cacheMisses)
          : 0
      },
      workers: {
        total: workerStats.totalWorkers,
        active: workerStats.busyWorkers,
        idle: workerStats.readyWorkers
      }
    };
  }

  /**
   * List jobs with filtering and pagination (lightweight - documentId only)
   */
  async listJobs(options?: ListJobsOptions, runtimeSessionId?: string): Promise<ListJobsResponse> {
    if (!this.storage.listJobs) {
      throw new Error('Storage adapter does not support job listing');
    }

    // Add runtime session ID filter if provided
    const filterOptions = runtimeSessionId
      ? { ...options, sessionId: runtimeSessionId }
      : options;

    const jobs = await this.storage.listJobs(filterOptions);

    // Calculate pagination
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    const total = jobs.length;  // Note: This is the filtered count, not total in storage
    const hasMore = total > offset + limit;

    return {
      jobs,
      pagination: {
        total,
        limit,
        offset,
        hasMore
      },
      sessionId: runtimeSessionId || 'unknown'
    };
  }

  /**
   * List jobs with document metadata enrichment (detailed)
   */
  async listJobsDetailed(options?: ListJobsOptions, runtimeSessionId?: string): Promise<ListJobsResponse> {
    // First get lightweight jobs
    const response = await this.listJobs(options, runtimeSessionId);

    // Enrich with document metadata
    const enrichedJobs: JobDetailed[] = await Promise.all(
      response.jobs.map(async (job: JobSummary) => {
        try {
          const storedDoc = await this.documentStore.getDocument(job.documentId);

          if (!storedDoc) {
            // Document not found - return minimal metadata
            return {
              ...job,
              document: {
                documentId: job.documentId,
                name: 'Document not found',
                format: 'json' as const
              }
            };
          }

          // Map document-store metadata to our DocumentMetadata type
          const metadata = storedDoc.metadata;
          return {
            ...job,
            document: {
              documentId: metadata.id,
              name: metadata.name || metadata.filename || 'Unknown',
              version: metadata.version,
              organization: metadata.organization,
              tags: metadata.tags,
              format: metadata.format,
              operationCount: metadata.operationCount,
              uploadedAt: metadata.uploadedAt,
              updatedAt: metadata.updatedAt,
              uploadedBy: metadata.uploadedBy,
              size: metadata.size
            }
          };
        } catch (error) {
          console.error(`Failed to load metadata for document ${job.documentId}:`, error);
          // Return job with minimal document metadata on error
          return {
            ...job,
            document: {
              documentId: job.documentId,
              name: 'Metadata unavailable',
              format: 'json' as const
            }
          };
        }
      })
    );

    return {
      ...response,
      jobs: enrichedJobs
    };
  }

  /**
   * Get lint activity for a specific document
   */
  async getDocumentLintActivity(documentId: string): Promise<DocumentLintActivity | null> {
    if (!this.storage.getDocumentLintActivity) {
      throw new Error('Storage adapter does not support document lint activity');
    }

    return this.storage.getDocumentLintActivity(documentId);
  }

  /**
   * Build JobNotification from LintJobResult for Report Service
   */
  private async buildJobNotification(jobResult: LintJobResult): Promise<any> {
    // Get document metadata from document store
    let documentMetadata: any = {
      name: `document-${jobResult.documentId}`,
      format: 'openapi'
    };

    try {
      const storedDoc = await this.documentStore.getDocument(jobResult.documentId);
      if (storedDoc?.metadata) {
        // Map file format (yaml/json) to API spec type (openapi/swagger/asyncapi)
        // Report Service expects spec type, not file format
        let apiFormat: string = storedDoc.metadata.format || 'openapi';

        // If format is a file format (json/yaml), default to openapi
        if (apiFormat === 'json' || apiFormat === 'yaml') {
          apiFormat = 'openapi';
        }

        // Ensure format is one of the allowed values
        if (!['openapi', 'swagger', 'asyncapi', 'unknown'].includes(apiFormat)) {
          apiFormat = 'openapi';
        }

        documentMetadata = {
          name: storedDoc.metadata.name || `document-${jobResult.documentId}`,
          version: storedDoc.metadata.version,
          organization: storedDoc.metadata.organization,
          format: apiFormat
        };
      }
    } catch (error) {
      console.warn(`Could not retrieve document metadata for ${jobResult.documentId}:`, error);
    }

    // Map job status
    let notificationStatus: 'completed' | 'failed' | 'timeout';
    if (jobResult.status === 'timeout') {
      notificationStatus = 'timeout';
    } else if (jobResult.status === 'completed_with_errors' || jobResult.status === 'failed') {
      notificationStatus = 'failed';
    } else {
      notificationStatus = 'completed';
    }

    // Transform issues to match Report Service format
    const transformedIssues = jobResult.results.map(issue => ({
      code: issue.code,
      message: issue.message,
      severity: issue.severity,
      path: issue.path.join('.'), // Convert path array to string
      range: issue.range,
      source: issue.ruleId
    }));

    const rulesetResult = {
      rulesetName: jobResult.rulesetName,
      rulesetVersion: jobResult.rulesetVersion,
      status: notificationStatus,
      issues: transformedIssues,
      summary: {
        errorCount: jobResult.summary.errorCount,
        warningCount: jobResult.summary.warningCount,
        infoCount: jobResult.summary.infoCount,
        hintCount: jobResult.summary.hintCount,
        totalIssues: jobResult.summary.totalIssues
      },
      durationMs: jobResult.executionDetails.executionTime
    };

    const notification = {
      jobId: jobResult.jobId,
      documentId: jobResult.documentId,
      status: notificationStatus,
      results: [rulesetResult],
      summary: {
        totalIssues: jobResult.summary.totalIssues,
        errorCount: jobResult.summary.errorCount,
        warningCount: jobResult.summary.warningCount,
        infoCount: jobResult.summary.infoCount,
        hintCount: jobResult.summary.hintCount,
        durationMs: jobResult.totalExecutionTime
      },
      metadata: documentMetadata,
      timestamp: jobResult.timestamp.toISOString()
    };

    return notification;
  }

  /**
   * Notify Report Service about completed job (fire-and-forget)
   * 
   * On errors, checks compatibility to diagnose version incompatibility issues
   */
  private async notifyReportService(jobResult: LintJobResult): Promise<void> {
    if (!this.reportClient) {
      return; // Report Service not configured or unavailable
    }

    try {
      const notification = await this.buildJobNotification(jobResult);
      await this.reportClient.notify(notification);
      // Fire-and-forget - don't wait for or log success
    } catch (error) {
      // Error occurred - check if it's due to version incompatibility
      try {
        const compatibility = await this.reportClient.checkCompatibility();

        if (!compatibility.compatible) {
          console.warn(`⚠️  Report Service version incompatible - notifications will queue to pending directory`);
          console.warn(`   Client: ${compatibility.clientVersion}, Server expects: ${compatibility.serverExpectedVersion}, Server: ${compatibility.serverVersion}`);
          if (compatibility.details) {
            console.warn(`   ${compatibility.details}`);
          }
        } else {
          // Compatible but notification failed for another reason (network, etc.)
          console.debug(`Report Service notification queued for job ${jobResult.jobId}: ${(error as Error).message}`);
        }
      } catch (compatError) {
        // Couldn't check compatibility (service unreachable)
        console.debug(`Report Service notification queued for job ${jobResult.jobId} (service unreachable)`);
      }

      // Client handles retries and pending storage internally - error is non-fatal
    }
  }

  /**
   * Deliver job result to callback URL (fire-and-forget).
   * Attempts one delivery with a 10s timeout.
   */
  private async deliverCallback(callbackUrl: string, jobResult: LintJobResult): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: jobResult.jobId,
          status: jobResult.status,
          documentId: jobResult.documentId,
          rulesetName: jobResult.rulesetName,
          rulesetVersion: jobResult.rulesetVersion,
          summary: jobResult.summary,
          results: jobResult.results,
          totalExecutionTime: jobResult.totalExecutionTime,
          timestamp: jobResult.timestamp
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        console.warn(`⚠️  Callback returned ${response.status} for job ${jobResult.jobId}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Check if Report Service client is active
   */
  hasReportClient(): boolean {
    return this.reportServiceConfig?.enabled === true;
  }

  /**
   * Get Report Service client status
   * 
   * Note: Compatibility check is done once at startup, not on every health check
   * for performance reasons. This method returns current client state only.
   */
  async getReportClientStatus(): Promise<any | null> {
    // Not configured at all
    if (!this.reportServiceConfig?.enabled || !this.reportClient) {
      return null;
    }

    // Client exists - get its status (client handles connection internally)
    try {
      const status = await this.reportClient.getStatus();

      // Determine connection status from actual reachability
      let connectionStatus: string;
      if (status.reachable) {
        connectionStatus = 'connected';
      } else if (status.pendingNotifications > 0) {
        connectionStatus = 'degraded';
      } else {
        connectionStatus = 'unreachable';
      }

      return {
        enabled: status.enabled,
        status: connectionStatus,
        serviceUrl: status.serviceUrl,
        pendingNotifications: status.pendingNotifications,
        retryJobRunning: status.retryJobRunning,
        retryJobInterval: status.retryJobInterval,
        lastRetryRun: status.lastRetryRun,
        nextRetryAt: status.nextRetryAt,
      };
    } catch (error) {
      return {
        enabled: true,
        status: 'error',
        serviceUrl: this.reportServiceConfig.url,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Shutdown orchestrator
   */
  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down orchestrator...');

    // Shutdown Report Service client if active
    if (this.reportClient) {
      console.log('🔗 Shutting down Report Service client...');
      await this.reportClient.shutdown();
    }

    // Wait for running jobs to complete (with timeout)
    const timeout = 30000; // 30s
    const start = Date.now();

    let stats = await this.getStats();
    while (stats.jobs.running > 0 && Date.now() - start < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
      stats = await this.getStats();
    }

    this.initialized = false;
    console.log('✅ Orchestrator shutdown complete');
  }
}
