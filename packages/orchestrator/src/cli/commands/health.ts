/**
 * Health command - Check orchestrator service health
 */

import ora from 'ora';
import { SpectifyAPIClient } from '../api-client.js';
import { formatHealth } from '../formatters.js';
import { SpectifyMode } from '../config-manager.js';
import { maybeStartEmbeddedServer, getApiUrl } from '../utils/embedded-server.js';
import { handleCommandError } from '../utils/connection-error.js';

export interface HealthOptions {
  apiUrl?: string;
  format?: 'text' | 'json';
  mode?: SpectifyMode;
}

export async function healthCommand(options: HealthOptions): Promise<void> {
  // In embedded mode, spin up the server first (same as lint command)
  const shutdownServer = await maybeStartEmbeddedServer(options.apiUrl);

  try {
    const apiUrl = options.apiUrl || await getApiUrl();
    const client = new SpectifyAPIClient(apiUrl);

    const spinner = ora('Checking health...').start();
    const health = await client.getHealth();
    spinner.stop();

    if (options.format === 'json') {
      console.log(JSON.stringify(health, null, 2));
    } else {
      console.log(formatHealth(health));
    }

    // Exit with error if unhealthy
    if (health.status === 'unhealthy') {
      process.exit(1);
    }
  } catch (error) {
    await handleCommandError(error);
  } finally {
    if (shutdownServer) {
      await shutdownServer();
    }
  }
}
