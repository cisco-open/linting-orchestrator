/**
 * Report Service Client
 * Reusable TypeScript client for sending job notifications to the Linting Reports Service
 */

/**
 * Client library version (independent of server version)
 * @see docs/VERSIONING_STRATEGY.md
 */
export const CLIENT_VERSION = '1.6.0';

import os from 'os';
import path from 'path';

import type {
  ReportServiceClientConfig,
  NotificationResult,
  JobNotification,
  ClientLogger,
  ClientStatus,
  RetryStats,
  CompatibilityCheckResult,
} from './types.js';
import { PendingStorage } from './storage.js';
import semver from 'semver';

/**
 * HTTP status codes that indicate a permanent failure — retrying won't help.
 */
const NON_RETRYABLE_STATUS_CODES = new Set([400, 413, 422]);

/**
 * Error subclass thrown when the server rejects a request permanently.
 * Used to distinguish retryable (network, 500) from non-retryable (413, 400) failures.
 */
export class NonRetryableError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'NonRetryableError';
    this.statusCode = statusCode;
  }
}

/**
 * Resolve the home directory (mirrors orchestrator config logic).
 * SPECTIFY_HOME env var overrides the default ~/.spectify.
 */
function spectifyHome(): string {
  return process.env.SPECTIFY_HOME || path.join(os.homedir(), '.spectify');
}

/**
 * Default console logger
 */
const defaultLogger: ClientLogger = {
  debug: (msg, meta) => meta !== undefined ? console.debug(msg, meta) : console.debug(msg),
  info: (msg, meta) => meta !== undefined ? console.info(msg, meta) : console.info(msg),
  warn: (msg, meta) => meta !== undefined ? console.warn(msg, meta) : console.warn(msg),
  error: (msg, meta) => meta !== undefined ? console.error(msg, meta) : console.error(msg),
};

/**
 * ReportServiceClient
 * 
 * Sends job notifications to Report Service with:
 * - Automatic retry with exponential backoff
 * - Local storage for failed notifications
 * - Optional background retry scheduler
 * 
 * @example
 * ```typescript
 * const client = new ReportServiceClient({
 *   url: 'http://localhost:3010',
 *   apiKey: process.env.SPECTIFYR_API_KEY!,
 * });
 * 
 * await client.notify(jobNotification);
 * ```
 */
export class ReportServiceClient {
  private config: Required<ReportServiceClientConfig>;
  private storage: PendingStorage;
  private retryTimer?: NodeJS.Timeout;
  private logger: ClientLogger;
  private lastRetryRun?: string;
  private retryJobStartedAt?: number;

  constructor(config: ReportServiceClientConfig) {
    this.config = {
      url: config.url,
      apiKey: config.apiKey,
      timeout: config.timeout ?? 5000,
      maxRetries: config.maxRetries ?? 3,
      baseRetryDelay: config.baseRetryDelay ?? 1000,
      pendingDir: config.pendingDir ?? path.join(spectifyHome(), 'reports', 'pending'),
      enableRetryJob: config.enableRetryJob ?? false,
      retryJobInterval: config.retryJobInterval ?? 300000, // 5 minutes
      logger: config.logger ?? defaultLogger,
      deadLetterDir: config.deadLetterDir ?? path.join(spectifyHome(), 'reports', 'dead-letter'),
      maxPendingRetries: config.maxPendingRetries ?? 50,
      maxPayloadBytes: config.maxPayloadBytes ?? Math.floor(10 * 1024 * 1024 * 0.9), // 9 MiB (10% margin below 10 MiB server limit)
    };

    this.logger = this.config.logger;
    this.storage = new PendingStorage(this.config.pendingDir, this.config.deadLetterDir);
  }

  /**
   * Initialize client (creates pending directory)
   */
  async initialize(): Promise<void> {
    await this.storage.initialize();

    if (this.config.enableRetryJob) {
      this.startRetryJob();
    }

    this.logger.info('ReportServiceClient initialized', {
      url: this.config.url,
      maxRetries: this.config.maxRetries,
      retryJobEnabled: this.config.enableRetryJob,
    });
  }

