// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Orchestrator server - Exportable server module for all deployment modes
 * 
 * This module provides the core server functionality that can be:
 * - Imported and run in-process (embedded mode - embedded in CLI)
 * - Run as standalone process (standalone mode - dedicated server)
 * - Integrated with MCP (companion mode - MCP-managed)
 * 
 * @module server
 */

import Fastify, { FastifyError } from 'fastify';
import swagger from '@fastify/swagger';
import path from 'path';
import crypto from 'crypto';
import { API_VERSION, SPECTRAL_CORE_VERSION, SPECTRAL_RULESETS_VERSION, SPECTRAL_CLI_VERSION } from './utils/version.js';
import { loadConfig, resolveResolverPath } from './config.js';
import { Orchestrator, CapacityExceededError } from './orchestrator.js';
import { WorkerPoolManager } from './worker-pool.js';
import { RulesetLoader } from './ruleset-loader.js';
import {
  LocalDocumentStore,
  PassThroughDocumentStore,
  type DocumentStoreAdapter,
} from '@cisco-open/linting-document-store';
import { MemoryLintStorage } from './storage/memory-storage.js';
import { SarifBuilder } from './formatters/sarif-builder.js';
import { generateReproductionMarkdown } from './formatters/reproduce-markdown.js';
import type { LintJobRequest, OrchestratorConfig, ReportGenerationRequest } from './types.js';
import {
  lintJobRequestSchema,
  jobIdParamSchema,
  documentIdParamSchema,
  errorHandler,
  createErrorResponse,
  sanitizeDocumentId,
  sanitizeRulesetName
} from './validation.js';
import {
  sharedSchemas,
  DocumentListQuerySchema,
  JobListQuerySchema,
  RulesetNameParamSchema,
  RulesetVersionQuerySchema,
} from './schemas.js';

/**
 * Server instance that can be controlled and shutdown
 */
export interface ServerInstance {
  fastify: ReturnType<typeof Fastify>;
  orchestrator: Orchestrator;
  workerPool: WorkerPoolManager;
  documentStore: DocumentStoreAdapter;
  config: OrchestratorConfig;
  shutdown: () => Promise<void>;
}

/**
 * Start orchestrator server with given configuration
 * 
 * This function is used by:
 * - src/index.ts (standalone server entrypoint)
 * - src/cli/commands/start.ts (embedded server)
 * - Tests (integration testing)
 * 
 * @param customConfig Optional configuration to override defaults
 * @returns ServerInstance with shutdown capability
 */
