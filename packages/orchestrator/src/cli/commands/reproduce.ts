/**
 * Reproduce command - Generate Spectral CLI reproduction instructions for a lint job
 */

import chalk from 'chalk';
import ora from 'ora';
import { SpectifyAPIClient, ConnectionError } from '../api-client.js';

export interface ReproduceOptions {
  apiUrl?: string;
  output?: string;
}

export async function reproduceCommand(jobId: string, options: ReproduceOptions): Promise<void> {
  const client = new SpectifyAPIClient(options.apiUrl);

  const spinner = ora('Generating reproduction instructions...').start();
  try {
    const markdown = await client.getReproductionInstructions(jobId);
    spinner.succeed('Reproduction instructions generated');

    if (options.output) {
      const fs = await import('fs/promises');
      await fs.writeFile(options.output, markdown, 'utf-8');
      console.log(chalk.green(`\n✓ Reproduction instructions saved to ${options.output}`));
    } else {
      console.log('');
      console.log(markdown);
    }
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    spinner.fail('Failed to generate reproduction instructions');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