  /**
   * Send a job notification to Report Service
   * Fire-and-forget with automatic retry and local backup
   */
  async notify(notification: JobNotification): Promise<NotificationResult> {
    // Validate payload before attempting to send
    // Catches data errors early instead of waiting for server rejection
    try {
      this.validateNotification(notification);
    } catch (error) {
      this.logger.error('Notification validation failed', {
        jobId: notification.jobId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        jobId: notification.jobId,
        attempts: 0,
        error: error as Error,
      };
    }

    const result: NotificationResult = {
      success: false,
      jobId: notification.jobId,
      attempts: 0,
    };

    // Shrink the payload if it exceeds the size limit (works on a deep clone)
    let payload = notification;
    const serialized = JSON.stringify(notification);
    if (Buffer.byteLength(serialized, 'utf-8') > this.config.maxPayloadBytes) {
      payload = this.shrinkNotification(notification);
      result.truncated = true;
      this.logger.info('Notification payload shrunk to fit size limit', {
        jobId: notification.jobId,
        originalBytes: Buffer.byteLength(serialized, 'utf-8'),
        maxPayloadBytes: this.config.maxPayloadBytes,
      });
    }

    // Try sending with retries
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      result.attempts = attempt + 1;

      try {
        await this.sendNotification(payload);
        result.success = true;

        this.logger.debug('Notification sent successfully', {
          jobId: notification.jobId,
          attempt: result.attempts,
        });

        return result;
      } catch (error) {
        // Non-retryable errors go straight to dead-letter — no point retrying
        if (error instanceof NonRetryableError) {
          result.error = error;
          result.storedLocally = true;

          const reason = `Non-retryable HTTP ${error.statusCode}: ${error.message}`;
          try {
            await this.storage.store(notification);
            await this.storage.moveToDeadLetter(notification.jobId, reason);
            this.logger.warn('Notification moved to dead-letter (non-retryable)', {
              jobId: notification.jobId,
              statusCode: error.statusCode,
              attempts: result.attempts,
              reason,
            });
          } catch (storageError) {
            this.logger.error('Failed to store notification in dead-letter', {
              jobId: notification.jobId,
              error: (storageError as Error).message,
            });
          }

          return result;
        }

        const isLastAttempt = attempt === this.config.maxRetries;

        if (isLastAttempt) {
          // Store locally for background retry
          result.error = error as Error;
          result.storedLocally = true;

          try {
            await this.storage.store(notification);
            this.logger.warn(`Report Service notification failed after ${result.attempts} attempts — stored locally for retry`, {
              jobId: notification.jobId,
              attempts: result.attempts,
              serviceUrl: this.config.url,
              error: (error as Error).message,
            });
          } catch (storageError) {
            this.logger.error('Failed to store pending notification', {
              jobId: notification.jobId,
              error: (storageError as Error).message,
            });
          }
        } else {
          // Exponential backoff
          const delay = this.config.baseRetryDelay * Math.pow(2, attempt);
          this.logger.warn(`Report Service notification retry ${attempt + 1}/${this.config.maxRetries} in ${delay}ms`, {
            jobId: notification.jobId,
            serviceUrl: this.config.url,
            error: (error as Error).message,
          });
          await this.sleep(delay);
        }
      }
    }

    return result;
  }

