// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Complete TypeScript type definitions for OpenAPI Lint Orchestrator
 * 
 * @module types
 */

// ============================================
// Core Configuration Types
// ============================================

/**
 * orchestrator deployment mode
 */
export type SpectifyMode = 'standalone' | 'embedded' | 'companion' | 'mcp';

export interface OrchestratorConfig {
  mode?: SpectifyMode;  // Deployment mode
  server: {
    port: number;
    host: string;
    maxDocumentSizeMB: number;  // Maximum document upload size in megabytes
  };
  workerPool: WorkerPoolConfig;
  rulesets: RulesetConfig;
  storage: StorageConfig;
  logging: LoggingConfig;
  documentStore: DocumentStoreConfig;
  reportService?: ReportServiceConfig;  // NEW: Optional Report Service integration
  /**
   * Custom $ref resolver module name (filename without .js extension)
   * loaded from the `resolvers/` directory.  Passed to every Spectral
   * worker as `new Spectral({ resolver })`.
   *
   * Default: `"ignore-external-refs"` — ships with the repo, skips all
   * HTTP/HTTPS external $ref resolution to prevent network timeouts.
   *
   * Set to empty string `""` to disable (use Spectral's built-in
   * resolver that fetches all external references).
   *
   * Env override: `SPECTIFYD_RESOLVER`
   */
  resolver?: string;
}

/**
 * Report Service configuration (optional)
 * Enables sending job completion notifications to Report Service for persistent storage
 */
export interface ReportServiceConfig {
  /** Enable/disable reporting (default: false) */
  enabled: boolean;

  /** Report Service URL (e.g., 'http://localhost:3010') */
  url: string;

  /** API key for authentication (Bearer token) */
  apiKey: string;

  /** Request timeout in ms (default: 5000) */
  timeout?: number;

  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;

  /** Base delay for exponential backoff in ms (default: 1000) */
  baseRetryDelay?: number;

  /** Directory for failed notifications (default: './pending-reports') */
  pendingDir?: string;

  /** orchestrator deployment mode for audit context (auto-detected or manual) */
  mode?: SpectifyMode;

  /** Enable background retry job (default: false in test, true in prod) */
  enableRetryJob?: boolean;

  /** Retry job interval in ms (default: 300000 = 5 minutes) */
  retryJobInterval?: number;

  /** Stop server startup if Report Service unavailable (default: false) */
  stopIfUnavailable?: boolean;
}

export interface WorkerPoolConfig {
  minWorkersPerRuleset: number;
  maxWorkersPerRuleset: number;
  totalMaxWorkers: number;
  taskTimeout: number;
  maxRetries: number;
  workerWaitTimeout: number;   // Max ms to wait for a busy worker to become ready (default 30000)
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  exponentialBackoff: {
    initialDelay: number;
    maxDelay: number;
    multiplier: number;
  };
  documentCache: {
    enabled: boolean;
    maxDocumentsPerWorker: number;
    maxCacheSizePerWorker: number;
    evictAfterMinutes: number;
  };
}

export interface RulesetConfig {
  directory: string;
  defaultVersion: string;
  cacheEnabled: boolean;
}

export interface StorageConfig {
  type: 'memory' | 'redis' | 'custom';
  connectionString?: string;
  options?: Record<string, any>;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'json' | 'text';
  destination: 'console' | 'file' | 'both';
  filePath?: string;
}

export interface DocumentStoreConfig {
  type: 'local' | 'passthrough' | 'filesystem' | 'http' | 'hybrid';  // local=standalone, passthrough=external integration
  baseDir: string;
  fallbackHttp?: string;
}

// ============================================
// Ruleset Types
// ============================================

/**
 * Category classification for rulesets
 */
export type RulesetCategory =
  | 'publishing'      // Content publishing platforms (PubHub, etc.)
  | 'contract'        // API contract validation
  | 'security'        // Security validation
  | 'documentation'   // Documentation quality
  | 'validation'      // General validation
  | 'other';          // Miscellaneous

