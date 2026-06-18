/**
 * History command - View lint history
 */

import chalk from 'chalk';
import { HistoryManager } from '../history-manager.js';
import { formatHistoryTable } from '../formatters.js';

export interface HistoryOptions {
  limit?: number;
  file?: string;
  ruleset?: string;
  clear?: boolean;
}

export async function historyCommand(options: HistoryOptions): Promise<void> {
  try {
    const historyManager = new HistoryManager();

    if (options.clear) {
      // Clear history
      await historyManager.clear();
      console.log(chalk.green('✓ History cleared\n'));
      return;
    }

    // Get history entries
    let entries;
    if (options.file) {
      entries = await historyManager.searchByFile(options.file);
      if (entries.length === 0) {
        console.log(chalk.yellow(`No history found for file: ${options.file}\n`));
        return;
      }
    } else if (options.ruleset) {
      entries = await historyManager.searchByRuleset(options.ruleset);
      if (entries.length === 0) {
        console.log(chalk.yellow(`No history found for ruleset: ${options.ruleset}\n`));
        return;
      }
    } else {
      const limit = options.limit || 10;
      entries = await historyManager.getRecent(limit);
    }

    if (entries.length === 0) {
      console.log(chalk.dim('No history entries found.\n'));
      console.log(chalk.dim('Run `spectify lint <file>` to analyze an OpenAPI document.\n'));
      return;
    }

    console.log(chalk.bold('\nLint History\n'));
    console.log(formatHistoryTable(entries));
    console.log(chalk.dim(`Use 'spectify results <jobId>' to view detailed results\n`));
  } catch (error) {
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
