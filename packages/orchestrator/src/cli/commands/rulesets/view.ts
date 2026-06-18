/**
 * `spectify rulesets view` - List available rulesets or view details of one.
 *
 * This command goes through the HTTP API (auto-starting an embedded
 * orchestrator when needed) so that what is displayed matches what a remote
 * client would see. For an in-process load-only validation that does not
 * spin up a server, see `check.ts`.
 */

import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { SpectifyAPIClient } from '../../api-client.js';
import { formatRulesetsTable, formatSeverity } from '../../formatters.js';
import { maybeStartEmbeddedServer, getApiUrl } from '../../utils/embedded-server.js';
import { handleCommandError } from '../../utils/connection-error.js';

export interface ViewRulesetsOptions {
  apiUrl?: string;
  format?: 'table' | 'json';
  name?: string;
  version?: string;
}

export async function viewRulesetsCommand(options: ViewRulesetsOptions): Promise<void> {
  // Auto-start embedded server if needed
  const shutdownServer = await maybeStartEmbeddedServer(options.apiUrl);

  let spinner: ReturnType<typeof ora> | undefined;

  try {
    const apiUrl = await getApiUrl(options.apiUrl);
    const client = new SpectifyAPIClient(apiUrl);

    // If name is provided, show details for that ruleset
    if (options.name) {
      spinner = ora(`Fetching details for ruleset '${options.name}'...`).start();
      const details = await client.getRulesetDetails(options.name, options.version);
      spinner.succeed(`Found ruleset '${options.name}'`);
      spinner = undefined;

      if (options.format === 'json') {
        console.log(JSON.stringify(details, null, 2));
      } else {
        // Format as human-readable text
        console.log('');
        console.log(chalk.bold.cyan(`${details.displayName} (${details.name})`));
        console.log(chalk.dim('─'.repeat(60)));
        console.log(`Version:     ${details.version}`);
        console.log(`Category:    ${details.category}`);
        console.log(`Rules:       ${details.ruleCount}`);
        if (details.releaseDate) {
          console.log(`Released:    ${details.releaseDate}`);
        }
        if (details.tags && details.tags.length > 0) {
          console.log(`Tags:        ${details.tags.join(', ')}`);
        }
        console.log('');
        console.log(chalk.bold('Description:'));
        console.log(details.description);
        console.log('');

        // Display rules in a table
        console.log(chalk.bold('Rules:'));
        const table = new Table({
          head: [
            chalk.bold('#'),
            chalk.bold('Rule Name'),
            chalk.bold('Severity'),
            chalk.bold('Description'),
          ],
          colWidths: [5, 40, 12, 50],
          wordWrap: true,
        });

        details.rules.forEach((rule: any, index: number) => {
          table.push([
            String(index + 1),
            chalk.cyan(rule.name),
            formatSeverity(rule.severity),
            rule.description || rule.message || '-',
          ]);
        });

        console.log(table.toString());
        console.log('');
      }
    } else {
      // List all rulesets
      spinner = ora('Fetching rulesets...').start();
      const rulesets = await client.getRulesets();
      spinner.succeed(`Found ${rulesets.length} rulesets`);
      spinner = undefined;

      if (options.format === 'json') {
        console.log(JSON.stringify(rulesets, null, 2));
      } else {
        console.log(chalk.bold('\nAvailable Rulesets\n'));
        console.log(formatRulesetsTable(rulesets));
        console.log(chalk.dim('Use `spectify rulesets <name>` to view detailed rules\n'));
      }
    }
  } catch (error) {
    await handleCommandError(error);
  } finally {
    // Shutdown embedded server if we started it
    if (shutdownServer) {
      await shutdownServer();
    }
  }
}