/**
 * Origin classification for rulesets.
 *
 * Classifies *who controls the source files*.  Drives both display
 * (`spectify rulesets <name>`, `/rulesets` API) and toolchain behaviour
 * (the catalogue template's `vendor.sh` / `validate.sh` / `install.sh`
 * are origin-aware; the orchestrator loader treats `embedded` entries
 * specially — see RulesetVersionConfig).
 *
 * Decision rule: *who wrote and ships these rules, and where do the
 * files live?*
 *
 *  1. Bundled inside an npm package the consumer already installs
 *     (e.g. `spectral:oas` from `@stoplight/spectral-rulesets`)?
 *     → `embedded`.
 *  2. Written by your team in a repo you control? → `internal`.
 *  3. Anything else (public OSS, partner, vendor)? → `external`.
 *
 * - `embedded`  — Rules bundled inside an npm package the consumer
 *                 already depends on.  No `sources/` tree is vendored;
 *                 the loader resolves the entrypoint via a Spectral
 *                 built-in token (`spectral:oas`, etc.).  The effective
 *                 version tracks the installed package and is surfaced
 *                 at runtime as `resolvedVersion`.
 * - `internal`  — Rules authored and maintained by the team that owns
 *                 this catalogue.  Source repo is under your control.
 * - `external`  — Rules sourced from a repository you do **not** own
 *                 (public OSS, partner, vendor).  You vendor a snapshot
 *                 for reproducibility.
 *
 * If an `embedded` ruleset needs to be pinned to a specific historical
 * version, change the entry's origin to `external` and vendor the
 * snapshot — mixing both models inside a single entry is not supported.
 */
export type RulesetOrigin =
  | 'embedded'       // bundled inside an npm package (e.g. spectral:oas)
  | 'internal'       // authored and maintained by the team that owns this catalogue
  | 'external';      // sourced from a repository you do not own (vendored snapshot)

/**
 * Configuration for a single ruleset (from rulesets/config/rulesets.yaml)
 * Maps logical rulesets to source repositories
 */
export interface RulesetConfigEntry {
  name: string;
  displayName: string;
  category: RulesetCategory;
  origin: RulesetOrigin;
  description: string;
  tags: string[];
  metadata: {
    team: string;
    /**
     * Person, team, or organisation accountable for the ruleset.
     * Free-form (e.g. "API Council", "Jane Doe <jane@acme.com>",
     * "Stoplight").  Required even for `embedded` entries — names the
     * upstream so consumers know who to contact.
     */
    maintainer: string;
    /** Optional URL or `mailto:` for reaching the maintainer (issues, mailing list). */
    contact?: string;
    repository: string;
    license: string;
    documentation?: string;
  };
  versions: RulesetVersionConfig[];
}

/**
 * Configuration for a specific version of a ruleset
 * Links Orchestrator version to source repository version
 *
 * Path resolution rules:
 *   - If the parent entry has `origin: embedded`, the loader bypasses
 *     `sources/` path construction and resolves `entrypoint` as a
 *     Spectral built-in token (e.g. `spectral:oas`).  `sourceVersion`
 *     is optional; `sourceRepo` is informational.  If `package` is
 *     set, the loader populates `resolvedVersion` from the installed
 *     npm package's `package.json` at runtime.
 *   - Else if `absolutePath` is set, the loader uses that path directly
 *     and `sourceRepo` / `sourceVersion` are optional.
 *   - Otherwise all three of `sourceRepo`, `sourceVersion`, and
 *     `entrypoint` must be present and are combined as:
 *     `sources/{sourceRepo}/{sourceVersion}/{entrypoint}`
 */
