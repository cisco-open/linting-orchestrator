/**
 * Example: Using ReportServiceClient
 *
 * This demonstrates how to integrate the client library
 * into your application (e.g., the linting orchestrator).
 */

import { ReportServiceClient } from '../src/client/index.js';
import type { JobNotification } from '../src/types.js';

/**
 * Example 1: Basic Usage
 */
async function basicExample() {
  console.log('=== Example 1: Basic Usage ===\n');

  const client = new ReportServiceClient({
    url: 'http://localhost:3010',
    apiKey: process.env.SPECTIFYR_API_KEY || 'test-key-123',
  });

  await client.initialize();

  const notification: JobNotification = {
    jobId: `example-${Date.now()}`,
    documentId: 'doc-example',
    status: 'completed',
    results: [
      {
        rulesetName: 'example-ruleset',
        status: 'completed',
        issues: [],
        summary: {
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          hintCount: 0,
          totalIssues: 0,
        },
      },
    ],
    summary: {
      totalIssues: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      hintCount: 0,
      durationMs: 1200,
    },
    metadata: {
      name: 'Example API',
      version: '1.0.0',
    },
    timestamp: new Date().toISOString(),
  };

  const result = await client.notify(notification);

  console.log('Result:', {
    success: result.success,
    jobId: result.jobId,
    attempts: result.attempts,
    storedLocally: result.storedLocally,
  });

  await client.shutdown();
}

/**
 * Example 2: With Background Retry
 */
async function retryJobExample() {
  console.log('\n=== Example 2: With Background Retry ===\n');

  const client = new ReportServiceClient({
    url: 'http://localhost:3010',
    apiKey: process.env.SPECTIFYR_API_KEY || 'test-key-123',
    enableRetryJob: true,
    retryJobInterval: 10000, // Retry every 10 seconds (for demo)
  });

  await client.initialize();

  // Send notification
  const notification: JobNotification = {
    jobId: `retry-example-${Date.now()}`,
    documentId: 'doc-retry',
    status: 'completed',
    results: [],
    summary: {
      totalIssues: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      hintCount: 0,
      durationMs: 500,
    },
    metadata: { name: 'Retry Example' },
    timestamp: new Date().toISOString(),
  };

  await client.notify(notification);

  // Check status
  const status = await client.getStatus();
  console.log('Client Status:', status);

  // Wait for a bit to let retry job run
  console.log('\nWaiting for retry job to run...');
  await new Promise(resolve => setTimeout(resolve, 15000));

  // Check pending count
  const pendingCount = await client.getPendingCount();
  console.log(`Pending notifications: ${pendingCount}`);

  await client.shutdown();
}

/**
 * Example 3: Fire-and-Forget Pattern (recommended for the linting orchestrator)
 */
async function fireAndForgetExample() {
  console.log('\n=== Example 3: Fire-and-Forget ===\n');

  const client = new ReportServiceClient({
    url: 'http://localhost:3010',
    apiKey: process.env.SPECTIFYR_API_KEY || 'test-key-123',
    enableRetryJob: true,
  });

  await client.initialize();

  // Simulate job completion in the linting orchestrator
  async function onJobComplete(jobId: string) {
    console.log(`Job ${jobId} completed`);

    const notification: JobNotification = {
      jobId,
      documentId: 'doc-123',
      status: 'completed',
      results: [],
      summary: {
        totalIssues: 0,
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        hintCount: 0,
        durationMs: 800,
      },
      metadata: { name: 'Fire-and-Forget Example' },
      timestamp: new Date().toISOString(),
    };

    // Fire-and-forget - don't block on notification
    client.notify(notification).catch(err => {
      console.error('Notification failed (will retry)', err.message);
    });

    console.log(`Job ${jobId} processing complete (notification sent async)`);
  }

  // Simulate multiple jobs
  await onJobComplete('job-1');
  await onJobComplete('job-2');
  await onJobComplete('job-3');

  // Give notifications time to send
  await new Promise(resolve => setTimeout(resolve, 2000));

  await client.shutdown();
}

/**
 * Example 4: Manual Retry Control
 */
async function manualRetryExample() {
  console.log('\n=== Example 4: Manual Retry Control ===\n');

  const client = new ReportServiceClient({
    url: 'http://localhost:3010',
    apiKey: process.env.SPECTIFYR_API_KEY || 'test-key-123',
    enableRetryJob: false, // Disable automatic retry
  });

  await client.initialize();

  // Check pending notifications
  const pendingBefore = await client.getPendingCount();
  console.log(`Pending notifications: ${pendingBefore}`);

  if (pendingBefore > 0) {
    console.log('Manually triggering retry...');
    const stats = await client.retryNow();
    console.log('Retry Stats:', stats);
  } else {
    console.log('No pending notifications to retry');
  }

  await client.shutdown();
}

/**
 * Run all examples
 */
async function main() {
  console.log('ReportServiceClient Examples\n');
  console.log('Make sure Report Service is running at http://localhost:3010\n');

  try {
    await basicExample();
    await fireAndForgetExample();

    // Uncomment to run other examples:
    // await retryJobExample();
    // await manualRetryExample();

    console.log('\n✓ All examples completed successfully');
  } catch (error) {
    console.error('\n✗ Example failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
