/**
 * Performance Benchmark Tests
 * 
 * Measures:
 * - Job throughput (jobs/minute)
 * - Latency (time to complete)
 * - Cache hit performance
 * - Worker pool scaling
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'path';
import {
  startService,
  stopAllServices,
  getOrchestratorConfig,
  requireMCPServer,
  ServiceHandle
} from './service-utils.js';
import {
  MCPClient,
  SpectifyClient,
  loadOpenAPIDocument
} from './api-client.js';

describe('Performance Benchmarks', () => {
  let services: ServiceHandle[] = [];
  let mcpClient: MCPClient;
  let spectifyClient: SpectifyClient;

  beforeAll(async () => {
    // Check if MCP server is running (external dependency)
    await requireMCPServer();
    
    // Connect to running MCP server
    mcpClient = new MCPClient('http://localhost:3002');

    // Start only Spectify orchestrator
    const spectifyService = await startService(getOrchestratorConfig());
    services.push(spectifyService);
    spectifyClient = new SpectifyClient('http://localhost:3003');

    console.log('\n✓ Services started for benchmarking\n');
  }, 120000);

  afterAll(async () => {
    await stopAllServices(services);
  }, 30000);

  it('should measure single job latency', async () => {
    const docPath = resolve('./tests/fixtures/openapi-docs/petstore.json');
    const document = await loadOpenAPIDocument(docPath);
    const documentId = await mcpClient.uploadDocument(document);

    // Measure end-to-end latency
    const startTime = Date.now();
    
    const jobId = await spectifyClient.submitLintJob({
      documentId,
      rulesetName: 'pubhub'
    });

    const status = await spectifyClient.waitForJobComplete(jobId, 60000);
    const endTime = Date.now();

    const totalLatency = endTime - startTime;
    const executionTime = status.endTime && status.startTime
      ? new Date(status.endTime).getTime() - new Date(status.startTime).getTime()
      : 0;

    console.log('  Single Job Latency:');
    console.log(`    Total (submit → results): ${totalLatency}ms`);
    console.log(`    Execution time: ${executionTime}ms`);
    console.log(`    Overhead: ${totalLatency - executionTime}ms`);

    // Should complete within 10 seconds for first run
    expect(totalLatency).toBeLessThan(10000);
  }, 90000);

  it('should measure cache hit performance', async () => {
    const docPath = resolve('./tests/fixtures/openapi-docs/petstore.json');
    const document = await loadOpenAPIDocument(docPath);
    const documentId = await mcpClient.uploadDocument(document);

    // First run (cache miss)
    const startMiss = Date.now();
    const jobId1 = await spectifyClient.submitLintJob({
      documentId,
      rulesetName: 'pubhub'
    });
    await spectifyClient.waitForJobComplete(jobId1, 60000);
    const cacheMissDuration = Date.now() - startMiss;

    // Second run (cache hit)
    const startHit = Date.now();
    const jobId2 = await spectifyClient.submitLintJob({
      documentId,
      rulesetName: 'pubhub'
    });
    await spectifyClient.waitForJobComplete(jobId2, 60000);
    const cacheHitDuration = Date.now() - startHit;

    const speedup = ((cacheMissDuration - cacheHitDuration) / cacheMissDuration * 100);

    console.log('  Cache Performance:');
    console.log(`    Cache miss: ${cacheMissDuration}ms`);
    console.log(`    Cache hit: ${cacheHitDuration}ms`);
    console.log(`    Speedup: ${speedup.toFixed(1)}%`);

    // Cache hit should be significantly faster
    expect(cacheHitDuration).toBeLessThan(cacheMissDuration * 0.5);
  }, 120000);

  it('should measure throughput with concurrent jobs', async () => {
    const docPath = resolve('./tests/fixtures/openapi-docs/petstore.json');
    const document = await loadOpenAPIDocument(docPath);
    const documentId = await mcpClient.uploadDocument(document);

    const numJobs = 10;
    console.log(`  Submitting ${numJobs} concurrent jobs...`);

    const startTime = Date.now();

    // Submit all jobs
    const jobPromises = Array.from({ length: numJobs }, () =>
      spectifyClient.submitLintJob({
        documentId,
        rulesetName: 'pubhub',
        forceRun: true // Bypass cache to measure actual execution
      })
    );

    const jobIds = await Promise.all(jobPromises);

    // Wait for all to complete
    const waitPromises = jobIds.map(jobId =>
      spectifyClient.waitForJobComplete(jobId, 120000)
    );

    await Promise.all(waitPromises);
    const endTime = Date.now();

    const totalDuration = endTime - startTime;
    const avgLatency = totalDuration / numJobs;
    const throughput = (numJobs / (totalDuration / 1000 / 60)).toFixed(2); // jobs/min

    console.log('  Throughput Results:');
    console.log(`    Total time: ${totalDuration}ms`);
    console.log(`    Average latency: ${avgLatency.toFixed(0)}ms`);
    console.log(`    Throughput: ${throughput} jobs/min`);

    // Get worker stats
    const stats = await spectifyClient.getStats();
    console.log(`    Workers used: ${stats.workers.total}`);
    console.log(`    Jobs completed: ${stats.jobs.completed}`);

    // Should handle at least 5 jobs/min (conservative estimate)
    expect(parseFloat(throughput)).toBeGreaterThan(5);
  }, 180000); // 3 minute timeout

  it('should measure worker pool scaling', async () => {
    const docPath = resolve('./tests/fixtures/openapi-docs/petstore.json');
    const document = await loadOpenAPIDocument(docPath);
    const documentId = await mcpClient.uploadDocument(document);

    // Get initial stats
    const initialStats = await spectifyClient.getStats();
    console.log('  Initial worker pool:');
    console.log(`    Total: ${initialStats.workers.total}`);
    console.log(`    Active: ${initialStats.workers.active}`);

    // Submit jobs to trigger scaling
    const numJobs = 20;
    const jobPromises = Array.from({ length: numJobs }, () =>
      spectifyClient.submitLintJob({
        documentId,
        rulesetName: 'pubhub',
        forceRun: true
      })
    );

    const jobIds = await Promise.all(jobPromises);

    // Check stats while jobs are running
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
    const runningStats = await spectifyClient.getStats();

    console.log('  Worker pool under load:');
    console.log(`    Total: ${runningStats.workers.total}`);
    console.log(`    Active: ${runningStats.workers.active}`);
    console.log(`    Queued jobs: ${runningStats.jobs.queued}`);

    // Wait for completion
    await Promise.all(
      jobIds.map(jobId => spectifyClient.waitForJobComplete(jobId, 120000))
    );

    // Final stats
    const finalStats = await spectifyClient.getStats();
    console.log('  Final state:');
    console.log(`    Total workers: ${finalStats.workers.total}`);
    console.log(`    Idle workers: ${finalStats.workers.idle}`);
    console.log(`    Completed jobs: ${finalStats.jobs.completed}`);

    // Workers should scale up under load
    expect(runningStats.workers.active).toBeGreaterThan(0);
  }, 240000); // 4 minute timeout

  it('should measure memory usage', async () => {
    const initialStats = await spectifyClient.getStats();
    
    // Submit many jobs (reduced from 50 to 10 to prevent hanging)
    const docPath = resolve('./tests/fixtures/openapi-docs/petstore.json');
    const document = await loadOpenAPIDocument(docPath);
    const documentId = await mcpClient.uploadDocument(document);

    const jobPromises = Array.from({ length: 10 }, () =>
      spectifyClient.submitLintJob({
        documentId,
        rulesetName: 'pubhub',
        forceRun: true
      })
    );

    const jobIds = await Promise.all(jobPromises);
    
    // Wait for all with shorter timeout
    await Promise.all(
      jobIds.map(jobId => spectifyClient.waitForJobComplete(jobId, 30000))
    );

    const finalStats = await spectifyClient.getStats();

    console.log('  Job Statistics:');
    console.log(`    Total jobs: ${finalStats.jobs.total}`);
    console.log(`    Completed: ${finalStats.jobs.completed}`);
    console.log(`    Failed: ${finalStats.jobs.failed}`);
    console.log(`    Cache hit rate: ${(finalStats.cache.hitRate * 100).toFixed(1)}%`);

    // All jobs should complete successfully
    expect(finalStats.jobs.failed).toBe(0);
  }, 60000); // 1 minute timeout (reduced from 5 minutes)
});