export interface RulesetVersionConfig {
  version: string;          // Orchestrator version (semver, user-facing)
  sourceRepo?: string;      // Path to source repo (relative to sources/); optional when absolutePath is set or origin is embedded (informational only)
  sourceVersion?: string;   // Source repo version or dump date; optional when absolutePath is set or origin is embedded
  entrypoint: string;       // Main Spectral file to load, OR a Spectral built-in token (`spectral:oas`, etc.) when origin is embedded
  /**
   * ISO 8601 release date.  Required for `internal` and `external`
   * entries (pins the vendored snapshot to a known date).  Not
   * applicable for `origin: embedded` entries — the effective
   * version of an embedded ruleset is determined by the installed npm
   * package at runtime, not by the catalogue, so there is no
   * catalogue-controlled release date to record.
   */
  releaseDate?: string;
  deprecated: boolean;      // Is this version deprecated?
  changelog?: string;       // What's new in this version
  /**
   * npm package providing the rules for `origin: embedded` entries.
   * Used by the loader to read the installed package's `package.json`
   * and populate `resolvedVersion`.  Ignored for non-embedded entries.
   */
  package?: string;
  /**
   * Runtime-populated.  For `origin: embedded` entries, the version of
   * the installed `package` at load time (e.g. "1.22.0").  Surfaced via
   * `spectify rulesets <name>` and the /rulesets API.  Never persisted
   * to config; always derived at load time.
   */
  resolvedVersion?: string;
  /**
   * When set, overrides the sourceRepo/sourceVersion/entrypoint path
   * construction. The loader will load this path directly (resolved relative
   * to cwd if not absolute). Useful for rulesets installed outside the
   * sources/ tree (e.g. via OS package manager or a separate monorepo
   * checkout).
   */
  absolutePath?: string;
  /**
   * Which mechanism to use when loading the ruleset file.
   *
   *   - `'bundler'` (default) — Spectral's Rollup-based
   *     `@stoplight/spectral-ruleset-bundler`.  Handles YAML, ESM JS,
   *     `extends: 'spectral:oas'` token resolution, and named imports
   *     from CJS npm packages (via Rollup interop).  The right choice
   *     for almost every ruleset.
   *
   *   - `'native'` — Node's built-in `await import()`.  Use when the
   *     entrypoint is a CommonJS dist file (typically Babel/`tsc`
   *     output of a TypeScript ruleset) that the bundler chokes on
   *     with `exports is not defined`.  Only valid for `.js` / `.cjs`
   *     / `.mjs` entrypoints — not YAML, not `spectral:*` tokens.
   *
   * Ignored for `origin: embedded` entries (they always go through the
   * bundler shim).
   */
  loader?: 'bundler' | 'native';
}

/**
 * Master configuration file structure (rulesets/config/rulesets.yaml)
 */
export interface RulesetsConfig {
  rulesets: RulesetConfigEntry[];
  defaults: Record<string, string>;  // ruleset name -> default version
}

/**
 * User-facing ruleset metadata (returned by API)
 * Includes computed fields like ruleCount
 */
export interface RulesetMetadata {
  name: string;
  displayName: string;
  category: RulesetCategory;
  origin: RulesetOrigin;
  description: string;
  versions: string[];       // Just version numbers for listing
  defaultVersion: string;
  ruleCount: number;        // Total rules in default version
  tags: string[];
  metadata: {
    team: string;
    maintainer: string;
    contact?: string;
    repository: string;
    license: string;
    documentation?: string;
  };
}

/**
 * @deprecated Use RulesetVersionConfig instead
 * Legacy interface, kept for backward compatibility
 */
export interface RulesetVersionInfo {
  version: string;
  releaseDate: string;
  entrypoint: string;
  deprecated?: boolean;
  changelog?: string;
}

/**
 * Loaded ruleset version with extracted rules
 * Returned by RulesetLoader after parsing Spectral files
 */
export interface RulesetVersion {
  metadata: RulesetMetadata; // Full ruleset metadata
  version: string;           // Orchestrator version
  sourceRepo: string;        // Source repository path
  sourceVersion: string;     // Source version/date
  entrypoint: string;        // Loaded file (e.g., "pubhub.yaml") or Spectral token (e.g., "spectral:oas") for embedded
  rulesetPath: string;       // Absolute path to ruleset file (for worker initialization); for embedded, path to a generated shim
  releaseDate?: string;      // Release date (optional; not applicable for origin: embedded)
  deprecated: boolean;       // Deprecated flag
  changelog?: string;        // Changelog
  rules: RuleDefinition[];   // Extracted rules
  spectralRuleset: any;      // Original Spectral ruleset object (for execution)
  /** For `origin: embedded`: the npm package providing the rules (e.g. `@stoplight/spectral-rulesets`). */
  package?: string;
  /** For `origin: embedded`: the installed version of `package` resolved at load time (e.g. `1.22.0`). */
  resolvedVersion?: string;
  /** Resolved loader (`bundler` | `native`).  Mirrors `RulesetVersionConfig.loader`; defaulted to `'bundler'` at load time and threaded down to the worker. */
  loader?: 'bundler' | 'native';
}

/**
 * Rule definition - scoped to ruleset
 * Rules are uniquely identified by: {rulesetName}:{rulesetVersion}:{name}
 * 
 * Design Decision: Rules are scoped to rulesets, not global entities.
 * See docs/RULESET_MANAGEMENT.md "Rule Management Philosophy"
 */
