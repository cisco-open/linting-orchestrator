// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Mock HTTP Server for OpenAPI Lint Orchestrator
 * 
 * Provides realistic responses with simulated delays for testing
 * before implementing the full worker pool and orchestration logic.
 * 
 * Now integrated with RulesetLoader to serve real ruleset data!
 * 
 * Usage: npm run mock
 */

import Fastify from 'fastify';
import { RulesetLoader } from './ruleset-loader.js';
import { loadConfig } from './config.js';
import type {
  LintJobRequest,
  LintJobResponse,
  JobStatusResponse,
  LintJobResult,
  HealthCheckResponse,
  RulesetsListResponse,
  RulesetDetailsResponse,
  ErrorResponse,
  JobStatus
} from './types.js';

const mockServer = Fastify({ logger: true });

// Initialize RulesetLoader
let rulesetLoader: RulesetLoader;

// In-memory mock job storage
interface MockJob {
  jobId: string;
  request: LintJobRequest;
  status: JobStatus;
  startTime: Date;
  endTime?: Date;
  progress: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    runningTasks: number;
    queuedTasks: number;
  };
}

const mockJobs = new Map<string, MockJob>();

/**
 * Generate mock job ID
 */
function generateJobId(): string {
  return `mock-job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * POST /lint - Submit lint job
 */
mockServer.post<{ Body: LintJobRequest }>('/lint', async (request, reply) => {
  const { documentId, rulesetName } = request.body;

  // Validate request
  if (!documentId || !rulesetName) {
    return reply.code(400).send({
      error: 'Invalid request',
      details: {
        documentId: documentId ? undefined : 'Required field missing',
        rulesetName: rulesetName ? undefined : 'Required field missing'
      },
      timestamp: new Date().toISOString()
    } as ErrorResponse);
  }

  const jobId = generateJobId();
  const mockJob: MockJob = {
    jobId,
    request: request.body,
    status: 'queued',
    startTime: new Date(),
    progress: {
      totalTasks: 1,
      completedTasks: 0,
      failedTasks: 0,
      runningTasks: 0,
      queuedTasks: 1
    }
  };

  mockJobs.set(jobId, mockJob);

  // Simulate async processing
  simulateJobProcessing(jobId);

  return reply.code(202).send({
    jobId,
    status: 'queued',
    estimatedCompletion: new Date(Date.now() + 3000).toISOString(),
    message: 'Lint job queued successfully'
  } as LintJobResponse);
});

/**
 * GET /lint/:jobId - Get job status
 */
mockServer.get<{ Params: { jobId: string } }>('/lint/:jobId', async (request, reply) => {
  const { jobId } = request.params;
  const job = mockJobs.get(jobId);

  if (!job) {
    return reply.code(404).send({
      error: 'Job not found',
      details: { jobId },
      timestamp: new Date().toISOString()
    } as ErrorResponse);
  }

  return {
    jobId: job.jobId,
    documentId: job.request.documentId,
    rulesetName: job.request.rulesetName,
    rulesetVersion: job.request.rulesetVersion || '1.1.0',
    status: job.status,
    progress: job.progress,
    startTime: job.startTime.toISOString(),
    endTime: job.endTime?.toISOString(),
    estimatedCompletion: job.status === 'running'
      ? new Date(Date.now() + 2000).toISOString()
      : undefined
  } as JobStatusResponse;
});

/**
 * GET /lint/:jobId/results - Get job results
 */
mockServer.get<{ Params: { jobId: string } }>('/lint/:jobId/results', async (request, reply) => {
  const { jobId } = request.params;
  const job = mockJobs.get(jobId);

  if (!job) {
    return reply.code(404).send({
      error: 'Job not found',
      details: { jobId },
      timestamp: new Date().toISOString()
    } as ErrorResponse);
  }

  if (job.status !== 'completed' && job.status !== 'completed_with_errors') {
    return reply.code(202).send({
      status: job.status,
      message: 'Job still in progress',
      progress: job.progress
    });
  }

  // Return mock results
  const mockResult: LintJobResult = {
    jobId: job.jobId,
    documentId: job.request.documentId,
    rulesetName: job.request.rulesetName,
    rulesetVersion: job.request.rulesetVersion || '1.1.0',
    status: job.status,
    timestamp: job.endTime!,
    totalExecutionTime: 2500,
    summary: {
      totalIssues: 15,
      errorCount: 5,
      warningCount: 8,
      infoCount: 2,
      hintCount: 0
    },
    results: [
      {
        ruleId: 'typed-enum',
        code: 'typed-enum',
        message: 'Enum values must be typed',
        severity: 0,
        path: ['paths', '/pets', 'get', 'responses', '200', 'content', 'application/json', 'schema', 'properties', 'status'],
        range: {
          start: { line: 45, character: 10 },
          end: { line: 45, character: 30 }
        }
      },
      {
        ruleId: 'operation-tag-defined',
        code: 'operation-tag-defined',
        message: 'Operation tags must be defined in global tags',
        severity: 1,
        path: ['paths', '/pets', 'post', 'tags', 0]
      },
      {
        ruleId: 'info-contact',
        code: 'info-contact',
        message: 'Info object must contain contact information',
        severity: 1,
        path: ['info']
      }
    ],
    executionDetails: {
      rulesetName: job.request.rulesetName,
      rulesetVersion: job.request.rulesetVersion || '1.1.0',
      executionTime: 2500,
      success: true,
      issueCount: 15,
      issues: [],
      metadata: {
        ruleEngine: 'spectral',
        documentId: job.request.documentId,
        cacheHit: false
      }
    }
  };

  return mockResult;
});

/**
 * GET /rulesets - List available rulesets
 */
mockServer.get('/rulesets', async () => {
  const rulesets = rulesetLoader.listRulesets();
  return { rulesets } as RulesetsListResponse;
});

/**
 * GET /rulesets/:name - Get ruleset details
 */
mockServer.get<{ Params: { name: string } }>('/rulesets/:name', async (request, reply) => {
  const { name } = request.params;

  try {
    const ruleset = await rulesetLoader.loadVersion(name);
    return ruleset as RulesetDetailsResponse;
  } catch (error) {
    return reply.code(404).send({
      error: 'Ruleset not found',
      details: { 
        name,
        message: error instanceof Error ? error.message : String(error)
      },
      timestamp: new Date().toISOString()
    } as ErrorResponse);
  }
});

/**
 * GET /health - Health check
 */
mockServer.get('/health', async () => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    workerPool: {
      activeWorkers: 3,
      maxWorkers: 15,
      idleWorkers: 2,
      busyWorkers: 1,
      queueDepth: 0
    },
    storage: {
      connected: true,
      type: 'memory'
    }
  } as HealthCheckResponse;
});

/**
 * Simulate job processing lifecycle
 */
function simulateJobProcessing(jobId: string): void {
  const job = mockJobs.get(jobId);
  if (!job) return;

  // After 500ms: transition to running
  setTimeout(() => {
    job.status = 'running';
    job.progress.queuedTasks = 0;
    job.progress.runningTasks = 1;
  }, 500);

  // After 2500ms: transition to completed
  setTimeout(() => {
    job.status = 'completed';
    job.endTime = new Date();
    job.progress.runningTasks = 0;
    job.progress.completedTasks = 1;
  }, 2500);
}

/**
 * Start mock server
 */
async function start(): Promise<void> {
  try {
    // Initialize RulesetLoader
    console.log('🔧 Initializing RulesetLoader...');
    const config = await loadConfig();
    rulesetLoader = new RulesetLoader({
      configPath: `${config.rulesets.directory}/config/rulesets.yaml`,
      sourcesBasePath: `${config.rulesets.directory}/sources`,
      enableCache: config.rulesets.cacheEnabled,
    });
    await rulesetLoader.initialize();
    
    const rulesets = rulesetLoader.listRulesets();
    console.log(`✅ Loaded ${rulesets.length} rulesets:`);
    for (const ruleset of rulesets) {
      console.log(`   - ${ruleset.displayName} (${ruleset.name}): ${ruleset.ruleCount} rules`);
    }

    await mockServer.listen({ port: 3003, host: '0.0.0.0' });
    console.log('\n🚀 Mock OpenAPI Lint Orchestrator running on port 3003');
    console.log('\nAvailable endpoints:');
    console.log('  POST   /lint             - Submit lint job');
    console.log('  GET    /lint/:jobId      - Get job status');
    console.log('  GET    /lint/:jobId/results - Get job results');
    console.log('  GET    /rulesets         - List rulesets (REAL DATA!)');
    console.log('  GET    /rulesets/:name   - Get ruleset details (REAL DATA!)');
    console.log('  GET    /health           - Health check');
    console.log('\nExample:');
    console.log('  curl -X POST http://localhost:3003/lint \\');
    console.log('    -H "Content-Type: application/json" \\');
    console.log('    -d \'{"documentId": "test-doc", "rulesetName": "pubhub"}\'');
    console.log('\n  curl http://localhost:3003/rulesets');
    console.log('  curl http://localhost:3003/rulesets/pubhub | jq .rules | head -50');
    console.log('\n');
  } catch (err) {
    mockServer.log.error(err);
    process.exit(1);
  }
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.log('\n\nShutting down mock server...');
  await mockServer.close();
  process.exit(0);
});

start();
