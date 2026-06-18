/**
 * Status command - Check job status
 */

import chalk from 'chalk';
import ora from 'ora';
import { SpectifyAPIClient } from '../api-client.js';
import { formatJobStatus } from '../formatters.js';

export interface StatusOptions {
  apiUrl?: string;
  watch?: boolean;
}

export async function statusCommand(jobId: string, options: StatusOptions): Promise<void> {
  try {
    const client = new SpectifyAPIClient(options.apiUrl);

    if (options.watch) {
      // Watch mode: poll until completion
      const spinner = ora('Checking status...').start();

      await client.pollJobUntilComplete(jobId, {
        interval: 2000,
        onProgress: (status) => {
          spinner.stop();
          console.clear();
          console.log(formatJobStatus(status));

          if (status.status === 'running' || status.status === 'queued') {
            spinner.start('Waiting for completion...');
          }
        },
      });

      spinner.succeed('Job completed');
      console.log(chalk.green('\n✓ Job completed. Use `spectify results <jobId>` to view results.\n'));
    } else {
      // Single check
      const spinner = ora('Checking status...').start();
      const status = await client.getJobStatus(jobId);
      spinner.stop();

      console.log(formatJobStatus(status));

      if (status.status === 'completed') {
        console.log(chalk.dim('Use `spectify results <jobId>` to view results.\n'));
      } else if (status.status === 'running' || status.status === 'queued') {
        console.log(chalk.dim('Use `spectify status <jobId> --watch` to wait for completion.\n'));
      }
    }
  } catch (error) {
    throw error;
  }
}