export interface RuleDefinition {
  name: string;              // Rule name (e.g., "operationId-required-and-unique")
  rulesetName: string;        // Ruleset this rule belongs to (e.g., "pubhub")
  rulesetVersion: string;     // Ruleset version (e.g., "1.1.0")
  severity: RuleSeverity;     // Error, warn, info, hint
  message: string;            // Rule message template
  description?: string;       // Rule description
  given: string | string[];   // JSONPath expression(s)
  then: any;                  // Spectral function configuration
  recommended?: boolean;      // Is this rule recommended? (default: true)
  formats?: string[];         // OAS formats this rule applies to
}

export type RuleEngine = 'spectral' | 'llm' | 'custom';
export type RuleSeverity = 'error' | 'warn' | 'info' | 'hint';

/**
 * Rule override severity levels.
 * 'off' disables the rule entirely; other values change its severity.
 */
export type RuleOverrideSeverity = 'off' | 'error' | 'warn' | 'info' | 'hint';

/**
 * Map of rule IDs to override severity.
 * Used to exclude rules or change their severity at lint-request time.
 */
export type RuleOverrides = Record<string, RuleOverrideSeverity>;

/**
 * Source metadata for reproducing a lint job with native Spectral CLI.
 * Contains everything needed to generate clone + install + run instructions.
 */
export interface RulesetSourceMetadata {
  rulesetName: string;
  displayName: string;
  version: string;
  repositoryUrl: string;       // From metadata.repository (git clone target)
  sourceRepo: string;          // From versions[].sourceRepo (relative path in sources/)
  sourceVersion: string;       // From versions[].sourceVersion (tag, branch, or date)
  entrypoint: string;          // From versions[].entrypoint (--ruleset file)
  hasPackageJson: boolean;     // Whether npm install is needed
  license: string;             // From metadata.license
}

// ============================================
// Job Types
// ============================================

export interface LintJobRequest {
  documentId: string;
  rulesetName: string;
  rulesetVersion?: string;
  callbackUrl?: string;  // URL to POST results to when job completes
  ruleOverrides?: RuleOverrides;  // Override rule severities or disable rules
  options?: {
    forceRun?: boolean;
    priority?: 'low' | 'normal' | 'high';
  };
}

export interface LintJob {
  jobId: string;
  documentId: string;
  rulesetName: string;
  rulesetVersion: string;
  callbackUrl?: string;  // URL to POST results to when job completes
  ruleOverrides?: RuleOverrides;  // Override rule severities or disable rules
  status: JobStatus;
  progress: JobProgress;
  startTime: Date;
  endTime?: Date;
  estimatedCompletion?: Date;
  priority: 'low' | 'normal' | 'high';
  tasks: RuleTask[];
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'timeout'           // Execution exceeded timeout
  | 'cancelled';

export interface JobProgress {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  timeoutTasks: number;  // Tasks that exceeded timeout
  runningTasks: number;
  queuedTasks: number;
}

export interface RuleTask {
  taskId: string;
  jobId: string;
  documentId: string;
  documentPath: string;
  rulesetName: string;
  rulesetVersion: string;
  ruleOverrides?: RuleOverrides;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'timeout' | 'retry';
  attempt: number;
  maxAttempts: number;
  assignedWorker?: string;
  startTime?: Date;
  endTime?: Date;
  result?: RulesetExecutionResult;
  error?: string;
}

// ============================================
// Worker Types
// ============================================

export interface WorkerInfo {
  workerId: string;
  rulesetName: string;
  rulesetVersion: string;
  status: WorkerStatus;
  taskCount: number;
  averageExecutionTime: number;
  lastHeartbeat: Date;
  createdAt: Date;

