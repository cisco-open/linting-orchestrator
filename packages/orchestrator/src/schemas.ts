// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * OpenAPI/JSON Schema definitions for all orchestrator API responses.
 *
 * These schemas are consumed by @fastify/swagger to auto-generate the
 * OpenAPI 3.0 specification from running code.  They also double as
 * Fastify response-validation schemas at runtime (opt-in).
 *
 * Naming convention:  Schema*  → reusable $ref building-blocks
 *                     *Schema → full route-level response/request schemas
 *
 * @module schemas
 */

// ============================================
// Shared / Reusable Schemas  ($ref targets)
// ============================================

export const ErrorResponseSchema = {
  $id: 'ErrorResponse',
  type: 'object',
  description: 'Standard error response returned by all endpoints on failure',
  required: ['error', 'timestamp'],
  properties: {
    error: {
      type: 'string',
      description: 'Error category (e.g., Not Found, Validation Error, Internal Server Error)',
      example: 'Not Found',
    },
    message: {
      type: 'string',
      description: 'Human-readable error message with context',
      example: 'Document not found: abc-123',
    },
    details: {
      type: 'object',
      description: 'Additional error details such as validation errors or field-level issues',
      additionalProperties: true,
    },
    timestamp: {
      type: 'string',
      format: 'date-time',
      description: 'ISO 8601 timestamp when the error occurred',
      example: '2026-03-05T12:00:00.000Z',
    },
  },
} as const;

export const JobStatusSchema = {
  $id: 'JobStatus',
  type: 'string',
  description: 'Lifecycle status of a lint job',
  enum: [
    'queued',
    'running',
    'completed',
    'completed_with_errors',
    'failed',
    'timeout',
    'cancelled',
  ],
  example: 'completed',
} as const;

export const JobProgressSchema = {
  $id: 'JobProgress',
  type: 'object',
  description: 'Task-level progress breakdown for a lint job',
  properties: {
    totalTasks: { type: 'integer', description: 'Total number of tasks in the job', example: 1 },
    completedTasks: { type: 'integer', description: 'Number of tasks that completed successfully', example: 1 },
    failedTasks: { type: 'integer', description: 'Number of tasks that failed with errors', example: 0 },
    timeoutTasks: { type: 'integer', description: 'Number of tasks that exceeded the execution timeout', example: 0 },
    runningTasks: { type: 'integer', description: 'Number of tasks currently being executed', example: 0 },
    queuedTasks: { type: 'integer', description: 'Number of tasks waiting in the queue', example: 0 },
  },
} as const;

export const SourcePositionSchema = {
  $id: 'SourcePosition',
  type: 'object',
  description: 'A position in a text document identified by line and character offset',
  properties: {
    line: { type: 'integer', description: 'Zero-based line number in the source document', example: 62 },
    character: { type: 'integer', description: 'Zero-based character offset within the line', example: 20 },
  },
} as const;

export const SourceRangeSchema = {
  $id: 'SourceRange',
  type: 'object',
  description: 'Source location range within the document (line and character positions)',
  properties: {
    start: { $ref: 'SourcePosition#' },
    end: { $ref: 'SourcePosition#' },
  },
} as const;

export const LintIssueSchema = {
  $id: 'LintIssue',
  type: 'object',
  description: 'A single lint issue found in the document',
  properties: {
    ruleId: {
      type: 'string',
      description: 'Unique identifier of the rule that triggered this issue',
      example: 'error-status-code',
    },
    code: {
      type: 'string',
      description: 'Machine-readable issue code from the ruleset',
      example: 'error-status-code',
    },
    message: {
      type: 'string',
      description: 'Human-readable description of the issue',
      example: 'responses should include at least one error status code (4xx or 5xx)',
    },
    severity: {
      type: 'integer',
      enum: [0, 1, 2, 3],
      description: 'Severity level: 0=error, 1=warn, 2=info, 3=hint',
      example: 1,
    },
    path: {
      type: 'array',
      description: 'JSONPath segments to the location of the issue in the document',
      items: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
      example: ['paths', '/health', 'get', 'responses'],
    },
    range: { $ref: 'SourceRange#' },
    suggestions: {
      type: 'array',
      description: 'Suggested fixes or improvements for the issue',
      items: { type: 'string' },
      example: ['Add a 4xx or 5xx response to this operation'],
    },
  },
} as const;

