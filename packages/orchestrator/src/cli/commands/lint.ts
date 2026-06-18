/**
 * Lint command - Submit documents for linting
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { SpectifyAPIClient } from '../api-client.js';
import { HistoryManager } from '../history-manager.js';
import { formatSummary, formatIssuesTable } from '../formatters.js';
import { maybeStartEmbeddedServer, getApiUrl } from '../utils/embedded-server.js';

export interface LintOptions {
  ruleset?: string;
  version?: string;
  apiUrl?: string;
  noCache?: boolean;
  showAll?: boolean;
  override?: string[];
  /** Progress display interval in seconds (default: 5). Only applies to multi-ruleset runs. */
  pollInterval?: number;
}

export async function lintCommand(filePath: string, options: LintOptions): Promise<void> {
  // Auto-start embedded server if needed (BEFORE getting API URL)
  const shutdownServer = await maybeStartEmbeddedServer(options.apiUrl);

  let exitCode = 0;  // Track exit code to return after cleanup

  try {
    // Resolve file path
    const resolvedPath = path.resolve(filePath);

    // Read and validate file
    const spinner = ora('Reading document...').start();
    let content: string;
    try {
      content = await fs.readFile(resolvedPath, 'utf-8');
    } catch (error) {
      spinner.fail(`File not found: ${filePath}`);
      exitCode = 1;
      return;
    }
    // Parse to validate the document is YAML or JSON
    try {
      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        const yaml = await import('yaml');
        yaml.parse(content);
      } else {
        JSON.parse(content);
      }
    } catch (error) {
      spinner.fail('Invalid document format (only YAML and JSON are supported');
      console.error(chalk.red(`Parse error: ${error instanceof Error ? error.message : String(error)}`));
      exitCode = 1;
      return;
    }

    spinner.succeed('Document loaded successfully');

    // Create API client with correct URL for current mode (AFTER server is started)
    const apiUrl = await getApiUrl(options.apiUrl);
    const client = new SpectifyAPIClient(apiUrl);

    // Upload document first (standalone mode)
    const uploadSpinner = ora('Uploading document...').start();
    let documentId: string;
    try {
      const format = (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) ? 'yaml' : 'json';
      const uploadResponse = await client.uploadDocument({
        content,
        format,
        metadata: {
          fileName: path.basename(resolvedPath),
          source: 'cli'
        }
      });
      documentId = uploadResponse.documentId;
      uploadSpinner.succeed(`Document uploaded: ${chalk.dim(documentId.slice(0, 12))}...`);
    } catch (error) {
      uploadSpinner.fail('Failed to upload document');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      exitCode = 1;
      return;
    }

    // Determine rulesets to run
    let rulesetNames: string[];
    if (options.ruleset) {
      // Parse comma-separated rulesets
      rulesetNames = options.ruleset.split(',').map(r => r.trim()).filter(r => r.length > 0);
      if (rulesetNames.length === 0) {
        console.error(chalk.red('Invalid ruleset specification'));
        exitCode = 1;
        return;
      }
    } else {
      // TODO: Get default rulesets from CLI config (profiles)
      // For now, fetch all available rulesets from server
      try {
        const catalog = await client.getRulesets();
        rulesetNames = catalog.map(r => r.name);
        console.log(chalk.dim(`Running all available rulesets: ${rulesetNames.join(', ')}`));
      } catch (error) {
        console.error(chalk.red('Failed to fetch rulesets from server'));
        exitCode = 1;
        return;
      }
    }

    const rulesetVersion = options.version;

    // Parse --override flag into ruleOverrides map
    // Supports both repeated flags (--override a=off --override b=warn) and comma-separated (--override a=off,b=warn)
    let ruleOverrides: Record<string, string> | undefined;
    if (options.override && options.override.length > 0) {
      ruleOverrides = {};
      const validSeverities = new Set(['off', 'error', 'warn', 'info', 'hint']);
      // Flatten: each array element may itself be comma-separated
      const entries = options.override.flatMap(o => o.split(','));
      for (const entry of entries) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) {
          // No '=' means disable (off)
          ruleOverrides[trimmed] = 'off';
        } else {
          const ruleId = trimmed.slice(0, eqIdx).trim();
          const severity = trimmed.slice(eqIdx + 1).trim().toLowerCase();
          if (!ruleId) {
            console.error(chalk.red(`Invalid override: empty rule ID in "${trimmed}"`));
            exitCode = 1;
            return;
          }
          if (!validSeverities.has(severity)) {
            console.error(chalk.red(`Invalid severity "${severity}" for rule "${ruleId}". Valid: off, error, warn, info, hint`));
            exitCode = 1;
            return;
          }
          ruleOverrides[ruleId] = severity;
        }
      }
      if (Object.keys(ruleOverrides).length === 0) {
        ruleOverrides = undefined;
      }
    }

    // Submit lint jobs sequentially (one per ruleset)
    console.log();
    console.log(chalk.bold(`Submitting ${rulesetNames.length} lint job(s)...`));
    const jobIds: string[] = [];
    const jobDetails: Array<{ jobId: string; ruleset: string }> = [];

    for (const rulesetName of rulesetNames) {
      try {
        const response = await client.submitLint({
          documentId,
          rulesetName,
          rulesetVersion,
          ruleOverrides,
        });
        jobIds.push(response.jobId);
        jobDetails.push({ jobId: response.jobId, ruleset: rulesetName });

        // Show minimal progress
        console.log(chalk.green('✓') + ` ${rulesetName}: ${chalk.dim(response.jobId)}`);
      } catch (error) {
        console.log(chalk.red('✗') + ` ${rulesetName}: ${chalk.red('Failed')}`);
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        exitCode = 1;
        return;
      }
    }

    console.log();
    console.log(chalk.bold.green('✓ All jobs submitted successfully'));
    console.log();
    console.log(chalk.dim('To view results, use:'));
    for (const { jobId, ruleset } of jobDetails) {
      console.log(chalk.dim(`  spectify results ${jobId}`) + chalk.dim.gray(` # ${ruleset}`));
    }

    // For single ruleset, show results immediately
    if (jobIds.length === 1) {
      console.log();
      const pollSpinner = ora('Analyzing document...').start();
      try {
        await client.pollJobUntilComplete(jobIds[0], {
          interval: 1000,
          timeout: 300000,
          onProgress: (status) => {
            if (status.progress) {
              const percent = Math.round((status.progress.completed / status.progress.total) * 100);
              pollSpinner.text = `Analyzing document... ${percent}%`;
              if (status.progress.currentRule) {
                pollSpinner.text += ` (${status.progress.currentRule})`;
              }
            }
          },
        });
        pollSpinner.succeed('Analysis complete');
      } catch (error) {
        pollSpinner.fail('Analysis failed');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        exitCode = 1;
        return;
      }

      // Get and display results
      const results = await client.getJobResults(jobIds[0]);

      // Save to history
      try {
        const historyManager = new HistoryManager();
        const entry = HistoryManager.createEntry(results, resolvedPath);
        const serverUrl = client.getServerUrl();
        const sessionId = client.getSessionId() || 'unknown';
        await historyManager.addEntry(entry, serverUrl, sessionId);
      } catch (error) {
        // Non-fatal: continue even if history save fails
        console.warn(chalk.yellow('Warning: Failed to save to history'));
      }

      // Display results
      console.log(formatSummary(results));

      // Display issues
      if (results.results && results.results.length > 0) {
        const issueLimit = options.showAll ? undefined : 20;
        console.log(formatIssuesTable(results.results, issueLimit));
      }

      // Exit with appropriate code
      if (results.summary.errorCount > 0) {
        exitCode = 1;
      }
    } else {
      // Multiple rulesets - wait for all jobs to complete and save consolidated results to history
      console.log();
      const pollSpinner = ora('Waiting for all jobs to complete...').start();

      // Track per-job statuses for progress display
      const TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors', 'failed', 'timeout']);
      const jobStatuses = new Map<string, string>();
      const progressIntervalMs = (options.pollInterval ?? 5) * 1000;
      const pollTimeoutMs = 300000;
      const pollStartTime = Date.now();
      let lastProgressTime = pollStartTime;

      try {
        // Poll all jobs, showing progress at configurable intervals
        while (true) {
          const pending = jobDetails.filter(j => !TERMINAL_STATUSES.has(jobStatuses.get(j.jobId) ?? ''));
          if (pending.length === 0) break;

          if (Date.now() - pollStartTime > pollTimeoutMs) {
            throw new Error(`Timeout: ${pending.map(j => j.ruleset).join(', ')} still pending after ${pollTimeoutMs / 60000} minutes`);
          }

          // Poll each pending job
          for (const { jobId } of pending) {
            try {
              const status = await client.getJobStatus(jobId);
              jobStatuses.set(jobId, status.status);
            } catch {
              // will retry next cycle
            }
          }

          const doneCount = jobDetails.filter(j => TERMINAL_STATUSES.has(jobStatuses.get(j.jobId) ?? '')).length;
          pollSpinner.text = `Waiting for all jobs to complete... [${doneCount}/${jobDetails.length}]`;

          if (doneCount === jobDetails.length) break;

          // Show detailed progress at configurable intervals
          const now = Date.now();
          if (now - lastProgressTime >= progressIntervalMs) {
            lastProgressTime = now;
            const elapsed = Math.round((now - pollStartTime) / 1000);
            pollSpinner.stop();
            console.log(chalk.dim(`[${elapsed}s] ${doneCount}/${jobDetails.length} jobs done:`));
            for (const { jobId, ruleset } of jobDetails) {
              const status = jobStatuses.get(jobId) ?? 'queued';
              const isDone = TERMINAL_STATUSES.has(status);
              const icon = isDone ? chalk.green('✓') : chalk.yellow('⋯');
              console.log(`  ${icon} ${chalk.cyan(ruleset)} ${chalk.dim(`(${status})`)}`);
            }
            pollSpinner.start(`Waiting for all jobs to complete... [${doneCount}/${jobDetails.length}]`);
          }

          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        pollSpinner.succeed('All analyses complete');

        // Warn about any jobs that completed with errors (rule execution failures)
        for (const { jobId, ruleset } of jobDetails) {
          if (jobStatuses.get(jobId) === 'completed_with_errors') {
            console.warn(chalk.yellow(`  ⚠️  ${ruleset}: some rules failed to execute (see server logs for details)`));
          }
        }

        // Fetch results and save to history
        const historyManager = new HistoryManager();
        const serverUrl = client.getServerUrl();
        const sessionId = client.getSessionId() || 'unknown';

        for (const { jobId, ruleset } of jobDetails) {
          try {
            const results = await client.getJobResults(jobId);
            const entry = HistoryManager.createEntry(results, resolvedPath);
            await historyManager.addEntry(entry, serverUrl, sessionId);
          } catch (error) {
            // If individual result fetch fails, save minimal entry
            console.warn(chalk.yellow(`Warning: Failed to fetch results for ${ruleset}`));
            await historyManager.addEntry({
              jobId,
              documentId,
              filePath: resolvedPath,
              rulesetName: ruleset,
              rulesetVersion: 'unknown',
              status: 'failed',
              summary: {
                totalIssues: 0,
                errorCount: 0,
                warningCount: 0,
                infoCount: 0,
                hintCount: 0,
              },
            }, serverUrl, sessionId);
          }
        }

        // Show summary of all results
        console.log();
        console.log(chalk.bold('Summary of all rulesets:'));
        let totalErrors = 0;
        let totalWarnings = 0;

        for (const { jobId, ruleset } of jobDetails) {
          try {
            const results = await client.getJobResults(jobId);
            const { errorCount, warningCount } = results.summary;
            totalErrors += errorCount;
            totalWarnings += warningCount;

            const status = errorCount === 0 && warningCount === 0
              ? chalk.green('✓ No issues')
              : `${chalk.red(`${errorCount}E`)} ${chalk.yellow(`${warningCount}W`)}`;

            console.log(`  ${chalk.cyan(ruleset)}: ${status}`);
          } catch (error) {
            console.log(`  ${chalk.cyan(ruleset)}: ${chalk.red('Failed')}`);
          }
        }

        console.log();
        console.log(chalk.bold(`Total: ${chalk.red(`${totalErrors} errors`)}, ${chalk.yellow(`${totalWarnings} warnings`)}`));

        // Exit with appropriate code if any errors found
        if (totalErrors > 0) {
          exitCode = 1;
        }
      } catch (error) {
        pollSpinner.fail('Analysis failed');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));

        // Still try to save history entries even if polling failed
        try {
          const historyManager = new HistoryManager();
          const serverUrl = client.getServerUrl();
          const sessionId = client.getSessionId() || 'unknown';

          for (const { jobId, ruleset } of jobDetails) {
            const status = await client.getJobStatus(jobId);
            await historyManager.addEntry({
              jobId,
              documentId,
              filePath: resolvedPath,
              rulesetName: ruleset,
              rulesetVersion: 'unknown',
              status: status.status === 'completed' ? 'completed' : 'failed',
              summary: {
                totalIssues: 0,
                errorCount: 0,
                warningCount: 0,
                infoCount: 0,
                hintCount: 0,
              },
            }, serverUrl, sessionId);
          }
        } catch (historyError) {
          // Non-fatal: continue even if history save fails
          console.warn(chalk.yellow('Warning: Failed to save to history'));
        }

        exitCode = 1;
      }
    }
  } catch (error) {
    console.error(chalk.red('Unexpected error:'), error);
    exitCode = 1;
  } finally {
    // Shutdown embedded server if we started it
    if (shutdownServer) {
      await shutdownServer();
    }

    // Exit with tracked code
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }
}