  // Document cache tracking
  cachedDocumentId?: string;
  cachedAt?: Date;
}

export type WorkerStatus = 'initializing' | 'ready' | 'busy' | 'failed' | 'terminated';

export interface WorkerMessage {
  type: 'init' | 'execute' | 'shutdown' | 'heartbeat' | 'evict-cache';
  payload?: any;
}

export interface WorkerInitMessage extends WorkerMessage {
  type: 'init';
  payload: {
    workerId: string;
    rulesetName: string;
    rulesetVersion: string;
    rulesetPath: string;
  };
}

export interface WorkerExecuteMessage extends WorkerMessage {
  type: 'execute';
  payload: {
    taskId: string;
    documentId: string;
    documentPath: string;
    timeout: number;
    ruleOverrides?: RuleOverrides;
  };
}

export interface WorkerResponse {
  type: 'ready' | 'result' | 'error' | 'heartbeat' | 'cache-evicted';
  taskId?: string;
  success?: boolean;
  executionTime?: number;
  error?: string;
  result?: RulesetExecutionResult;
  cacheHit?: boolean;
}

// ============================================
// Result Types
// ============================================

export interface RulesetExecutionResult {
  rulesetName: string;
  rulesetVersion: string;
  executionTime: number;
  success: boolean;
  error?: string;
  issueCount: number;
  issues: LintIssue[];
  metadata: {
    ruleEngine: string;
    documentId: string;
    cacheHit?: boolean;
  };
}

export interface LintIssue {
  ruleId: string;
  code: string;
  message: string;
  severity: 0 | 1 | 2 | 3; // 0=error, 1=warn, 2=info, 3=hint
  path: (string | number)[];
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  suggestions?: string[];
}

export interface LintJobResult {
  jobId: string;
  documentId: string;
  rulesetName: string;
  rulesetVersion: string;
  ruleOverrides?: RuleOverrides;
  status: JobStatus;
  timestamp: Date;
  totalExecutionTime: number;
  summary: {
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    hintCount: number;
  };
  results: LintIssue[];
  executionDetails: RulesetExecutionResult;
  /** Set when maxIssuesPerJob limit was reached during linting */
  truncated?: boolean;
  truncationInfo?: {
    limit: number;
    actualCount: number;
  };
}

// ============================================
// Paginated Result Types
// ============================================

/**
 * Options for querying lint results with pagination and filtering
 */
export interface LintResultQueryOptions {
  /** Skip first N issues (default: 0) */
  offset?: number;
  /** Max issues to return (default: all) */
  limit?: number;
  /** Filter by severity: 0=error, 1=warn, 2=info, 3=hint */
  severity?: number;
  /** Filter by rule ID (exact match) */
  rule?: string;
  /** Filter by path prefix (dot-separated, e.g. "paths./pets") */
  pathPrefix?: string;
}

/**
 * Paginated lint result response from orchestrator API
 */
export interface PaginatedLintResult {
  jobId: string;
  documentId: string;
  rulesetName: string;
  rulesetVersion: string;
  status: JobStatus;
  timestamp: Date;
  totalExecutionTime: number;
  /** Always the full job summary, regardless of filters */
  summary: {
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    hintCount: number;
  };
  /** The (possibly filtered and paginated) issues */
  results: LintIssue[];
  /** Pagination metadata — present when offset or limit is used */
  pagination?: {
    offset: number;
    limit: number;
    returned: number;
    totalMatching: number;
    hasMore: boolean;
  };
  /** Active filters — present when severity, rule, or pathPrefix is used */
  filters?: {
    severity: number | null;
    rule: string | null;
    pathPrefix: string | null;
  };
  /** Truncation info — present when maxIssuesPerJob limit was hit */
  truncated?: boolean;
  truncationInfo?: {
    limit: number;
    actualCount: number;
  };
}

/**
 * Rule breakdown entry for lint result statistics
 */
export interface RuleBreakdownEntry {
  rule: string;
  count: number;
  severity: 0 | 1 | 2 | 3;
}

/**
 * Aggregated statistics for a lint job result
 */
export interface LintResultStats {
  jobId: string;
  documentId: string;
  rulesetName: string;
  rulesetVersion: string;
  status: JobStatus;
  summary: {
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    hintCount: number;
  };
  /** Issue counts grouped by rule ID, sorted by count descending */
  ruleBreakdown: RuleBreakdownEntry[];
  /** Top path prefixes with most issues */
  topPaths: { pathPrefix: string; count: number }[];
  /** Truncation info if result was truncated */
  truncated?: boolean;
  truncationInfo?: {
    limit: number;
    actualCount: number;
  };
}

// ============================================
// Storage Interface
// ============================================

export interface LintResultStorage {
  /**
   * Store complete job result
   */
  storeJob(result: LintJobResult): Promise<void>;

  /**
   * Retrieve job result by job ID
   */
  retrieveJobById(jobId: string): Promise<LintJobResult | null>;

  /**
   * Retrieve job result by document + ruleset
   */
  retrieveJob(
    documentId: string,
    rulesetName: string,
    rulesetVersion: string
  ): Promise<LintJobResult | null>;