export const ResultSummarySchema = {
  $id: 'ResultSummary',
  type: 'object',
  description: 'Aggregated issue counts by severity level',
  properties: {
    totalIssues: { type: 'integer', description: 'Total number of issues found across all severity levels', example: 13 },
    errorCount: { type: 'integer', description: 'Number of issues with error severity (must fix)', example: 5 },
    warningCount: { type: 'integer', description: 'Number of issues with warning severity (should fix)', example: 8 },
    infoCount: { type: 'integer', description: 'Number of informational issues', example: 0 },
    hintCount: { type: 'integer', description: 'Number of hint-level suggestions', example: 0 },
  },
} as const;

export const RulesetExecutionResultSchema = {
  $id: 'RulesetExecutionResult',
  type: 'object',
  description: 'Execution details for a single ruleset run against a document',
  properties: {
    rulesetName: { type: 'string', description: 'Name of the executed ruleset', example: 'pubhub' },
    rulesetVersion: { type: 'string', description: 'Version of the executed ruleset', example: '1.1.0' },
    executionTime: { type: 'number', description: 'Execution time in milliseconds for this ruleset', example: 277 },
    success: { type: 'boolean', description: 'Whether the ruleset execution completed without internal errors', example: true },
    error: { type: 'string', description: 'Error message if the ruleset execution failed internally', example: '' },
    issueCount: { type: 'integer', description: 'Total number of issues found by this ruleset', example: 0 },
    issues: {
      type: 'array',
      description: 'List of issues found by this ruleset',
      items: { $ref: 'LintIssue#' },
    },
    metadata: {
      type: 'object',
      description: 'Execution metadata for this ruleset run',
      properties: {
        ruleEngine: { type: 'string', description: 'Name of the rule engine that executed the ruleset', example: 'spectral' },
        documentId: { type: 'string', description: 'Identifier of the linted document', example: '41c1d4aa-5825-4313-8ae5-737490707b5b' },
        cacheHit: { type: 'boolean', description: 'Whether the result was served from cache', example: false },
      },
    },
  },
} as const;

export const RuleInfoSchema = {
  $id: 'RuleInfo',
  type: 'object',
  description: 'Metadata for a single lint rule within a ruleset',
  properties: {
    name: { type: 'string', description: 'Unique rule identifier within the ruleset', example: 'operationId-required-and-unique' },
    severity: { type: 'string', enum: ['error', 'warn', 'info', 'hint'], description: 'Default severity level of the rule', example: 'error' },
    message: { type: 'string', description: 'Message template shown when the rule is triggered', example: 'Every operation must have a unique operationId' },
    description: { type: 'string', description: 'Detailed explanation of what the rule checks and why', example: 'Ensures every operation has a unique operationId for code generation' },
    recommended: { type: 'boolean', description: 'Whether this rule is recommended to be enabled', example: true },
  },
} as const;

export const DocumentSummarySchema = {
  $id: 'DocumentSummary',
  type: 'object',
  description: 'Summary metadata for an uploaded document',
  properties: {
    documentId: { type: 'string', description: 'Unique document identifier', example: '41c1d4aa-5825-4313-8ae5-737490707b5b' },
    title: { type: 'string', description: 'Title from the document info section', example: 'My API' },
    version: { type: 'string', description: 'API version from the document', example: '1.0.0' },
    format: { type: 'string', description: 'Document format (json or yaml)', example: 'json' },
    uploadedAt: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp when the document was uploaded', example: '2026-03-05T12:00:00.000Z' },
  },
} as const;

