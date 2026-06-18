/**
 * Client library types for ReportServiceClient
 */

import type { JobNotification } from '../types.js';

/**
 * Configuration for ReportServiceClient
 */
export interface ReportServiceClientConfig {
  /** Base URL of the Report Service (e.g., 'http://localhost:3010') */
  url: string;

  /** API key for authentication */
  apiKey: string;

  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number;

  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;

  /** Base delay for exponential backoff in ms (default: 1000) */
  baseRetryDelay?: number;

  /** Directory for pending notifications (default: './pending-reports') */
  pendingDir?: string;

  /** Enable background retry job (default: false) */
  enableRetryJob?: boolean;

  /** Retry job interval in milliseconds (default: 300000 = 5 minutes) */
  retryJobInterval?: number;

  /** Logger function (optional) */
  logger?: ClientLogger;

  /** Directory for dead-letter notifications that permanently failed (default: './dead-letter-reports') */
  deadLetterDir?: string;

  /** Maximum background-retry attempts before moving a notification to dead-letter (default: 50) */
  maxPendingRetries?: number;

  /** Maximum payload size in bytes before shrinking (default: 10 MiB × 0.9 = 9,437,184 bytes) */
  maxPayloadBytes?: number;
}

/**
 * Logger interface for client
 */
export interface ClientLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Result of notification attempt
 */
export interface NotificationResult {
  success: boolean;
  jobId: string;
  attempts: number;
  error?: Error;
  storedLocally?: boolean;
  /** True when the payload was shrunk to fit the size limit */
  truncated?: boolean;
}

/**
 * Pending notification stored locally
 */
export interface PendingNotification {
  notification: JobNotification;
  attempts: number;
  lastAttempt: string;
  createdAt: string;
}

/**
 * Retry statistics
 */
export interface RetryStats {
  totalPending: number;
  successfulRetries: number;
  failedRetries: number;
  movedToDeadLetter: number;
  lastRun: string;
}

/**
 * Client status
 */
export interface ClientStatus {
  enabled: boolean;
  serviceUrl: string;
  reachable: boolean;
  pendingNotifications: number;
  deadLetterNotifications: number;
  retryJobRunning: boolean;
  retryJobInterval?: number;
  lastRetryRun?: string;
  nextRetryAt?: string;
}

/**
 * Result of compatibility check
 */
export interface CompatibilityCheckResult {
  /** Whether the client version is compatible with the server */
  compatible: boolean;
  
  /** This client library's version */
  clientVersion: string;
  
  /** Server's expected client version range (semver) */
  serverExpectedVersion: string;
  
  /** Server's own version */
  serverVersion: string;
  
  /** Human-readable details about incompatibility (if any) */
  details?: string;
}

// Re-export JobNotification for convenience
export type { JobNotification };