  /**
   * Check if cached results exist
   */
  exists(
    documentId: string,
    rulesetName: string,
    rulesetVersion: string
  ): Promise<boolean>;

  /**
   * Invalidate all results for a document
   */
  invalidate(documentId: string): Promise<void>;

  /**
   * Get storage statistics
   */
  getStats(): Promise<{
    totalJobs: number;
    totalResults: number;
    storageSize?: number;
  }>;
}

// ============================================
// Pool Manager Interface
// ============================================

export interface IWorkerPoolManager {
  /**
   * Initialize the worker pool
   */
  initialize(config: WorkerPoolConfig): Promise<void>;

  /**
   * Get or create worker for specific ruleset
   */
  getWorkerForRuleset(
    rulesetName: string,
    rulesetVersion: string,
    ruleset: RulesetVersion
  ): Promise<string>;

  /**
   * Assign task to worker with document affinity
   */
  assignTask(task: RuleTask): Promise<void>;

  /**
   * Get workers that have a specific document cached
   */
  getWorkersWithDocument(documentId: string): WorkerInfo[];

  /**
   * Update document cache tracking
   */
  updateDocumentCache(workerId: string, documentId: string): void;

  /**
   * Get pool status
   */
  getStatus(): {
    activeWorkers: number;
    idleWorkers: number;
    busyWorkers: number;
    totalWorkers: number;
    workersByRuleset: Record<string, number>;
  };

  /**
   * Shutdown all workers
   */
  shutdown(): Promise<void>;
}

// ============================================
// Document Accessor Interface
// ============================================

export interface IDocumentAccessor {
  /**
   * Get the file path for a document
   */
  getDocumentPath(documentId: string): string;

  /**
   * Check if document exists
   */
  exists(documentId: string): Promise<boolean>;

  /**
   * Get document content (for fallback scenarios)
   */
  getDocumentContent(documentId: string): Promise<any>;
}

// ============================================
// Orchestrator Interface
// ============================================

export interface IOrchestrator {
  /**
   * Submit a new lint job
   */
  submitJob(request: LintJobRequest): Promise<string>;

  /**
   * Get job status
   */
  getJobStatus(jobId: string): Promise<LintJob | null>;

  /**
   * Get job results
   */
  getJobResults(jobId: string): Promise<LintJobResult | null>;

  /**
   * Cancel a job
   */
  cancelJob(jobId: string): Promise<void>;
}

// ============================================
// Ruleset Loader Interface
// ============================================

export interface IRulesetLoader {
  /**
   * Initialize ruleset loader
   */
  initialize(): Promise<void>;

  /**
   * Load ruleset metadata
   */
  loadRuleset(name: string): Promise<RulesetMetadata>;

  /**
   * Load specific version of ruleset
   */
  loadVersion(name: string, version?: string): Promise<RulesetVersion>;

  /**
   * Get all available rulesets
   */
  listRulesets(): Promise<RulesetMetadata[]>;

  /**
   * Get default version for a ruleset
   */
  getDefaultVersion(name: string): Promise<string>;
}

// ============================================
// HTTP API Types
// ============================================

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  workerPool: {
    activeWorkers: number;
    maxWorkers: number;
    idleWorkers: number;
    busyWorkers: number;
    queueDepth: number;
  };
  storage: {
    connected: boolean;
    type: string;
  };
}

export interface LintJobResponse {
  jobId: string;
  status: JobStatus;
  estimatedCompletion?: string;
  message: string;
}

export interface JobStatusResponse {
  jobId: string;
  documentId: string;
  rulesetName: string;
  rulesetVersion: string;
  status: JobStatus;
  progress: JobProgress;
  startTime: string;
  endTime?: string;
  estimatedCompletion?: string;
}

export interface JobResultsResponse extends LintJobResult {
  // Same as LintJobResult but with string dates for JSON serialization
}

export interface RulesetsListResponse {
  rulesets: RulesetMetadata[];
}

export interface RulesetDetailsResponse extends RulesetVersion {
  // Same as RulesetVersion but with additional metadata
}

export interface ErrorResponse {
  error: string;
  details?: Record<string, any>;
  timestamp: string;
}

// ============================================
// SARIF 2.1.0 Types (Static Analysis Results Interchange Format)
// ============================================

/**
 * SARIF Report (top-level structure)
 * Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */
export interface SarifReport {
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json';
  version: '2.1.0';
  runs: SarifRun[];
}