export const RuleOverridesSchema = {
  $id: 'RuleOverrides',
  type: 'object',
  description: 'Map of rule IDs to override severity. Use "off" to exclude a rule, or a severity level to change it.',
  additionalProperties: {
    type: 'string',
    enum: ['off', 'error', 'warn', 'info', 'hint'],
  },
  example: { 'operationId-required': 'off', 'error-status-code': 'warn' },
} as const;

// ============================================
// Response Schemas  (route-level)
// ============================================

export const HealthResponseSchema = {
  $id: 'HealthResponse',
  type: 'object',
  description: 'Server health status including uptime, configuration, and runtime statistics',
  properties: {
    status: { type: 'string', enum: ['ok'], description: 'Server health status indicator', example: 'ok' },
    version: { type: 'string', description: 'Orchestrator server version (semver)', example: '0.11.0' },
    timestamp: { type: 'string', format: 'date-time', description: 'Current server time in ISO 8601 format', example: '2026-03-05T12:00:00.000Z' },
    uptime: { type: 'integer', description: 'Server uptime in seconds since last start', example: 3600 },
    mode: { type: 'string', enum: ['standalone', 'embedded', 'companion', 'mcp'], description: 'Current deployment mode of the server', example: 'standalone' },
    server: {
      type: 'object',
      description: 'HTTP server configuration details',
      properties: {
        port: { type: 'integer', description: 'Port the server is listening on', example: 3003 },
        host: { type: 'string', description: 'Host address the server is bound to', example: '0.0.0.0' },
        startedAt: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp when the server started', example: '2026-03-05T11:00:00.000Z' },
      },
    },
    documentStore: {
      type: 'object',
      description: 'Document storage backend configuration',
      properties: {
        type: { type: 'string', enum: ['local', 'passthrough'], description: 'Type of document store in use', example: 'local' },
        baseDir: { type: 'string', description: 'Relative base directory for document storage', example: './uploads' },
        fullPath: { type: 'string', description: 'Absolute resolved path to the document storage directory', example: '/home/user/spectify/uploads' },
      },
    },
    stats: {
      type: 'object',
      description: 'Orchestrator runtime statistics snapshot (active jobs, worker counts, etc.)',
      additionalProperties: true,
      example: { activeJobs: 0, totalJobsProcessed: 42 },
    },
    runtime: {
      type: 'object',
      description: 'Runtime environment information (Node.js version, Spectral library versions, active resolver).',
      properties: {
        nodeVersion: { type: 'string', description: 'Node.js runtime version', example: 'v22.18.0' },
        spectralCore: { type: 'string', description: 'Installed @stoplight/spectral-core version', example: '1.19.0' },
        spectralRulesets: { type: 'string', description: 'Installed @stoplight/spectral-rulesets version', example: '1.22.0' },
        spectralCli: { type: 'string', description: 'Installed @stoplight/spectral-cli version', example: '6.16.0' },
        resolver: {
          type: ['string', 'null'],
          description: 'Active custom $ref resolver name, or null when using Spectral default resolver',
          example: 'ignore-external-refs',
        },
      },
    },
    reportService: {
      type: 'object',
      description: 'Report Service connection status. Only present when configured.',
      additionalProperties: true,
      example: { connected: true, url: 'http://localhost:3010' },
    },
  },
} as const;

export const DocumentUploadResponseSchema = {
  $id: 'DocumentUploadResponse',
  type: 'object',
  description: 'Response after successfully uploading a document',
  properties: {
    documentId: { type: 'string', description: 'Unique identifier assigned to the uploaded document', example: '41c1d4aa-5825-4313-8ae5-737490707b5b' },
    version: { type: 'string', description: 'Version identifier of the stored document', example: '1' },
    message: { type: 'string', description: 'Human-readable confirmation message', example: 'Document uploaded successfully' },
  },
} as const;

