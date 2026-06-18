/**
 * Results command - View detailed lint results
 */

import chalk from 'chalk';
import ora from 'ora';
import { SpectifyAPIClient, ConnectionError } from '../api-client.js';
import { HistoryManager } from '../history-manager.js';
import { formatSummary, formatIssuesTable, formatRuleSummaryTable, formatRuleDetailView } from '../formatters.js';

export interface ResultsOptions {
  apiUrl?: string;
  rule?: string;
  severity?: string;
  format?: 'text' | 'json' | 'sarif';
  output?: string;
  json?: boolean;
}

export async function resultsCommand(jobId: string, options: ResultsOptions): Promise<void> {
  try {
    const client = new SpectifyAPIClient(options.apiUrl);

    // Handle SARIF report generation
    if (options.output || options.format === 'sarif') {
      const spinner = ora('Generating SARIF report...').start();
      try {
        const sarif = await client.generateReport(jobId, 'sarif');
        spinner.succeed('SARIF report generated');

        if (options.output) {
          // Write to file
          const fs = await import('fs/promises');
          await fs.writeFile(options.output, JSON.stringify(sarif, null, 2), 'utf-8');
          console.log(chalk.green(`\n✓ SARIF report saved to ${options.output}`));
        } else {
          // Output to stdout
          console.log(JSON.stringify(sarif, null, 2));
        }
        return;
      } catch (error) {
        if (error instanceof ConnectionError) throw error;
        spinner.fail('Failed to generate report');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    }

    // Try history first for faster access
    const historyManager = new HistoryManager();
    const historyEntry = await historyManager.getById(jobId);

    // Fetch results from API
    const spinner = ora('Fetching results...').start();
    let results;
    try {
      results = await client.getJobResults(jobId);
      spinner.succeed('Results retrieved');

      // --json: output raw API response and exit
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }
    } catch (error) {
      if (error instanceof ConnectionError) throw error;
      spinner.fail('Failed to get results');

      // If API fails, check if we have it in history
      if (historyEntry) {
        console.log(chalk.yellow('Using cached results from history'));
        console.log(chalk.dim(`File: ${historyEntry.filePath}`));
        console.log(chalk.dim(`Ruleset: ${historyEntry.rulesetName} v${historyEntry.rulesetVersion}`));
        console.log(chalk.dim(`Timestamp: ${new Date(historyEntry.timestamp).toLocaleString()}\n`));
        console.log(chalk.yellow('Summary from history:'));
        console.log(`Total Issues: ${historyEntry.summary.totalIssues}`);
        console.log(`  Errors: ${historyEntry.summary.errorCount}`);
        console.log(`  Warnings: ${historyEntry.summary.warningCount}`);
        console.log(`  Info: ${historyEntry.summary.infoCount}`);
        console.log(`  Hints: ${historyEntry.summary.hintCount}\n`);
        console.log(chalk.dim('Note: Detailed results not available. Run lint again to see full details.'));
        process.exit(0);
      }

      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }

    // Filter results
    let filteredIssues = results.results || [];

    if (options.rule) {
      filteredIssues = filteredIssues.filter(
        issue => issue.ruleId === options.rule || issue.code === options.rule
      );
    }

    if (options.severity) {
      const severityMap: Record<string, number> = {
        error: 0,
        warning: 1,
        info: 2,
        hint: 3,
      };
      const severityLevel = severityMap[options.severity.toLowerCase()];
      if (severityLevel !== undefined) {
        filteredIssues = filteredIssues.filter(issue => issue.severity === severityLevel);
      }
    }

    // Display results
    if (options.format === 'json') {
      console.log(JSON.stringify({
        ...results,
        results: filteredIssues,
      }, null, 2));
    } else {
      // Gray out summary when showing rule details
      console.log(formatSummary(results, options.rule ? true : false));

      if (filteredIssues.length > 0) {
        if (options.rule) {
          // Rule detail view: show issues for specific rule without repetition
          console.log(chalk.bold(`Filtered results (${filteredIssues.length} of ${results.results.length}):\n`));
          console.log(formatRuleDetailView(filteredIssues));
        } else if (options.severity) {
          // Severity filter: show detailed issues table
          console.log(chalk.dim(`Filtered results (${filteredIssues.length} of ${results.results.length}):\n`));
          console.log(formatIssuesTable(filteredIssues));
        } else {
          // Summary view: show issues grouped by rule
          console.log(chalk.bold('\nIssues by Rule:\n'));
          console.log(formatRuleSummaryTable(filteredIssues));
          console.log(chalk.dim(`\nTo see detailed issues for a specific rule, use: ${chalk.cyan('spectify results <jobId> --rule <ruleName>')}\n`));
        }
      } else if (options.rule || options.severity) {
        console.log(chalk.yellow('No issues match the specified filters.\n'));
      }
    }
  } catch (error) {
    throw error;
  }
}
