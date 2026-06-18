/**
 * Jobs command - List recent lint jobs
 */

import chalk from 'chalk';
import ora from 'ora';
import { SpectifyAPIClient, ConnectionError } from '../api-client.js';
import { formatJobsTable } from '../formatters.js';
import { getConfigManager } from '../config-manager.js';
import { getApiUrl } from '../utils/embedded-server.js';

export interface JobsOptions {
  status?: string;
  ruleset?: string;
  limit?: number;
  detailed?: boolean;
  json?: boolean;
}

export async function jobsCommand(options: JobsOptions): Promise<void> {
  try {
    // Check if in embedded mode - jobs command requires standalone/companion
    const configManager = getConfigManager();
    const config = await configManager.get();

    if (config.defaultMode === 'embedded') {
      console.log(chalk.yellow('⚠️  Jobs listing requires standalone or companion mode\n'));
      console.log(chalk.dim('Embedded mode does not persist jobs across commands.'));
      console.log(chalk.dim('Switch to standalone mode for job history:\n'));
      console.log(chalk.bold('   spectify config set mode standalone'));
      console.log(chalk.bold('   spectifyd  # Start daemon in separate terminal\n'));
      console.log(chalk.dim('Then use "spectify jobs" to list jobs.\n'));
      process.exit(1);
    }

    // Get API URL based on configured mode
    const apiUrl = await getApiUrl();
    const client = new SpectifyAPIClient(apiUrl);

    // Build query parameters
    const queryParams: Record<string, string> = {};

    if (options.status) {
      queryParams.status = options.status;
    }

    if (options.ruleset) {
      queryParams.rulesetName = options.ruleset;
    }

    if (options.limit) {
      queryParams.limit = options.limit.toString();
    } else {
      queryParams.limit = '20';  // Default limit
    }

    queryParams.sortBy = 'timestamp';
    queryParams.sortOrder = 'desc';

    // Fetch jobs
    const spinner = ora('Fetching jobs...').start();
    let response;
    try {
      if (options.detailed) {
        response = await client.listJobsDetailed(queryParams);
      } else {
        response = await client.listJobs(queryParams);
      }
      spinner.succeed('Jobs retrieved');
    } catch (error) {
      if (error instanceof ConnectionError) throw error;
      process.exit(1);
    }

    // Display results
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    if (response.jobs.length === 0) {
      console.log(chalk.dim('\nNo jobs found.\n'));
      console.log(chalk.dim('Run `spectify lint <file>` to analyze an OpenAPI document.\n'));
      return;
    }

    console.log(chalk.bold(`\nLint Jobs (${response.jobs.length} of ${response.pagination.total})\n`));
    console.log(formatJobsTable(response.jobs, options.detailed || false));

    // Show pagination info if there are more results
    if (response.pagination.hasMore) {
      const currentEnd = response.pagination.offset + response.jobs.length;
      console.log(chalk.dim(`\nShowing ${response.jobs.length} jobs (${response.pagination.offset + 1}-${currentEnd} of ${response.pagination.total})`));
      console.log(chalk.dim('Use --limit option to show more results.\n'));
    }

    console.log(chalk.dim(`Use 'spectify results <jobId>' to view detailed results\n`));
  } catch (error) {
    throw error;
  }
}