export const DocumentUploadRequestSchema = {
  $id: 'DocumentUploadRequest',
  type: 'object',
  description: 'Request body for uploading a document',
  required: ['content'],
  properties: {
    content: { type: 'string', description: 'Raw document content as a JSON or YAML string', example: '{"openapi":"3.0.0","info":{"title":"My API","version":"1.0"},"paths":{}}' },
    format: { type: 'string', enum: ['json', 'yaml'], default: 'json', description: 'Format of the document content being uploaded', example: 'json' },
    metadata: { type: 'object', description: 'Optional metadata to associate with the uploaded document', additionalProperties: true, example: { team: 'platform', tags: ['internal'] } },
  },
} as const;

export const DocumentListResponseSchema = {
  $id: 'DocumentListResponse',
  type: 'object',
  description: 'Paginated list of uploaded documents with metadata',
  properties: {
    documents: {
      type: 'array',
      description: 'Array of document summary objects',
      items: { $ref: 'DocumentSummary#' },
    },
    total: { type: 'integer', description: 'Total number of documents matching the query', example: 42 },
    limit: { type: 'integer', description: 'Maximum number of results returned in this page', example: 50 },
    offset: { type: 'integer', description: 'Number of results skipped for pagination', example: 0 },
  },
} as const;

export const DocumentResponseSchema = {
  $id: 'DocumentResponse',
  type: 'object',
  description: 'Full document object including content and metadata',
  properties: {
    documentId: { type: 'string', description: 'Unique document identifier', example: '41c1d4aa-5825-4313-8ae5-737490707b5b' },
    content: { type: 'string', description: 'Raw document content as stored', example: '{"openapi":"3.0.0","info":{"title":"My API","version":"1.0"},"paths":{}}' },
    format: { type: 'string', description: 'Document format (json or yaml)', example: 'json' },
    metadata: { type: 'object', description: 'User-supplied metadata associated with the document', additionalProperties: true, example: { team: 'platform' } },
    uploadedAt: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp when the document was uploaded', example: '2026-03-05T12:00:00.000Z' },
  },
} as const;

export const LintJobSubmitResponseSchema = {
  $id: 'LintJobSubmitResponse',
  type: 'object',
  description: 'Response returned when a lint job is successfully queued',
  properties: {
    jobId: { type: 'string', format: 'uuid', description: 'Unique job identifier for tracking progress and retrieving results', example: '94c9db52-92fc-4733-806a-fe6d206109aa' },
    status: { type: 'string', enum: ['queued'], description: 'Initial status of the newly created job', example: 'queued' },
    message: { type: 'string', description: 'Human-readable confirmation message', example: 'Job submitted successfully' },
  },
} as const;

export const CapacityExceededResponseSchema = {
  $id: 'CapacityExceededResponse',
  type: 'object',
  description: 'Response returned when the server cannot accept new jobs due to capacity limits',
  properties: {
    error: { type: 'string', description: 'Error type identifier', example: 'Too Many Requests' },
    message: { type: 'string', description: 'Human-readable explanation of the capacity limit', example: 'Server at capacity with 50 active jobs (max 50)' },
    activeJobs: { type: 'integer', description: 'Number of currently active (queued or running) jobs', example: 50 },
    maxJobs: { type: 'integer', description: 'Maximum number of concurrent jobs the server allows', example: 50 },
    retryAfter: { type: 'integer', description: 'Suggested number of seconds to wait before retrying', example: 5 },
  },
} as const;