/**
 * SARIF Run - represents one execution of an analysis tool
 */
export interface SarifRun {
  tool: SarifTool;
  artifacts?: SarifArtifact[];
  results: SarifResult[];
  properties?: Record<string, any>;
}

/**
 * SARIF Tool - analysis tool metadata
 */
export interface SarifTool {
  driver: SarifToolDriver;
}

/**
 * SARIF Tool Driver - analysis tool details
 */
export interface SarifToolDriver {
  name: string;
  version?: string;
  informationUri?: string;
  rules?: SarifRule[];
}

/**
 * SARIF Rule - rule catalog entry
 */
export interface SarifRule {
  id: string;
  name?: string;
  shortDescription?: SarifMessage;
  fullDescription?: SarifMessage;
  defaultConfiguration?: SarifRuleConfiguration;
  helpUri?: string;
  properties?: Record<string, any>;
}

/**
 * SARIF Rule Configuration
 */
export interface SarifRuleConfiguration {
  level?: SarifLevel;
}

/**
 * SARIF Message
 */
export interface SarifMessage {
  text: string;
}

/**
 * SARIF Result - a single finding/issue
 */
export interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: SarifMessage;
  locations?: SarifLocation[];
  fingerprints?: Record<string, string>;
  properties?: Record<string, any>;
}

/**
 * SARIF Level (severity)
 */
export type SarifLevel = 'error' | 'warning' | 'note' | 'none';

/**
 * SARIF Location
 */
export interface SarifLocation {
  physicalLocation?: SarifPhysicalLocation;
}

/**
 * SARIF Physical Location
 */
export interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation;
  region?: SarifRegion;
}

/**
 * SARIF Artifact Location
 */
export interface SarifArtifactLocation {
  uri: string;
  index?: number;
}

/**
 * SARIF Region (line/column range)
 */
export interface SarifRegion {
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  snippet?: SarifArtifactContent;
}

/**
 * SARIF Artifact Content (code snippet)
 */
export interface SarifArtifactContent {
  text: string;
}

/**
 * SARIF Artifact - file metadata
 */
export interface SarifArtifact {
  location: SarifArtifactLocation;
  properties?: Record<string, any>;
}

/**
 * Report generation request
 */
export interface ReportGenerationRequest {
  format: 'sarif';  // Only SARIF supported in Phase 1
  options?: ReportGenerationOptions;
}

/**
 * Report generation options
 */
export interface ReportGenerationOptions {
  includeSnippets?: boolean;
  fingerprintSchemes?: string[];
}

// ============================================
// Job and Document Listing Types (v0.8.0)
// ============================================

/**
 * Options for listing jobs
 */
export interface ListJobsOptions {
  // Filters
  status?: JobStatus | JobStatus[];
  documentId?: string;
  rulesetName?: string;
  startDate?: Date;
  endDate?: Date;
  sessionId?: string;  // Runtime session ID for filtering stale jobs

  // Pagination
  limit?: number;
  offset?: number;
  sortBy?: 'timestamp' | 'status' | 'documentId' | 'rulesetName';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Lightweight job summary (without document metadata)
 */
export interface JobSummary {
  jobId: string;
  documentId: string;  // ID only, no document metadata
  rulesetName: string;
  rulesetVersion: string;
  status: JobStatus;
  timestamp: Date;
  totalExecutionTime?: number;
  summary: {
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    hintCount: number;
  };
}

/**
 * Job summary with enriched document metadata
 */
export interface JobDetailed extends JobSummary {
  document: DocumentMetadata;  // Always present
}

/**
 * Document metadata from document store
 */
export interface DocumentMetadata {
  documentId: string;
  name: string;
  version?: string;
  organization?: string;
  tags?: string[];
  format?: 'json' | 'yaml';
  operationCount?: number;
  uploadedAt?: Date;
  updatedAt?: Date;
  uploadedBy?: string;
  size?: number;
}

/**
 * Paginated response for job listing
 */
export interface ListJobsResponse {
  jobs: JobSummary[] | JobDetailed[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  sessionId: string;  // Current runtime session ID
}

/**
 * Document lint activity summary
 */
export interface DocumentLintActivity {
  documentId: string;
  totalJobs: number;
  lastLintedAt?: Date;
  jobsByStatus: Record<JobStatus, number>;
  jobsByRuleset: Record<string, number>;
}