export async function startServer(customConfig?: Partial<OrchestratorConfig>): Promise<ServerInstance> {
  console.log('🚀 Starting the Orchestrator service...\n');

  // 1. Load configuration
  const config = customConfig
    ? { ...await loadConfig(), ...customConfig }
    : await loadConfig();

  console.log('✅ Configuration loaded');
  console.log(`   Mode: ${config.mode || 'standalone'}`);
  console.log(`   Port: ${config.server?.port || 3003}`);
  console.log(`   Directory: ${config.documentStore.baseDir}\n`);

  // 2. Initialize storage
  const storage = new MemoryLintStorage();
  await storage.initialize({});
  console.log('✅ Storage initialized\n');

  // 3. Initialize ruleset loader
  const rulesetsConfigPath = path.join(config.rulesets.directory, 'config', 'rulesets.yaml');
  console.log(`   Loading rulesets from: ${rulesetsConfigPath}`);
  const rulesetLoader = new RulesetLoader({
    configPath: rulesetsConfigPath,
    sourcesBasePath: path.join(config.rulesets.directory, 'sources')
  });
  await rulesetLoader.initialize();
  console.log('✅ Ruleset loader initialized\n');

  // 4. Initialize document store (based on config type)
  let documentStore: DocumentStoreAdapter;

  if (config.documentStore.type === 'passthrough') {
    // PassThrough mode - read from external document store (e.g., MCP)
    documentStore = new PassThroughDocumentStore({
      uploadsDir: config.documentStore.baseDir,
      httpFallbackUrl: config.documentStore.fallbackHttp
    });
    console.log('   Using PassThroughDocumentStore (companion mode)');
  } else {
    // Standalone mode - use local storage with cache
    documentStore = new LocalDocumentStore({
      uploadsDir: config.documentStore.baseDir || './uploads',
      quotaGB: 10,
      cacheMaxSize: 100,
      cacheTTLHours: 1
    });
    console.log('   Using LocalDocumentStore (standalone/embedded mode)');
  }

  await documentStore.initialize();
  console.log('✅ Document store initialized\n');

  // 5. Initialize worker pool
  const resolverPath = resolveResolverPath(config.resolver);
  const workerPool = new WorkerPoolManager(
    config.workerPool,
    rulesetLoader,
    documentStore,
    resolverPath
  );
  await workerPool.initialize();
  console.log('✅ Worker pool initialized');
  if (resolverPath) {
    console.log(`   Resolver: ${config.resolver} (${resolverPath})`);
  }
  console.log('');

  // 6. Initialize orchestrator
  const maxIssuesPerJob = process.env.MAX_ISSUES_PER_JOB
    ? parseInt(process.env.MAX_ISSUES_PER_JOB, 10)
    : 100000;
  const orchestrator = new Orchestrator(
    workerPool,
    storage,
    rulesetLoader,
    documentStore,
    {
      workerPool: config.workerPool,
      reportService: config.reportService,
      maxIssuesPerJob
    }
  );
  await orchestrator.initialize();
  console.log('✅ Orchestrator initialized\n');

  // 7. Initialize SARIF builder
  const sarifBuilder = new SarifBuilder();
  console.log('✅ SARIF builder initialized\n');

  // 8. Generate runtime session ID (for client history management)
  const runtimeSessionId = crypto.randomUUID();
  console.log(`🔑 Runtime Session ID: ${runtimeSessionId}\n`);

  // 8. Create HTTP server
  const maxDocumentBytes = (config.server?.maxDocumentSizeMB || 20) * 1024 * 1024;
  const fastify = Fastify({
    logger: config.logging?.level === 'debug',
    bodyLimit: maxDocumentBytes,
    ajv: {
      customOptions: {
        // Register 'example' as a known keyword so AJV strict mode doesn't reject it.
        // This allows the same schemas to feed both AJV validation and @fastify/swagger
        // OpenAPI generation without duplication.
        keywords: ['example'],
      },
    },
  });

  // Register @fastify/swagger to auto-generate OpenAPI spec from route schemas
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Linting Orchestrator API',
        version: API_VERSION,
        description:
          'The linting orchestrator uses Spectral and custom rule engines.\n' +
          'It provides a REST API for uploading documents, submitting lint jobs, and retrieving results.\n\n' +
          '**Deployment Modes:**\n' +
          '- **Light Mode** (Embedded): CLI embeds server, zero-config, perfect for CI/CD\n' +
          '- **Standalone Mode**: Independent server process, long-running, multi-user\n' +
          '- **Companion Mode**: Runs alongside the MCP OpenAPI Analyzer for integrated document lifecycle',
        contact: { name: 'Cisco DevNet' },
        license: { name: 'Apache-2.0', url: 'https://opensource.org/licenses/Apache-2.0' },
      },
      servers: [
        { url: `http://localhost:${config.server?.port || 3003}`, description: 'Local development server (default port)' },
      ],
      tags: [
        { name: 'Health', description: 'Server health and status' },
        { name: 'Documents', description: 'Upload and manage documents' },
        { name: 'Linting', description: 'Submit lint jobs and retrieve results' },
        { name: 'Jobs', description: 'List and query lint jobs' },
        { name: 'Reports', description: 'Generate reports from lint results' },
        { name: 'Rulesets', description: 'Browse available rulesets and rules' },
        { name: 'Cache', description: 'Cache management' },
        { name: 'Statistics', description: 'Server and storage statistics' },
      ],
    },
    // Use $id as the schema component name instead of the default "def-N" naming
    refResolver: {
      buildLocalReference(json: any, _baseUri: any, _fragment: any, i: number) {
        if (json.$id) {
          return json.$id;
        }
        if (json.title) {
          return json.title;
        }
        return `def-${i}`;
      },
    },
  });

  // Register shared JSON Schemas so routes can $ref them
  for (const schema of sharedSchemas) {
    fastify.addSchema(schema);
  }

  // Add runtime session ID header to all responses
  fastify.addHook('onSend', async (_request, reply) => {
    reply.header('X-Spectify-Session-Id', runtimeSessionId);
    reply.header('X-Spectify-Version', API_VERSION);
  });

  // Set global error handler with document size context
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    // Handle body too large errors with clear message
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      const sizeLimitMB = (config.server?.maxDocumentSizeMB || 20);
      reply.code(413).send({
        error: 'Payload Too Large',
        message: `Document exceeds maximum size of ${sizeLimitMB}MB. Configure server.maxDocumentSizeMB in config.yaml to increase.`,
        statusCode: 413
      });
      return;
    }
    // Delegate to standard error handler
    errorHandler(error, request, reply);
  });

  // Health check endpoint
  const serverStartTime = new Date();
  fastify.get('/health', {
    schema: {
      description: 'Returns server health status, uptime, configuration, and orchestrator statistics.',
      tags: ['Health'],
      summary: 'Health check',
      operationId: 'getHealth',
      response: {
        200: { $ref: 'HealthResponse#', description: 'Server is healthy' },
        500: { $ref: 'ErrorResponse#', description: 'Internal server error' },
      },
    },
  }, async () => {
    const stats = orchestrator.getStats();
    const uptimeSeconds = Math.floor((Date.now() - serverStartTime.getTime()) / 1000);
    const baseDir = config.documentStore?.baseDir || './uploads';

    const health: any = {
      status: 'ok',
      version: API_VERSION,
      timestamp: new Date().toISOString(),
      uptime: uptimeSeconds,
      mode: config.mode || 'standalone',
      runtime: {
        nodeVersion: process.version,
        spectralCore: SPECTRAL_CORE_VERSION,
        spectralRulesets: SPECTRAL_RULESETS_VERSION,
        spectralCli: SPECTRAL_CLI_VERSION,
        resolver: config.resolver || null,
      },
      server: {
        port: config.server?.port || 3003,
        host: config.server?.host || '0.0.0.0',
        startedAt: serverStartTime.toISOString(),
      },
      documentStore: {
        type: config.documentStore?.type || 'local',
        baseDir: baseDir,
        fullPath: path.resolve(baseDir),
      },
      stats
    };

    // Add Report Service status if configured
    if (orchestrator.hasReportClient()) {
      const reportStatus = await orchestrator.getReportClientStatus();
      health.reportService = reportStatus;
    }

    return health;
  });

  // Upload OpenAPI document (standalone/embedded mode)
  fastify.post<{ Body: { content: string; format?: 'json' | 'yaml'; metadata?: any } }>('/documents', {
    schema: {
      description: 'Upload a document for linting. Returns a document ID that can be used to submit lint jobs.',
      tags: ['Documents'],
      summary: 'Upload document',
      operationId: 'uploadDocument',
      body: { $ref: 'DocumentUploadRequest#' },
      response: {
        201: { $ref: 'DocumentUploadResponse#', description: 'Document uploaded successfully' },
        400: { $ref: 'ErrorResponse#', description: 'Bad request' },
        413: { $ref: 'ErrorResponse#', description: 'Document exceeds maximum upload size limit' },
        500: { $ref: 'ErrorResponse#', description: 'Internal server error' },
      },
    },
  }, async (request, reply) => {
    const { content, format = 'json', metadata } = request.body;

    if (!content || typeof content !== 'string') {
      return reply.code(400).send(
        createErrorResponse('Bad Request', 'Document content is required')
      );
    }

    try {
      const result = await documentStore.storeDocument(content, format, metadata);

      return reply.code(201).send({
        documentId: result.documentId,
        version: result.version,
        message: 'Document uploaded successfully'
      });
    } catch (error) {
      console.error('Document upload failed:', error);
      return reply.code(500).send(
        createErrorResponse('Internal Server Error', 'Failed to store document')
      );
    }
  });

  // Get document by ID
  fastify.get<{ Params: { documentId: string } }>('/documents/:documentId', {
    schema: {
      description: 'Retrieve an uploaded document by its identifier.',
      tags: ['Documents'],
      summary: 'Get document by ID',
      operationId: 'getDocument',
      params: documentIdParamSchema,
      response: {
        200: { $ref: 'DocumentResponse#', description: 'Document found and returned' },
        404: { $ref: 'ErrorResponse#', description: 'Resource not found' },
      },
    },
  }, async (request, reply) => {
    const { documentId } = request.params;

    const document = await documentStore.getDocument(sanitizeDocumentId(documentId));

    if (!document) {
      return reply.code(404).send(
        createErrorResponse('Not Found', `Document not found: ${documentId}`)
      );
    }

    return document;
  });

  // List/search documents
  fastify.get('/documents', {
    schema: {
      description: 'List uploaded documents with optional filtering, sorting, and search. When `search` is provided, performs a text search; otherwise returns a paginated list.',
      tags: ['Documents'],
      summary: 'List or search documents',
      operationId: 'listDocuments',
      querystring: DocumentListQuerySchema,
      response: {
        200: { $ref: 'DocumentListResponse#', description: 'List of documents matching the query' },
        500: { $ref: 'ErrorResponse#', description: 'Internal server error' },
      },
    },
  }, async (request) => {
    const { limit, offset, sortBy, sortOrder, search, organization, tags, format } = request.query as any;

    // If search query present, use searchDocuments; otherwise use listDocuments
    const options = {
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
      sortBy: sortBy || 'uploadedAt',
      sortOrder: sortOrder || 'desc'
    };

    if (search) {
      // Search mode - combine search with optional filters
      const searchOptions = {
        ...options,
        ...(organization && { organization }),
        ...(tags && { tags: tags.split(',') }),
        ...(format && { format })
      };

      const documents = await documentStore.searchDocuments(search, searchOptions);
      return documents;
    } else {
      // List mode - optional filters only
      const listOptions = {
        ...options,
        ...(organization && { organization }),
        ...(tags && { tags: tags.split(',') }),
        ...(format && { format })
      };

      const documents = await documentStore.listDocuments(listOptions);
      return documents;
    }
  });

  // Submit lint job
  fastify.post<{ Body: LintJobRequest }>('/lint', {
    schema: {
      description: 'Submit a document for linting against a specified ruleset. Returns a job ID for tracking progress. The job runs asynchronously.',
      tags: ['Linting'],
      summary: 'Submit lint job',
      operationId: 'submitLintJob',
      body: lintJobRequestSchema,
      response: {
        202: { $ref: 'LintJobSubmitResponse#', description: 'Job submitted and queued for processing' },
        404: { $ref: 'ErrorResponse#', description: 'Resource not found' },
        429: { $ref: 'CapacityExceededResponse#', description: 'Too many requests — server at capacity' },
        500: { $ref: 'ErrorResponse#', description: 'Internal server error' },
        503: { $ref: 'ErrorResponse#', description: 'Service unavailable (server starting up)' },
      },
    },
  }, async (request, reply) => {
    const jobRequest = request.body;

    // Sanitize inputs
    const sanitizedRequest = {
      ...jobRequest,
      documentId: sanitizeDocumentId(jobRequest.documentId),
      rulesetName: sanitizeRulesetName(jobRequest.rulesetName),
      ruleOverrides: jobRequest.ruleOverrides
    };

    try {
      const jobId = await orchestrator.submitJob(sanitizedRequest);

      return reply.code(202).send({
        jobId,
        status: 'queued',
        message: 'Job submitted successfully'
      });
    } catch (error) {
      // Backpressure: reject with 429 when at capacity
      if (error instanceof CapacityExceededError) {
        const retryAfter = Math.ceil(error.activeJobs / 10); // ~1s per 10 active jobs
        reply.header('Retry-After', String(retryAfter));
        return reply.code(429).send({
          error: 'Too Many Requests',
          message: error.message,
          activeJobs: error.activeJobs,
          maxJobs: error.maxJobs,
          retryAfter
        });
      }

      // Document not found
      if (error instanceof Error && error.message.startsWith('Document not found')) {
        return reply.code(404).send(
          createErrorResponse('Not Found', error.message)
        );
      }

      // Orchestrator not initialized
      if (error instanceof Error && error.message === 'Orchestrator not initialized') {
        return reply.code(503).send(
          createErrorResponse('Service Unavailable', 'Server is starting up, please retry shortly')
        );
      }

      // Unknown error
      console.error('Job submission failed:', error);
      return reply.code(500).send(
        createErrorResponse('Internal Server Error', 'Failed to submit lint job')
      );
    }
  });

  // Get job status
  fastify.get<{ Params: { jobId: string } }>('/lint/:jobId', {
    schema: {
      description: 'Retrieve the current status and progress of a lint job.',
      tags: ['Linting'],
      summary: 'Get job status',
      operationId: 'getJobStatus',
      params: jobIdParamSchema,
      response: {
        200: { $ref: 'LintJobStatus#', description: 'Current job status and progress' },
        404: { $ref: 'ErrorResponse#', description: 'Resource not found' },
      },
    },
  }, async (request, reply) => {
    const { jobId } = request.params;

    const job = await orchestrator.getJobStatus(jobId);

    if (!job) {
      return reply.code(404).send(
        createErrorResponse('Not Found', `Job not found: ${jobId}`)
      );
    }

    return {
      jobId: job.jobId,
      documentId: job.documentId,
      rulesetName: job.rulesetName,
      rulesetVersion: job.rulesetVersion,
      status: job.status,
      progress: job.progress,
      startTime: job.startTime,
      endTime: job.endTime
    };
  });

  // Get job results (with optional pagination and filtering)
  fastify.get<{
    Params: { jobId: string };
    Querystring: {
      offset?: string;
      limit?: string;
      severity?: string;
      rule?: string;
      pathPrefix?: string;
    };
  }>('/lint/:jobId/results', {
    schema: {
      description: 'Retrieve the results of a completed lint job. Supports optional pagination and filtering via query parameters. When no query params are provided, returns the full result (backward compatible).',
      tags: ['Linting'],
      summary: 'Get job results',
      operationId: 'getJobResults',
      params: jobIdParamSchema,
      querystring: {
        type: 'object',
        properties: {
          offset: { type: 'string', description: 'Skip first N issues (default: 0)' },
          limit: { type: 'string', description: 'Max issues to return (default: all)' },
          severity: { type: 'string', description: 'Filter by severity: 0=error, 1=warn, 2=info, 3=hint' },
          rule: { type: 'string', description: 'Filter by rule ID (exact match)' },
          pathPrefix: { type: 'string', description: 'Filter issues whose path starts with this prefix (dot-separated)' },
        },
      },
      response: {
        200: { description: 'Job results (full or paginated)' },
        404: { $ref: 'ErrorResponse#', description: 'Resource not found' },
      },
    },
  }, async (request, reply) => {
    const { jobId } = request.params;
    const { offset, limit, severity, rule, pathPrefix } = request.query;

    const hasPaginationOrFilter = offset !== undefined || limit !== undefined ||
      severity !== undefined || rule !== undefined || pathPrefix !== undefined;

    if (hasPaginationOrFilter && storage.queryJobResults) {
      // Use paginated query
      const options: any = {};
      if (offset !== undefined) options.offset = parseInt(offset, 10);
      if (limit !== undefined) options.limit = parseInt(limit, 10);
      if (severity !== undefined) options.severity = parseInt(severity, 10);
      if (rule !== undefined) options.rule = rule;
      if (pathPrefix !== undefined) options.pathPrefix = pathPrefix;

      const result = await storage.queryJobResults(jobId, options);
      if (!result) {
        return reply.code(404).send(
          createErrorResponse('Not Found', `Job not found or not yet completed: ${jobId}`)
        );
      }
      return result;
    }

    // Backward compatible: return full result
    const result = await orchestrator.getJobResult(jobId);
    if (!result) {
      return reply.code(404).send(
        createErrorResponse('Not Found', `Job not found or not yet completed: ${jobId}`)
      );
    }
    return result;
  });

  // Get aggregated statistics for a job's lint results
  fastify.get<{ Params: { jobId: string } }>('/lint/:jobId/stats', {
    schema: {
      description: 'Get aggregated statistics for a completed lint job, including rule breakdown and top paths. Does not return individual issues — use GET /lint/:jobId/results for that.',
      tags: ['Linting'],
      summary: 'Get job result statistics',
      operationId: 'getJobStats',
      params: jobIdParamSchema,
      response: {
        200: { description: 'Aggregated job statistics' },
        404: { $ref: 'ErrorResponse#', description: 'Resource not found' },
      },
    },
  }, async (request, reply) => {
    const { jobId } = request.params;

    if (storage.getJobStats) {
      const stats = await storage.getJobStats(jobId);
      if (!stats) {
        return reply.code(404).send(
          createErrorResponse('Not Found', `Job not found or not yet completed: ${jobId}`)
        );
      }
      return stats;
    }

    // Fallback: basic stats from full result
    const result = await orchestrator.getJobResult(jobId);
    if (!result) {
      return reply.code(404).send(
        createErrorResponse('Not Found', `Job not found or not yet completed: ${jobId}`)
      );
    }
    return {
      jobId: result.jobId,
      documentId: result.documentId,
      rulesetName: result.rulesetName,
      rulesetVersion: result.rulesetVersion,
      status: result.status,
      summary: result.summary,
      ruleBreakdown: [],
      topPaths: [],
    };
  });

  // Generate SARIF report for completed job
  fastify.post<{
    Params: { jobId: string };
    Body: ReportGenerationRequest;
  }>('/lint/:jobId/reports/generate', {
    schema: {
      description: 'Generate a structured report from a completed lint job. Currently supports SARIF (Static Analysis Results Interchange Format) output.',
      tags: ['Reports'],
      summary: 'Generate report for completed job',
      operationId: 'generateReport',
      params: jobIdParamSchema,
      body: { $ref: 'ReportGenerationRequest#' },
      response: {
        200: { $ref: 'SarifReport#', description: 'Generated SARIF report' },
        400: { $ref: 'ErrorResponse#', description: 'Bad request' },
        404: { $ref: 'ErrorResponse#', description: 'Resource not found' },
        500: { $ref: 'ErrorResponse#', description: 'Internal server error' },
      },
    },
  }, async (request, reply) => {
    const { jobId } = request.params;
    const { format, options } = request.body;

    // Validate format (only SARIF supported in Phase 1)
    if (format !== 'sarif') {
      return reply.code(400).send(
        createErrorResponse('Bad Request', `Unsupported format: ${format}. Only 'sarif' is supported.`)
      );
    }

    // Get completed job result
    const result = await orchestrator.getJobResult(jobId);

    if (!result) {
      return reply.code(404).send(
        createErrorResponse('Not Found', `Job not found or not yet completed: ${jobId}`)
      );
    }

    if (result.status !== 'completed') {
      return reply.code(400).send(
        createErrorResponse('Bad Request', `Job is not completed. Status: ${result.status}`)
      );
    }

    // Generate SARIF report
    try {
      const sarif = sarifBuilder.buildSarif(result, options);
      return reply.send(sarif);
    } catch (error) {
      console.error('Error generating SARIF report:', error);
      return reply.code(500).send(
        createErrorResponse('Internal Server Error', 'Failed to generate SARIF report')
      );
    }
  });

  // Generate Spectral CLI reproduction instructions for a completed job
  fastify.get<{ Params: { jobId: string } }>('/lint/:jobId/reproduce', {
    schema: {
      description: 'Generate Markdown instructions for reproducing a lint job using the native Spectral CLI. Includes git clone, install, and spectral lint commands. When rule overrides were applied, includes Spectral override configuration.',
      tags: ['Reports'],
      summary: 'Get Spectral reproduction instructions',
      operationId: 'getReproductionInstructions',
      params: jobIdParamSchema,
      response: {
        200: { type: 'string', description: 'Markdown reproduction instructions' },
        400: { $ref: 'ErrorResponse#', description: 'Job not yet completed' },
        404: { $ref: 'ErrorResponse#', description: 'Job or ruleset not found' },
      },
    },
  }, async (request, reply) => {
    const { jobId } = request.params;

    // Get completed job result
    const result = await orchestrator.getJobResult(jobId);
    if (!result) {
      return reply.code(404).send(
        createErrorResponse('Not Found', `Job not found or not yet completed: ${jobId}`)
      );
    }

    // Must be in a terminal state
    const terminalStatuses = ['completed', 'completed_with_errors', 'failed', 'timeout'];
    if (!terminalStatuses.includes(result.status)) {
      return reply.code(400).send(
        createErrorResponse('Bad Request', `Job not yet completed. Status: ${result.status}`)
      );
    }

    // Get ruleset source metadata
    const sourceMetadata = await rulesetLoader.getSourceMetadata(
      result.rulesetName,
      result.rulesetVersion
    );
    if (!sourceMetadata) {
      return reply.code(404).send(
        createErrorResponse('Not Found', `Source metadata not found for ruleset '${result.rulesetName}' version '${result.rulesetVersion}'`)
      );
    }

    const markdown = generateReproductionMarkdown(result, sourceMetadata);
    return reply.type('text/markdown; charset=utf-8').send(markdown);
  });

  // Get storage and failure statistics
  fastify.get('/stats', {
    schema: {
      description: 'Returns storage statistics and orchestrator metrics.',
      tags: ['Statistics'],
      summary: 'Storage and failure statistics',
      operationId: 'getStats',
      response: {
        200: { $ref: 'StatsResponse#', description: 'Server statistics' },
        500: { $ref: 'ErrorResponse#', description: 'Internal server error' },
      },
    },
  }, async () => {
    const storageStats = await storage.getStats();
    const orchestratorStats = orchestrator.getStats();

    return {
      storage: storageStats,
      orchestrator: orchestratorStats,
      timestamp: new Date().toISOString()
    };
  });

  // List jobs (lightweight - documentId only)
  fastify.get('/lint/jobs', {
    schema: {
      description: 'List lint jobs with optional filtering. Returns lightweight job summaries (document ID only, no metadata).',
      tags: ['Jobs'],
      summary: 'List jobs (lightweight)',
      operationId: 'listJobs',
      querystring: JobListQuerySchema,
      response: {
        200: { $ref: 'JobListResponse#', description: 'Paginated list of jobs' },
        500: { $ref: 'ErrorResponse#', description: 'Internal server error' },
      },
    },
  }, async (request) => {
    const {
      status,
      documentId,
      rulesetName,
      startDate,
      endDate,
      limit,
      offset,
      sortBy,
      sortOrder
    } = request.query as any;

    const options = {
      ...(status && { status: status.includes(',') ? status.split(',') : status }),
      ...(documentId && { documentId }),
      ...(rulesetName && { rulesetName }),
      ...(startDate && { startDate: new Date(startDate) }),
      ...(endDate && { endDate: new Date(endDate) }),
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
      sortBy: sortBy || 'timestamp',
      sortOrder: sortOrder || 'desc'
    };

    return orchestrator.listJobs(options, runtimeSessionId);
  });

  // List jobs with document metadata (detailed)
  fastify.get('/lint/jobs/details', {
    schema: {
      description: 'List lint jobs with full document metadata attached. Heavier than `/lint/jobs` but provides complete context for each job.',
      tags: ['Jobs'],
      summary: 'List jobs with document metadata',
      operationId: 'listJobsDetailed',
      querystring: JobListQuerySchema,
      response: {
        200: { $ref: 'JobListDetailedResponse#', description: 'Paginated list of jobs with document metadata' },
        500: { $ref: 'ErrorResponse#', description: 'Internal server error' },
      },
    },
  }, async (request) => {
    const {
      status,
      documentId,
      rulesetName,
      startDate,
      endDate,
      limit,
      offset,
      sortBy,
      sortOrder
    } = request.query as any;

    const options = {
      ...(status && { status: status.includes(',') ? status.split(',') : status }),
      ...(documentId && { documentId }),
      ...(rulesetName && { rulesetName }),
      ...(startDate && { startDate: new Date(startDate) }),
      ...(endDate && { endDate: new Date(endDate) }),
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
      sortBy: sortBy || 'timestamp',
      sortOrder: sortOrder || 'desc'
    };

    return orchestrator.listJobsDetailed(options, runtimeSessionId);
  });

  // Invalidate cache for a document
  fastify.delete<{ Params: { documentId: string } }>('/cache/:documentId', {
    schema: {
      description: 'Remove all cached lint results for a specific document.',
      tags: ['Cache'],
      summary: 'Invalidate cache for a document',
      operationId: 'invalidateCache',
      params: documentIdParamSchema,
      response: {
        200: { $ref: 'CacheInvalidationResponse#', description: 'Cache invalidated successfully' },
        500: { $ref: 'ErrorResponse#', description: 'Internal server error' },
      },
    },
  }, async (request) => {
    const { documentId } = request.params;

    await orchestrator.invalidateCache(sanitizeDocumentId(documentId));

    return {
      message: `Cache invalidated for document: ${documentId}`
    };
  });

  // List available rulesets
  fastify.get('/rulesets', {
    schema: {
      description: 'Returns all configured rulesets with metadata and rule counts.',
      tags: ['Rulesets'],
      summary: 'List available rulesets',
      operationId: 'listRulesets',
      response: {
        200: {
          description: 'List of available rulesets',
          type: 'array',
          items: { $ref: 'RulesetSummary#' },
        },
        500: { $ref: 'ErrorResponse#', description: 'Internal server error' },
      },
    },
  }, async () => {
    try {
      // Use the new method that loads rulesets to get accurate rule counts
      const rulesets = await rulesetLoader.listRulesetsWithCounts();
      // Return array directly for easier client consumption
      return rulesets.map(metadata => ({
        name: metadata.name,
        version: metadata.defaultVersion,
        defaultVersion: metadata.defaultVersion,
        description: metadata.description,
        availableVersions: metadata.versions,
        displayName: metadata.displayName,
        category: metadata.category,
        ruleCount: metadata.ruleCount,
        tags: metadata.tags
      }));
    } catch (error) {
      console.error('Error listing rulesets:', error);
      throw error;
    }
  });

  // Get ruleset details including rules
  fastify.get<{ Params: { name: string }; Querystring: { version?: string } }>('/rulesets/:name', {
    schema: {
      description: 'Retrieve detailed information about a specific ruleset, including all individual rules with their severity and descriptions.',
      tags: ['Rulesets'],
      summary: 'Get ruleset details including rules',
      operationId: 'getRulesetDetails',
      params: RulesetNameParamSchema,
      querystring: RulesetVersionQuerySchema,
      response: {
        200: { $ref: 'RulesetDetails#', description: 'Ruleset details with rules' },
        404: { $ref: 'ErrorResponse#', description: 'Resource not found' },
      },
    },
  }, async (request, reply) => {
    const { name } = request.params;
    const { version } = request.query as { version?: string };

    try {
      const rulesetVersion = await rulesetLoader.loadVersion(name, version);

      return {
        name: rulesetVersion.metadata.name,
        displayName: rulesetVersion.metadata.displayName,
        version: rulesetVersion.version,
        description: rulesetVersion.metadata.description,
        category: rulesetVersion.metadata.category,
        ruleCount: rulesetVersion.rules.length,
        releaseDate: rulesetVersion.releaseDate,
        deprecated: rulesetVersion.deprecated,
        tags: rulesetVersion.metadata.tags,
        rules: rulesetVersion.rules.map(rule => ({
          name: rule.name,
          severity: rule.severity,
          message: rule.message,
          description: rule.description,
          recommended: rule.recommended,
        }))
      };
    } catch (error) {
      return reply.code(404).send(
        createErrorResponse('Not Found', `Ruleset '${name}' not found`)
      );
    }
  });

  // Expose the auto-generated OpenAPI specification
  fastify.get('/docs/openapi.json', {
    schema: { hide: true },
  }, async (_request, reply) => {
    return reply.send(fastify.swagger());
  });

  // Start HTTP listener
  const port = config.server?.port || 3003;
  const host = config.server?.host || '0.0.0.0';

  try {
    await fastify.listen({ port, host });
    console.log(`\n✅ Orchestrator service v${API_VERSION}`);
    console.log(`   HTTP API listening on http://${host}:${port}`);
    console.log(`\nAvailable endpoints:`);
    console.log(`  POST   /documents                    - Upload OpenAPI document`);
    console.log(`  GET    /documents                    - List/search documents`);
    console.log(`  GET    /documents/:documentId        - Get document by ID`);
    console.log(`  POST   /lint                         - Submit lint job`);
    console.log(`  GET    /lint/:jobId                  - Get job status`);
    console.log(`  GET    /lint/:jobId/results          - Get job results`);
    console.log(`  GET    /lint/jobs                    - List jobs (lightweight)`);
    console.log(`  GET    /lint/jobs/details            - List jobs (with document metadata)`);
    console.log(`  POST   /lint/:jobId/reports/generate - Generate SARIF report`);
    console.log(`  GET    /lint/:jobId/reproduce       - Spectral CLI reproduction instructions`);
    console.log(`  DELETE /cache/:documentId            - Invalidate cache`);
    console.log(`  GET    /rulesets                     - List available rulesets`);
    console.log(`  GET    /rulesets/:name               - Get ruleset details`);
    console.log(`  GET    /stats                        - Storage & failure statistics`);
    console.log(`  GET    /stats/orchestrator           - Orchestrator statistics`);
    console.log(`  GET    /health                       - Health check`);
    console.log(`  GET    /docs/openapi.json            - OpenAPI specification (auto-generated)`);
    console.log(`\n🎯 Ready to accept lint requests!\n`);
  } catch (error) {
    console.error('Failed to start HTTP server:', error);
    throw error;
  }

  // Create shutdown handler
  const shutdown = async () => {
    console.log('\n🛑 Shutting down the Orchestrator service...');

    try {
      await orchestrator.shutdown();
      await workerPool.shutdown();
      await fastify.close();
      console.log('✅ Shutdown complete');
    } catch (error) {
      console.error('Error during shutdown:', error);
      throw error;
    }
  };

  // Return server instance with control interface
  return {
    fastify,
    orchestrator,
    workerPool,
    documentStore,
    config,
    shutdown
  };
}