export const LintJobStatusSchema = {
  $id: 'LintJobStatus',
  type: 'object',
  description: 'Current status and progress of a lint job',
  properties: {
    jobId: { type: 'string', format: 'uuid', description: 'Unique job identifier', example: '94c9db52-92fc-4733-806a-fe6d206109aa' },
    documentId: { type: 'string', description: 'Identifier of the document being linted', example: '41c1d4aa-5825-4313-8ae5-737490707b5b' },
    rulesetName: { type: 'string', description: 'Name of the ruleset used for linting', example: 'pubhub' },
    rulesetVersion: { type: 'string', description: 'Version of the ruleset used for linting', example: '1.1.0' },
    ruleOverrides: { $ref: 'RuleOverrides#' },
    status: { $ref: 'JobStatus#' },
    progress: { $ref: 'JobProgress#' },
    startTime: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp when the job started processing', example: '2026-03-05T12:00:00.000Z' },
    endTime: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp when the job finished', example: '2026-03-05T12:00:01.000Z' },
  },
} as const;

export const LintJobResultSchema = {
  $id: 'LintJobResult',
  type: 'object',
  description: 'Complete results of a finished lint job including all issues and execution metadata',
  properties: {
    jobId: { type: 'string', format: 'uuid', description: 'Unique job identifier', example: '94c9db52-92fc-4733-806a-fe6d206109aa' },
    documentId: { type: 'string', description: 'Identifier of the document that was linted', example: '41c1d4aa-5825-4313-8ae5-737490707b5b' },
    rulesetName: { type: 'string', description: 'Name of the ruleset used for linting', example: 'pubhub' },
    rulesetVersion: { type: 'string', description: 'Version of the ruleset used for linting', example: '1.1.0' },
    ruleOverrides: { $ref: 'RuleOverrides#' },
    status: { $ref: 'JobStatus#' },
    timestamp: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp when the job completed', example: '2026-03-05T12:00:01.000Z' },
    totalExecutionTime: { type: 'number', description: 'Total execution time of the job in milliseconds', example: 321 },
    summary: { $ref: 'ResultSummary#' },
    results: {
      type: 'array',
      description: 'List of all lint issues found in the document',
      items: { $ref: 'LintIssue#' },
    },
    executionDetails: { $ref: 'RulesetExecutionResult#' },
  },
} as const;

export const ReportGenerationRequestSchema = {
  $id: 'ReportGenerationRequest',
  type: 'object',
  description: 'Request body to generate a report from a completed lint job',
  required: ['format'],
  properties: {
    format: { type: 'string', enum: ['sarif'], description: 'Output format for the report. Currently only SARIF is supported.', example: 'sarif' },
    options: {
      type: 'object',
      description: 'Optional report generation settings',
      properties: {
        includeSnippets: { type: 'boolean', description: 'Include source code snippets in the report for each issue', example: true },
        fingerprintSchemes: { type: 'array', description: 'List of fingerprint scheme names to include for result deduplication', items: { type: 'string' }, example: ['v1'] },
      },
    },
  },
} as const;