  /**
   * Validate notification payload before sending
   * Catches data errors early instead of waiting for server rejection
   */
  private validateNotification(notification: JobNotification): void {
    const errors: string[] = [];

    // Required fields
    if (!notification.jobId) errors.push('jobId is required');
    if (!notification.documentId) errors.push('documentId is required');
    if (!notification.timestamp) errors.push('timestamp is required');

    // Status validation
    const validStatuses = ['completed', 'failed', 'timeout'];
    if (!validStatuses.includes(notification.status)) {
      errors.push(`status must be one of: ${validStatuses.join(', ')} (got: ${notification.status})`);
    }

    // Metadata format validation
    if (notification.metadata?.format) {
      const validFormats = ['openapi', 'swagger', 'asyncapi', 'unknown'];
      if (!validFormats.includes(notification.metadata.format)) {
        errors.push(`metadata.format must be one of: ${validFormats.join(', ')} (got: ${notification.metadata.format})`);
      }
    }

    // Results validation
    if (!Array.isArray(notification.results)) {
      errors.push('results must be an array');
    } else {
      notification.results.forEach((result, idx) => {
        if (!validStatuses.includes(result.status)) {
          errors.push(`results[${idx}].status must be one of: ${validStatuses.join(', ')} (got: ${result.status})`);
        }

        // Issue severity validation
        if (result.issues) {
          result.issues.forEach((issue, issueIdx) => {
            if (![0, 1, 2, 3].includes(issue.severity)) {
              errors.push(`results[${idx}].issues[${issueIdx}].severity must be 0-3 (got: ${issue.severity})`);
            }
          });
        }
      });
    }

    // Summary validation
    if (notification.summary) {
      const requiredSummaryFields = ['totalIssues', 'errorCount', 'warningCount', 'infoCount', 'hintCount', 'durationMs'];
      requiredSummaryFields.forEach(field => {
        if (typeof (notification.summary as any)[field] !== 'number') {
          errors.push(`summary.${field} must be a number`);
        }
      });
    }

    if (errors.length > 0) {
      throw new Error(`Invalid notification payload:\n  - ${errors.join('\n  - ')}`);
    }
  }

  /**
   * Shrink a notification payload to fit within maxPayloadBytes.
   *
   * Algorithm:
   * 1. Deep-clone the notification (caller's data is never mutated).
   * 2. Strip optional `source` and `range` fields from every issue (Pass 1).
   * 3. If still too large, compute a dynamic issue cap per ruleset based on
   *    the ratio (targetSize / currentSize × totalIssues), with a 10% safety
   *    margin.  Issues are kept in FIFO order.
   * 4. If the estimate wasn't enough, reduce the cap by 10% and retry until
   *    the payload fits.
   * 5. Annotate each affected RulesetResult with `truncated: true` and
   *    `originalIssueCount`.  The summary counts are preserved from the
   *    original (they reflect the full run).
   */
  private shrinkNotification(notification: JobNotification): JobNotification {
    const maxBytes = this.config.maxPayloadBytes;

    // Step 1 — deep clone
    const clone: JobNotification = JSON.parse(JSON.stringify(notification));

    // Step 2 — strip optional verbose fields (source, range)
    let totalIssues = 0;
    for (const rs of clone.results) {
      totalIssues += rs.issues.length;
      for (const issue of rs.issues) {
        delete (issue as any).source;
        delete (issue as any).range;
      }
    }

    let json = JSON.stringify(clone);
    if (Buffer.byteLength(json, 'utf-8') <= maxBytes) {
      this.logger.debug('Payload fits after stripping source/range fields', {
        jobId: clone.jobId,
        bytes: Buffer.byteLength(json, 'utf-8'),
      });
      // Mark rulesets that lost source/range but kept all issues
      for (const rs of clone.results) {
        if (rs.issues.length < (notification.results.find(r => r.rulesetName === rs.rulesetName)?.issues.length ?? 0)) {
          rs.truncated = true;
          rs.originalIssueCount = notification.results.find(r => r.rulesetName === rs.rulesetName)?.issues.length;
        }
      }
      return clone;
    }

    // Step 3 — compute dynamic cap
    const currentBytes = Buffer.byteLength(json, 'utf-8');
    let estimatedCap = Math.floor((totalIssues * maxBytes) / currentBytes * 0.9); // 10% safety margin
    if (estimatedCap < 1) estimatedCap = 1;

    this.logger.debug('Computing dynamic issue cap', {
      jobId: clone.jobId,
      totalIssues,
      currentBytes,
      maxBytes,
      estimatedCap,
    });

    // Step 4 — iteratively shrink until it fits
    const MAX_SHRINK_ITERATIONS = 20;
    for (let iteration = 0; iteration < MAX_SHRINK_ITERATIONS; iteration++) {
      // Apply cap proportionally across rulesets (FIFO)
      const shrunk: JobNotification = JSON.parse(JSON.stringify(clone));
      const originalResults = notification.results;

      for (let i = 0; i < shrunk.results.length; i++) {
        const rs = shrunk.results[i];
        const originalCount = originalResults[i].issues.length;

        if (rs.issues.length > estimatedCap) {
          rs.issues = rs.issues.slice(0, estimatedCap);
          rs.truncated = true;
          rs.originalIssueCount = originalCount;
        } else if (rs.issues.length < originalCount) {
          // Already fewer than cap but source/range were stripped
          rs.truncated = true;
          rs.originalIssueCount = originalCount;
        }

        // Summaries are preserved — they reflect the full run
      }

      json = JSON.stringify(shrunk);
      const bytes = Buffer.byteLength(json, 'utf-8');

      if (bytes <= maxBytes) {
        this.logger.debug('Payload fits after truncation', {
          jobId: shrunk.jobId,
          bytes,
          issueCap: estimatedCap,
          iteration: iteration + 1,
        });
        return shrunk;
      }

      // Reduce cap by 10% and retry
      estimatedCap = Math.max(1, Math.floor(estimatedCap * 0.9));
      this.logger.debug('Payload still too large, reducing cap', {
        jobId: clone.jobId,
        bytes,
        newCap: estimatedCap,
        iteration: iteration + 1,
      });
    }

    // Last resort — keep 1 issue per ruleset (should always fit)
    this.logger.warn('Shrink iterations exhausted, keeping minimal issues', {
      jobId: clone.jobId,
    });
    for (let i = 0; i < clone.results.length; i++) {
      const rs = clone.results[i];
      const originalCount = notification.results[i].issues.length;
      rs.issues = rs.issues.slice(0, 1);
      rs.truncated = true;
      rs.originalIssueCount = originalCount;
    }
    return clone;
  }

