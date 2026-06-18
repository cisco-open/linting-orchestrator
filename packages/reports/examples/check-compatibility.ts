/**
 * Example: Check version compatibility before sending notifications
 * 
 * This example demonstrates how to validate that your client version
 * is compatible with the Report Service server before performing operations.
 */

import { ReportServiceClient } from '../src/client/index.js';

async function main() {
  const client = new ReportServiceClient({
    url: process.env.SPECTIFYR_URL || 'http://localhost:3010',
    apiKey: process.env.SPECTIFYR_API_KEY || 'test-key',
  });

  console.log('Checking compatibility with Report Service...\n');

  try {
    const result = await client.checkCompatibility();

    console.log('Compatibility Check Results:');
    console.log('----------------------------');
    console.log(`Client Version:          ${result.clientVersion}`);
    console.log(`Server Version:          ${result.serverVersion}`);
    console.log(`Server Expects:          ${result.serverExpectedVersion}`);
    console.log(`Compatible:              ${result.compatible ? '✅ YES' : '❌ NO'}`);

    if (result.details) {
      console.log(`Details:                 ${result.details}`);
    }

    console.log('\n');

    if (!result.compatible) {
      console.error('⚠️  WARNING: Client version is incompatible with server!');
      console.error('Please upgrade your client library to match the server requirements.\n');
      process.exit(1);
    }

    console.log('✅ Version compatibility verified - safe to proceed with operations.\n');

    // Now safe to send notifications
    await client.initialize();
    
    // ... perform operations ...
    
  } catch (error) {
    console.error('Failed to check compatibility:', (error as Error).message);
    console.error('Server may be unreachable or unhealthy.\n');
    process.exit(1);
  }
}

// Run example
main().catch(console.error);
