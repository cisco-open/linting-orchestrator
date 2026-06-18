/**
 * End-to-End Integration Tests
 * 
 * Tests the complete workflow:
 * 1. Start MCP server and Spectify orchestrator
 * 2. Upload OpenAPI document to MCP
 * 3. Submit lint job to Spectify
 * 4. Poll for completion
 * 5. Retrieve and validate results
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

describe('End-to-End Integration Tests', () => {
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

    // Verify both services are healthy
    const mcpHealth = await mcpClient.health();
    expect(mcpHealth.status).toBe('ok');

    const spectifyHealth = await spectifyClient.health();
    expect(spectifyHealth.status).toBe('ok');

    console.log('\n✓ All services started and healthy\n');
  }, 120000); // 2 minute timeout for service startup

  afterAll(async () => {
    await stopAllServices(services);
  }, 30000);

  describe('Complete Workflow', () => {
    it('should process petstore document with pubhub ruleset', async () => {
      // 1. Load OpenAPI document
      const docPath = resolve('./tests/fixtures/openapi-docs/petstore.json');
      const document = await loadOpenAPIDocument(docPath);

      // 2. Upload to MCP server
      const documentId = await mcpClient.uploadDocument(document);
      expect(documentId).toBeTruthy();
      console.log(`  Uploaded document: ${documentId}`);

      // 3. Submit lint job
      const jobId = await spectifyClient.submitLintJob({
        documentId,
        rulesetName: 'pubhub'
      });
      expect(jobId).toBeTruthy();
      console.log(`  Submitted job: ${jobId}`);

      // 4. Wait for completion
      const status = await spectifyClient.waitForJobComplete(jobId, 60000);
      expect(status.status).toBe('completed');
      console.log(`  Job completed in ${status.endTime && status.startTime 
        ? new Date(status.endTime).getTime() - new Date(status.startTime).getTime() 
        : 'N/A'}ms`);

      // 5. Get results
      const results = await spectifyClient.getJobResults(jobId);
      expect(results.jobId).toBe(jobId);
      expect(results.documentId).toBe(documentId);
      expect(results.rulesetName).toBe('pubhub');
      expect(results.status).toBe('completed');
      expect(results.summary).toBeDefined();
      
      console.log(`  Results: ${results.summary.totalIssues} issues found`);
      console.log(`    Errors: ${results.summary.errors}`);
      console.log(`    Warnings: ${results.summary.warnings}`);
      console.log(`    Infos: ${results.summary.infos}`);
      console.log(`    Hints: ${results.summary.hints}`);
    }, 90000); // 90 second timeout

    it('should process same document with contract ruleset', async () => {
      // 1. Load and upload document
      const docPath = resolve('./tests/fixtures/openapi-docs/petstore.json');
      const document = await loadOpenAPIDocument(docPath);
      const documentId = await mcpClient.uploadDocument(document);

      // 2. Submit lint job with contract ruleset
      const jobId = await spectifyClient.submitLintJob({
        documentId,
        rulesetName: 'contract'
      });
      
      console.log(`  Submitted contract job: ${jobId}`);

      // 3. Wait for completion
      const status = await spectifyClient.waitForJobComplete(jobId, 60000);
      expect(status.status).toBe('completed');

      // 4. Get results
      const results = await spectifyClient.getJobResults(jobId);
      expect(results.rulesetName).toBe('contract');
      expect(results.status).toBe('completed');
      
      console.log(`  Contract results: ${results.summary.totalIssues} issues`);
    }, 90000);

    it('should handle multiple jobs in parallel', async () => {
      // Upload document once
      const docPath = resolve('./tests/fixtures/openapi-docs/petstore.json');
      const document = await loadOpenAPIDocument(docPath);
      const documentId = await mcpClient.uploadDocument(document);

      // Submit 3 jobs in parallel
      const jobPromises = [
        spectifyClient.submitLintJob({ documentId, rulesetName: 'pubhub' }),
        spectifyClient.submitLintJob({ documentId, rulesetName: 'contract' }),
        spectifyClient.submitLintJob({ documentId, rulesetName: 'pubhub', forceRun: true })
      ];

      const jobIds = await Promise.all(jobPromises);
      expect(jobIds).toHaveLength(3);
      console.log(`  Submitted ${jobIds.length} parallel jobs`);

      // Wait for all to complete
      const statusPromises = jobIds.map(jobId => 
        spectifyClient.waitForJobComplete(jobId, 60000)
      );

      const statuses = await Promise.all(statusPromises);
      
      // All should complete successfully
      statuses.forEach((status, i) => {
        expect(status.status).toBe('completed');
        console.log(`  Job ${i + 1} completed: ${jobIds[i]}`);
      });
    }, 120000);
  });

  describe('Cache Behavior', () => {
    it('should return cached results on re-submission', async () => {
      // Upload document
      const docPath = resolve('./tests/fixtures/openapi-docs/petstore.json');
      const document = await loadOpenAPIDocument(docPath);
      const documentId = await mcpClient.uploadDocument(document);

      // First submission
      const jobId1 = await spectifyClient.submitLintJob({
        documentId,
        rulesetName: 'pubhub'
      });
      
      await spectifyClient.waitForJobComplete(jobId1, 60000);
      const results1 = await spectifyClient.getJobResults(jobId1);

      // Second submission (should hit cache)
      const startTime = Date.now();
      const jobId2 = await spectifyClient.submitLintJob({
        documentId,
        rulesetName: 'pubhub'
      });
      const submitDuration = Date.now() - startTime;

      const status2 = await spectifyClient.getJobStatus(jobId2);
      
      // Should return same job ID or complete instantly
      if (jobId1 === jobId2) {
        console.log('  ✓ Cache hit: returned same job ID');
        expect(status2.status).toBe('completed');
      } else {
        console.log('  ✓ Cache hit: job completed instantly');
        expect(submitDuration).toBeLessThan(1000); // Should be very fast
      }

      // Verify cache stats
      const stats = await spectifyClient.getStats();
      expect(stats.cache.hits).toBeGreaterThan(0);
      console.log(`  Cache hit rate: ${(stats.cache.hitRate * 100).toFixed(1)}%`);
    }, 90000);

    it('should bypass cache with forceRun flag', async () => {
      // Upload document
      const docPath = resolve('./tests/fixtures/openapi-docs/petstore.json');
      const document = await loadOpenAPIDocument(docPath);
      const documentId = await mcpClient.uploadDocument(document);

      // First submission
      const jobId1 = await spectifyClient.submitLintJob({
        documentId,
        rulesetName: 'pubhub'
      });
      
      await spectifyClient.waitForJobComplete(jobId1, 60000);

      // Second submission with forceRun
      const jobId2 = await spectifyClient.submitLintJob({
        documentId,
        rulesetName: 'pubhub',
        forceRun: true
      });

      // Should be different job ID
      expect(jobId2).not.toBe(jobId1);
      console.log('  ✓ Force run bypassed cache');

      await spectifyClient.waitForJobComplete(jobId2, 60000);
    }, 120000);

    it('should invalidate cache on explicit request', async () => {
      // Upload and lint document
      const docPath = resolve('./tests/fixtures/openapi-docs/petstore.json');
      const document = await loadOpenAPIDocument(docPath);
      const documentId = await mcpClient.uploadDocument(document);

      const jobId1 = await spectifyClient.submitLintJob({
        documentId,
        rulesetName: 'pubhub'
      });
      await spectifyClient.waitForJobComplete(jobId1, 60000);

      // Invalidate cache
      await spectifyClient.invalidateCache(documentId);
      console.log('  ✓ Cache invalidated');

      // Submit again - should create new job
      const jobId2 = await spectifyClient.submitLintJob({
        documentId,
        rulesetName: 'pubhub'
      });

      expect(jobId2).not.toBe(jobId1);
      await spectifyClient.waitForJobComplete(jobId2, 60000);
    }, 120000);
  });

  describe('Error Scenarios', () => {
    it('should handle non-existent document', async () => {
      const fakeDocumentId = '00000000-0000-0000-0000-000000000000';

      await expect(
        spectifyClient.submitLintJob({
          documentId: fakeDocumentId,
          rulesetName: 'pubhub'
        })
      ).rejects.toThrow(/document.*not found/i);

      console.log('  ✓ Correctly rejected non-existent document');
    });

    it('should handle invalid ruleset name', async () => {
      // Upload valid document
      const docPath = resolve('./tests/fixtures/openapi-docs/petstore.json');
      const document = await loadOpenAPIDocument(docPath);
      const documentId = await mcpClient.uploadDocument(document);

      // Try with invalid ruleset
      await expect(
        spectifyClient.submitLintJob({
          documentId,
          rulesetName: 'non-existent-ruleset'
        })
      ).rejects.toThrow(/ruleset.*not found/i);

      console.log('  ✓ Correctly rejected invalid ruleset');
    });

    it('should handle malformed OpenAPI document', async () => {
      // Upload malformed document
      const docPath = resolve('./tests/fixtures/openapi-docs/malformed.json');
      
      await expect(
        loadOpenAPIDocument(docPath)
      ).rejects.toThrow(); // Should fail to parse JSON

      console.log('  ✓ Correctly rejected malformed JSON');
    });

    it('should handle invalid OpenAPI document', async () => {
      // Upload document with missing required fields
      const docPath = resolve('./tests/fixtures/openapi-docs/invalid-missing-fields.json');
      const document = await loadOpenAPIDocument(docPath);
      const documentId = await mcpClient.uploadDocument(document);

      // Submit lint job
      const jobId = await spectifyClient.submitLintJob({
        documentId,
        rulesetName: 'pubhub'
      });

      // Should complete but report errors
      const status = await spectifyClient.waitForJobComplete(jobId, 60000);
      expect(status.status).toBe('completed'); // Completes even with errors

      const results = await spectifyClient.getJobResults(jobId) as any;
      expect(results.summary.totalIssues).toBeGreaterThan(0);
      expect(results.summary.errorCount).toBeGreaterThan(0);

      console.log(`  ✓ Processed invalid document: ${results.summary.errorCount} errors found`);
    }, 90000);
  });

  describe('Service Health', () => {
    it('should report healthy status', async () => {
      const health = await spectifyClient.health();
      
      expect(health.status).toBe('ok');
      expect(health.stats).toBeDefined();
      expect(health.stats?.workers.total).toBeGreaterThan(0);

      console.log('  Worker pool status:');
      console.log(`    Total workers: ${health.stats?.workers.total}`);
      console.log(`    Active: ${health.stats?.workers.active}`);
      console.log(`    Idle: ${health.stats?.workers.idle}`);
    });

    it('should list available rulesets', async () => {
      const rulesets = await spectifyClient.listRulesets();
      
      expect(rulesets).toBeInstanceOf(Array);
      expect(rulesets.length).toBeGreaterThan(0);

      console.log('  Available rulesets:');
      rulesets.forEach(ruleset => {
        console.log(`    - ${ruleset.name}@${ruleset.defaultVersion} (${ruleset.availableVersions.length} versions)`);
      });

      // Should include pubhub and contract
      const rulesetNames = rulesets.map(r => r.name);
      expect(rulesetNames).toContain('pubhub');
      expect(rulesetNames).toContain('contract');
    });
  });
});