  /**
   * Send notification via HTTP POST
   */
  private async sendNotification(notification: JobNotification): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
    const endpoint = `${this.config.url}/reports/jobs`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(notification),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        if (NON_RETRYABLE_STATUS_CODES.has(response.status)) {
          throw new NonRetryableError(response.status, `Report Service returned HTTP ${response.status}: ${text}`);
        }
        throw new Error(`Report Service returned HTTP ${response.status}: ${text}`);
      }

      const data = await response.json() as { success: boolean; error?: string };
      if (!data.success) {
        throw new Error(`Report Service returned error: ${data.error || 'unknown'}`);
      }
    } catch (error) {
      // Wrap generic fetch errors with service context
      const err = error as Error;
      if (err.message === 'fetch failed' || err.message.includes('ECONNREFUSED')) {
        throw new Error(`Report Service unreachable at ${endpoint}: ${err.message}${err.cause ? ` (${(err.cause as Error).message ?? err.cause})` : ''}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Start background retry job
   * @param intervalOverride Optional interval in ms, defaults to configured retryJobInterval.
   *   Primarily for testing with short intervals.
   */
  startRetryJob(intervalOverride?: number): void {
    if (this.retryTimer) {
      return; // Already running
    }

    const interval = intervalOverride ?? this.config.retryJobInterval;

    this.logger.info('Starting background retry job', {
      interval,
    });

    this.retryJobStartedAt = Date.now();
    this.retryTimer = setInterval(() => {
      this.retryPendingNotifications().catch(error => {
        this.logger.error('Retry job failed', { error: error.message });
      });
    }, interval);

    // Don't prevent process exit
    this.retryTimer.unref();
  }

  /**
   * Stop background retry job
   */
  stopRetryJob(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = undefined;
      this.logger.info('Background retry job stopped');
    }
  }

  /**
   * Retry all pending notifications
   */
  async retryPendingNotifications(): Promise<RetryStats> {
    this.lastRetryRun = new Date().toISOString();
    const stats: RetryStats = {
      totalPending: 0,
      successfulRetries: 0,
      failedRetries: 0,
      movedToDeadLetter: 0,
      lastRun: new Date().toISOString(),
    };

    try {
      const pending = await this.storage.list();
      stats.totalPending = pending.length;

      if (pending.length === 0) {
        return stats;
      }

      this.logger.info(`Retrying ${pending.length} pending report notifications to ${this.config.url}`);

      const failedJobIds: string[] = [];
      let lastError = '';

      for (const item of pending) {
        // Guard: if a notification has been retried too many times, move
        // it to dead-letter instead of retrying forever.
        if (item.attempts >= this.config.maxPendingRetries) {
          const reason = `Exceeded maximum retry attempts (${item.attempts}/${this.config.maxPendingRetries})`;
          try {
            await this.storage.moveToDeadLetter(item.notification.jobId, reason);
            stats.movedToDeadLetter++;
            this.logger.warn('Notification moved to dead-letter (max retries exceeded)', {
              jobId: item.notification.jobId,
              attempts: item.attempts,
              maxPendingRetries: this.config.maxPendingRetries,
            });
          } catch (moveError) {
            stats.failedRetries++;
            this.logger.error('Failed to move notification to dead-letter', {
              jobId: item.notification.jobId,
              error: (moveError as Error).message,
            });
          }
          continue;
        }

        try {
          await this.storage.updateAttempt(item.notification.jobId);
          await this.sendNotification(item.notification);

          // Success - remove from pending
          await this.storage.remove(item.notification.jobId);
          stats.successfulRetries++;

          this.logger.info('Pending report notification retried successfully', {
            jobId: item.notification.jobId,
            totalAttempts: item.attempts + 1,
            serviceUrl: this.config.url,
          });
        } catch (error) {
          if (error instanceof NonRetryableError) {
            // Permanent failure — move to dead-letter instead of retrying forever
            const reason = `Non-retryable HTTP ${error.statusCode}: ${error.message}`;
            try {
              await this.storage.moveToDeadLetter(item.notification.jobId, reason);
              stats.movedToDeadLetter++;
              this.logger.warn('Notification moved to dead-letter (non-retryable)', {
                jobId: item.notification.jobId,
                statusCode: error.statusCode,
                reason,
              });
            } catch (moveError) {
              stats.failedRetries++;
              this.logger.error('Failed to move notification to dead-letter', {
                jobId: item.notification.jobId,
                error: (moveError as Error).message,
              });
            }
          } else {
            stats.failedRetries++;
            lastError = (error as Error).message;
            failedJobIds.push(item.notification.jobId);
          }
        }
      }

      // Use appropriate log level based on outcome
      const retryResult: Record<string, unknown> = {
        totalPending: stats.totalPending,
        successfulRetries: stats.successfulRetries,
        failedRetries: stats.failedRetries,
        movedToDeadLetter: stats.movedToDeadLetter,
        lastRun: stats.lastRun,
        serviceUrl: this.config.url,
      };

      if (stats.failedRetries === stats.totalPending) {
        // All retries failed — Report Service is likely unreachable
        this.logger.warn(`Report Service unreachable at ${this.config.url} — all ${stats.failedRetries} pending notification retries failed`, { ...retryResult, error: lastError });
      } else if (stats.failedRetries > 0) {
        // Partial success
        this.logger.warn(`Report Service retry partially succeeded — ${stats.successfulRetries} delivered, ${stats.failedRetries} still failing`, retryResult);
      } else {
        // All succeeded
        this.logger.info('All pending report notifications delivered successfully', retryResult);
      }

      // Log individual failed job IDs at debug level (only visible with verbose/debug logging)
      if (failedJobIds.length > 0) {
        this.logger.debug(`Failed notification job IDs (${failedJobIds.length})`, {
          jobIds: failedJobIds,
          serviceUrl: this.config.url,
        });
      }
    } catch (error) {
      this.logger.error('Failed to retry pending notifications', {
        error: (error as Error).message,
      });
    }

    return stats;
  }

  /**
   * Get client status including reachability check
   */
  async getStatus(): Promise<ClientStatus> {
    const reachable = await this.checkReachable();
    const pendingNotifications = await this.storage.count();
    const deadLetterNotifications = await this.storage.deadLetterCount();

    const status: ClientStatus = {
      enabled: true,
      serviceUrl: this.config.url,
      reachable,
      pendingNotifications,
      deadLetterNotifications,
      retryJobRunning: this.retryTimer !== undefined,
      retryJobInterval: this.config.retryJobInterval,
      lastRetryRun: this.lastRetryRun,
    };

    // Calculate next retry time
    if (this.retryTimer && this.retryJobStartedAt) {
      const elapsed = Date.now() - this.retryJobStartedAt;
      const intervalsSoFar = Math.floor(elapsed / this.config.retryJobInterval);
      const nextAt = this.retryJobStartedAt + (intervalsSoFar + 1) * this.config.retryJobInterval;
      status.nextRetryAt = new Date(nextAt).toISOString();
    }

    return status;
  }

  /**
   * Quick reachability check against the report service health endpoint
   */
  private async checkReachable(): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout for health check

    try {
      const response = await fetch(`${this.config.url}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Manually trigger retry of pending notifications
   */
  async retryNow(): Promise<RetryStats> {
    return this.retryPendingNotifications();
  }

  /**
   * Get count of pending notifications
   */
  async getPendingCount(): Promise<number> {
    return this.storage.count();
  }

  /**
   * Clear all pending notifications
   */
  async clearPending(): Promise<number> {
    return this.storage.clear();
  }

  /**
   * Check if this client version is compatible with the server
   * 
   * Validates that CLIENT_VERSION satisfies the server's expected client version range.
   * Useful for deployment validation and runtime diagnostics.
   * 
   * @returns Compatibility status and version information
   * @throws Error if health endpoint is unreachable or returns invalid data
   * 
   * @example
   * ```typescript
   * const client = new ReportServiceClient(config);
   * const result = await client.checkCompatibility();
   * 
   * if (!result.compatible) {
   *   console.warn(`Version mismatch: client ${result.clientVersion}, server expects ${result.serverExpectedVersion}`);
   * }
   * ```
   */
  async checkCompatibility(): Promise<CompatibilityCheckResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.url}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Health endpoint returned HTTP ${response.status}`);
      }

      const health = await response.json() as {
        status: string;
        server: { version: string };
        clientLibrary: { version: string; compatible: string };
      };

      if (!health.clientLibrary?.compatible) {
        throw new Error('Health endpoint missing clientLibrary.compatible field');
      }

      const clientVersion = CLIENT_VERSION;
      const serverExpectedVersion = health.clientLibrary.compatible;
      const serverVersion = health.server.version;

      // Check if client version satisfies server's expected range
      const compatible = semver.satisfies(clientVersion, serverExpectedVersion);

      const result: CompatibilityCheckResult = {
        compatible,
        clientVersion,
        serverExpectedVersion,
        serverVersion,
      };

      if (!compatible) {
        result.details = `Client version ${clientVersion} does not satisfy server requirement ${serverExpectedVersion}`;
        this.logger.warn('Version incompatibility detected', result as unknown as Record<string, unknown>);
      } else {
        this.logger.debug('Version compatibility check passed', result as unknown as Record<string, unknown>);
      }

      return result;
    } catch (error) {
      this.logger.error('Compatibility check failed', {
        error: (error as Error).message,
      });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Shutdown client gracefully
   */
  async shutdown(): Promise<void> {
    this.stopRetryJob();
    this.logger.info('ReportServiceClient shutdown');
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