export const SarifReportSchema = {
  $id: 'SarifReport',
  type: 'object',
  description: 'SARIF v2.1.0 (Static Analysis Results Interchange Format) report',
  properties: {
    version: { type: 'string', description: 'SARIF format version', example: '2.1.0' },
    $schema: { type: 'string', description: 'SARIF JSON schema URI', example: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json' },
    runs: {
      type: 'array',
      description: 'Array of analysis runs. Each lint job produces one run.',
      items: {
        type: 'object',
        description: 'A single SARIF analysis run containing tool info and results',
        properties: {
          tool: {
            type: 'object',
            description: 'Information about the analysis tool and its rules',
            properties: {
              driver: {
                type: 'object',
                description: 'The primary analysis tool driver',
                properties: {
                  name: { type: 'string', description: 'Tool name', example: 'cisco-linting-orchestrator' },
                  version: { type: 'string', description: 'Tool version', example: '0.11.0' },
                },
              },
            },
          },
          results: {
            type: 'array',
            description: 'Array of analysis results (issues found)',
            items: {
              type: 'object',
              description: 'A single analysis result',
              properties: {
                ruleId: { type: 'string', description: 'Identifier of the rule that produced this result', example: 'error-status-code' },
                message: {
                  type: 'object',
                  description: 'Message describing the result',
                  properties: {
                    text: { type: 'string', description: 'Plain text message', example: 'responses should include at least one error status code' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const JobSummarySchema = {
  $id: 'JobSummary',
  type: 'object',
  description: 'Lightweight summary of a lint job for list views',
  properties: {
    jobId: { type: 'string', format: 'uuid', description: 'Unique job identifier', example: '94c9db52-92fc-4733-806a-fe6d206109aa' },
    documentId: { type: 'string', description: 'Identifier of the linted document', example: '41c1d4aa-5825-4313-8ae5-737490707b5b' },
    rulesetName: { type: 'string', description: 'Name of the ruleset used for linting', example: 'pubhub' },
    rulesetVersion: { type: 'string', description: 'Version of the ruleset used for linting', example: '1.1.0' },
    status: { $ref: 'JobStatus#' },
    timestamp: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp when the job completed', example: '2026-03-05T12:00:01.000Z' },
    totalExecutionTime: { type: 'number', description: 'Total execution time in milliseconds', example: 321 },
    summary: { $ref: 'ResultSummary#' },
  },
} as const;

export const JobListResponseSchema = {
  $id: 'JobListResponse',
  type: 'object',
  description: 'Paginated list of lightweight job summaries',
  properties: {
    jobs: {
      type: 'array',
      description: 'Array of job summary objects',
      items: { $ref: 'JobSummary#' },
    },
    pagination: {
      type: 'object',
      description: 'Pagination metadata',
      properties: {
        total: { type: 'integer', description: 'Total number of jobs matching the filter criteria', example: 10 },
        limit: { type: 'integer', description: 'Maximum number of results returned in this page', example: 50 },
        offset: { type: 'integer', description: 'Number of results skipped for pagination', example: 0 },
        hasMore: { type: 'boolean', description: 'Whether more results are available beyond this page', example: false },
      },
    },
    sessionId: { type: 'string', description: 'Runtime session ID used to filter stale jobs from previous server instances', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
  },
} as const;

export const JobListDetailedResponseSchema = {
  $id: 'JobListDetailedResponse',
  type: 'object',
  description: 'Paginated list of jobs with full document metadata attached',
  properties: {
    jobs: {
      type: 'array',
      description: 'Array of detailed job objects including document metadata',
      items: {
        type: 'object',
        description: 'A job summary enriched with document metadata',
        properties: {
          jobId: { type: 'string', format: 'uuid', description: 'Unique job identifier', example: '94c9db52-92fc-4733-806a-fe6d206109aa' },
          documentId: { type: 'string', description: 'Identifier of the linted document', example: '41c1d4aa-5825-4313-8ae5-737490707b5b' },
          rulesetName: { type: 'string', description: 'Name of the ruleset used for linting', example: 'pubhub' },
          rulesetVersion: { type: 'string', description: 'Version of the ruleset used for linting', example: '1.1.0' },
          status: { $ref: 'JobStatus#' },
          timestamp: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp when the job completed', example: '2026-03-05T12:00:01.000Z' },
          totalExecutionTime: { type: 'number', description: 'Total execution time in milliseconds', example: 321 },
          summary: { $ref: 'ResultSummary#' },
          document: {
            type: 'object',
            description: 'Document metadata from the document store',
            properties: {
              documentId: { type: 'string', description: 'Document identifier' },
              name: { type: 'string', description: 'Document name or filename', example: 'my-api.yaml' },
              version: { type: 'string', description: 'version from the document', example: '1.0.0' },
              organization: { type: 'string', description: 'Organization that owns the document' },
              format: { type: 'string', enum: ['json', 'yaml'], description: 'Document format' },
              operationCount: { type: 'integer', description: 'Number of operations in the document' },
              size: { type: 'integer', description: 'Document size in bytes' },
            },
          },
        },
      },
    },
    pagination: {
      type: 'object',
      description: 'Pagination metadata',
      properties: {
        total: { type: 'integer', description: 'Total number of jobs matching the filter criteria', example: 10 },
        limit: { type: 'integer', description: 'Maximum number of results returned in this page', example: 50 },
        offset: { type: 'integer', description: 'Number of results skipped for pagination', example: 0 },
        hasMore: { type: 'boolean', description: 'Whether more results are available beyond this page', example: false },
      },
    },
    sessionId: { type: 'string', description: 'Runtime session ID used to filter stale jobs', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
  },
} as const;

export const CacheInvalidationResponseSchema = {
  $id: 'CacheInvalidationResponse',
  type: 'object',
  description: 'Response confirming cache invalidation for a document',
  properties: {
    message: { type: 'string', description: 'Human-readable confirmation message', example: 'Cache invalidated for document: abc-123' },
  },
} as const;

export const RulesetSummarySchema = {
  $id: 'RulesetSummary',
  type: 'object',
  description: 'Summary metadata for an available ruleset',
  properties: {
    name: { type: 'string', description: 'Unique ruleset identifier (kebab-case)', example: 'pubhub' },
    version: { type: 'string', description: 'Default version of the ruleset', example: '1.1.0' },
    defaultVersion: { type: 'string', description: 'Default version used when no version is specified', example: '1.1.0' },
    description: { type: 'string', description: 'Brief description of what the ruleset validates', example: 'Validates documents for PubHub publishing readiness' },
    availableVersions: { type: 'array', description: 'List of all available version identifiers for this ruleset', items: { type: 'string' }, example: ['1.0.0', '1.1.0'] },
    displayName: { type: 'string', description: 'Human-friendly display name for the ruleset', example: 'PubHub Publishing Readiness' },
    category: { type: 'string', enum: ['publishing', 'contract', 'security', 'documentation', 'validation', 'other'], description: 'Classification category of the ruleset', example: 'publishing' },
    ruleCount: { type: 'integer', description: 'Number of rules in the default version of this ruleset', example: 60 },
    tags: { type: 'array', description: 'Tags for filtering or grouping rulesets', items: { type: 'string' }, example: ['api-insights', 'documentation'] },
  },
} as const;

export const RulesetDetailsSchema = {
  $id: 'RulesetDetails',
  type: 'object',
  description: 'Detailed information about a ruleset including all individual rules',
  properties: {
    name: { type: 'string', description: 'Unique ruleset identifier (kebab-case)', example: 'pubhub' },
    displayName: { type: 'string', description: 'Human-friendly display name for the ruleset', example: 'PubHub Publishing Readiness' },
    version: { type: 'string', description: 'Version of the loaded ruleset', example: '1.1.0' },
    description: { type: 'string', description: 'Brief description of what the ruleset validates', example: 'Validates documents for PubHub publishing readiness' },
    category: { type: 'string', enum: ['publishing', 'contract', 'security', 'documentation', 'validation', 'other'], description: 'Classification category', example: 'publishing' },
    ruleCount: { type: 'integer', description: 'Total number of rules in this ruleset version', example: 60 },
    releaseDate: { type: 'string', description: 'Release date of this ruleset version', example: '2025-11-19' },
    deprecated: { type: 'boolean', description: 'Whether this ruleset version is deprecated', example: false },
    tags: { type: 'array', description: 'Tags for filtering or grouping rulesets', items: { type: 'string' }, example: ['api-insights', 'documentation'] },
    rules: { type: 'array', description: 'List of all individual rules in this ruleset version', items: { $ref: 'RuleInfo#' } },
  },
} as const;

export const StatsResponseSchema = {
  $id: 'StatsResponse',
  type: 'object',
  description: 'Combined storage and orchestrator statistics',
  properties: {
    storage: {
      type: 'object',
      description: 'Statistics about the lint result storage backend',
      properties: {
        totalJobs: { type: 'integer', description: 'Total number of jobs stored', example: 42 },
        totalResults: { type: 'integer', description: 'Total number of lint results stored', example: 42 },
        storageSize: { type: 'number', description: 'Approximate storage size in bytes', example: 102400 },
      },
    },
    orchestrator: {
      type: 'object',
      description: 'Orchestrator runtime statistics including active jobs and worker pool state',
      additionalProperties: true,
      example: { activeJobs: 0, totalJobsProcessed: 42, workerPoolSize: 4 },
    },
    timestamp: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp when the statistics were collected', example: '2026-03-05T12:00:00.000Z' },
  },
} as const;

// ============================================
// Query-string schemas (for route.schema.querystring)
// ============================================

export const DocumentListQuerySchema = {
  type: 'object',
  description: 'Query parameters for listing or searching documents',
  properties: {
    limit: { type: 'integer', default: 50, description: 'Maximum number of results to return' },
    offset: { type: 'integer', default: 0, description: 'Number of results to skip for pagination' },
    sortBy: { type: 'string', default: 'uploadedAt', description: 'Field to sort by' },
    sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc', description: 'Sort direction' },
    search: { type: 'string', description: 'Text search query across document metadata' },
    organization: { type: 'string', description: 'Filter by organization' },
    tags: { type: 'string', description: 'Comma-separated list of tags to filter by' },
    format: { type: 'string', description: 'Filter by document format (json, yaml)' },
  },
} as const;

export const JobListQuerySchema = {
  type: 'object',
  description: 'Query parameters for listing lint jobs',
  properties: {
    status: { type: 'string', description: 'Filter by job status. Comma-separated for multiple values.' },
    documentId: { type: 'string', description: 'Filter by document ID' },
    rulesetName: { type: 'string', description: 'Filter by ruleset name' },
    startDate: { type: 'string', format: 'date-time', description: 'Filter jobs created after this date (ISO 8601)' },
    endDate: { type: 'string', format: 'date-time', description: 'Filter jobs created before this date (ISO 8601)' },
    limit: { type: 'integer', default: 50, description: 'Maximum number of results' },
    offset: { type: 'integer', default: 0, description: 'Pagination offset' },
    sortBy: { type: 'string', default: 'timestamp', description: 'Field to sort by' },
    sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc', description: 'Sort direction' },
  },
} as const;

export const RulesetNameParamSchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', description: 'Ruleset name (e.g., pubhub, api-insights-completeness)' },
  },
} as const;

export const RulesetVersionQuerySchema = {
  type: 'object',
  properties: {
    version: { type: 'string', description: 'Specific version to load. Defaults to the ruleset\'s default version.' },
  },
} as const;

// ============================================
// Convenience: all shared schemas in an array for addSchema()
// ============================================

export const sharedSchemas = [
  ErrorResponseSchema,
  JobStatusSchema,
  JobProgressSchema,
  SourcePositionSchema,
  SourceRangeSchema,
  LintIssueSchema,
  ResultSummarySchema,
  RulesetExecutionResultSchema,
  RuleInfoSchema,
  RuleOverridesSchema,
  DocumentSummarySchema,
  HealthResponseSchema,
  DocumentUploadRequestSchema,
  DocumentUploadResponseSchema,
  DocumentListResponseSchema,
  DocumentResponseSchema,
  LintJobSubmitResponseSchema,
  CapacityExceededResponseSchema,
  LintJobStatusSchema,
  LintJobResultSchema,
  JobSummarySchema,
  ReportGenerationRequestSchema,
  SarifReportSchema,
  JobListResponseSchema,
  JobListDetailedResponseSchema,
  CacheInvalidationResponseSchema,
  RulesetSummarySchema,
  RulesetDetailsSchema,
  StatsResponseSchema,
];
