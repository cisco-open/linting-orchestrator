/**
 * TypeScript type definitions for the Linting Reports Service (spectifyr).
 */

// ============================================================================
// Job Notification Types (received from the linting orchestrator)
// ============================================================================

export interface JobNotification {
  jobId: string;
  documentId: string;
  status: JobStatus;
  results: RulesetResult[]; // NOTE: The orchestrator currently sends only ONE ruleset per job (array with single element)
  // Array structure kept for future flexibility, but Web UI assumes results[0]
  summary: JobSummary;
  metadata: DocumentMetadata;
  timestamp: string; // ISO 8601 format
  spectifySessionId?: string;
  createdAt?: string; // ISO 8601 format
}

export type JobStatus = 'completed' | 'failed' | 'timeout';

export interface RulesetResult {
  rulesetName: string;
  rulesetVersion?: string;
  status: JobStatus;
  issues: LintIssue[];
  summary: RulesetSummary;
  durationMs?: number;
  /** True when the issues array was truncated to fit the payload size limit */
  truncated?: boolean;
  /** Original number of issues before truncation (only set when truncated) */
  originalIssueCount?: number;
}

export interface RulesetSummary {
  errorCount: number;
  warningCount: number;
  infoCount: number;
  hintCount: number;
  totalIssues: number;
}

export interface LintIssue {
  code: string;
  message: string;
  severity: IssueSeverity;
  path: string;
  range?: SourceRange;
  source?: string;
}

export type IssueSeverity = 0 | 1 | 2 | 3; // 0=error, 1=warning, 2=info, 3=hint

export interface SourceRange {
  start: SourceLocation;
  end: SourceLocation;
}

export interface SourceLocation {
  line: number;
  character: number;
}

export interface JobSummary {
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  hintCount: number;
  durationMs: number;
}

export interface DocumentMetadata {
  name: string;
  version?: string;
  organization?: string;
  format?: string; // 'openapi', 'swagger', 'asyncapi', 'mcpdesc'
}

// ============================================================================
// Database Types
// ============================================================================

export interface DbJob {
  id: string;
  document_id: string;
  document_name: string | null;
  document_version: string | null;
  status: JobStatus;
  created_at: string;
  completed_at: string;
  duration_ms: number | null;
  spectify_session_id: string | null;
}

export interface DbRulesetResult {
  id: number;
  job_id: string;
  ruleset_name: string;
  ruleset_version: string | null;
  status: JobStatus;
  issue_count: number;
  error_count: number;
  warning_count: number;
  info_count: number;
  hint_count: number;
  duration_ms: number | null;
  results_json: string; // JSON serialized RulesetResult
}

export interface DbDocument {
  id: string;
  name: string;
  version: string | null;
  organization: string | null;
  format: string | null;
  last_linted_at: string | null;
  total_lints: number;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface JobListResponse {
  jobs: JobListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface JobListItem {
  id: string;
  documentId: string;
  documentName: string;
  documentVersion?: string;  // Document version
  status: JobStatus;
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  completedAt: string;
  durationMs: number;
  rulesetName?: string;      // Ruleset name (from first/only ruleset)
  rulesetVersion?: string;   // Ruleset version (from first/only ruleset)
}

export interface JobDetailsResponse {
  jobId: string;
  documentId: string;
  documentName: string;
  documentVersion?: string;
  status: JobStatus;
  results: RulesetResult[];
  summary: JobSummary;
  metadata: DocumentMetadata;
  createdAt: string;
  completedAt: string;
  durationMs: number;
}

export interface ApiSuccessResponse {
  success: true;
  jobId: string;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
}

// ============================================================================
// Query Types
// ============================================================================

export interface JobListQuery {
  status?: JobStatus;
  documentId?: string;       // Exact match on document ID
  search?: string;           // Partial match on document ID or name (starts with)
  rulesetName?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'completed_at' | 'duration_ms' | 'status';
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface ReportServiceConfig {
  port: number;
  host: string;
  apiKey: string;
  database: DatabaseConfig;
  logLevel: LogLevel;
  environment?: string;
  pendingDir?: string;
  deadLetterDir?: string;
}

export interface DatabaseConfig {
  type: 'sqlite'; // PostgreSQL support can be added later
  path: string;
}

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

// ============================================================================
// Utility Types
// ============================================================================

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  server: {
    version: string;
    environment: string;
    uptime?: number;
    nodeVersion: string;
  };
  clientLibrary: {
    version: string;
    compatible: string;
  };
  database: {
    connected: boolean;
    type: string;
    path?: string;
    sizeBytes?: number;
    totalJobs?: number;
    oldestJob?: string | null;
    newestJob?: string | null;
  };
  notificationQueue?: {
    pending: number;
    deadLetter: number;
  };
  features?: {
    authEnabled: boolean;
  };
}
