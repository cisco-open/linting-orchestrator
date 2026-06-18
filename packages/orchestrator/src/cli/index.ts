#!/usr/bin/env node

/**
 * Orchestrator CLI - Command-line interface for linting documents, managing rulesets, and controlling the orchestrator server
 * 
 * Usage:
 *   spectify start [--mode standalone|mcp] [options]
 *   spectify lint <file> [options]
 *   spectify status <jobId> [options]
 *   spectify results <jobId> [options]
 *   spectify history [options]
 *   spectify rulesets [options]
 *   spectify health [options]
 *   spectify config [show|set|reset]
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { CLI_VERSION } from '../utils/version.js';
import { getConfigManager } from './config-manager.js';
import { lintCommand } from './commands/lint.js';
import { statusCommand } from './commands/status.js';
import { resultsCommand } from './commands/results.js';
import { reproduceCommand } from './commands/reproduce.js';
import { historyCommand } from './commands/history.js';
import { jobsCommand } from './commands/jobs.js';
import { viewRulesetsCommand, checkRulesetsCommand } from './commands/rulesets/index.js';
import { healthCommand } from './commands/health.js';
import { configCommand } from './commands/config.js';
import { completionCommand } from './commands/completion.js';
import { agentsCommand } from './commands/agents.js';
import { resetCommand } from './commands/reset.js';
import { helpCommand } from './commands/help.js';
import { handleCommandError } from './utils/connection-error.js';

// Configure chalk to disable colors when piping to prevent terminal corruption
// This fixes issues when piping to 'more', 'less', etc. and interrupting
if (!process.stdout.isTTY) {
  chalk.level = 0;
}

const program = new Command();

program
  .name('spectify')
  .description('Linting Orchestrator — Quality Assurance for API specifications')
  .helpOption('-h, --help', 'display help for command')
  .option('-a, --agents', 'Show LLM-friendly documentation (for AI agents)')
  .option('-V, --version', 'output the version number')
  .usage('[options] [command]')
  .enablePositionalOptions();

// Custom version display showing CLI version only
// Use 'spectify health' to see the running server version
program.on('option:version', () => {
  console.log(`spectify CLI v${CLI_VERSION}`);
  console.log(chalk.dim('Use "spectify health" to see server version'));
  process.exit(0);
});

// Configure help
program.configureHelp({
  sortSubcommands: false,
  showGlobalOptions: false,
});

// Check if showing root help before parsing
const showingRootHelp = (process.argv.length === 2) ||
  (process.argv.length === 3 && (process.argv[2] === '--help' || process.argv[2] === '-h'));

if (showingRootHelp) {
  // Show custom grouped help for root command
  console.log(`Usage: spectify [options] [command]`);
  console.log('');
  console.log('Linting Orchestrator — Quality Assurance for API specifications');
  console.log('');
  console.log('Options:');
  console.log('  -V, --version                  output the version number');
  console.log('  -a, --agents                   Show LLM-friendly documentation (for AI agents)');
  console.log('  -h, --help                     display help for command');
  console.log('');
  console.log(chalk.cyan('Linting Commands:'));
  console.log('    lint           Lint a document');
  console.log('    status         Check the status of a lint job');
  console.log('    results        View detailed lint results');
  console.log('    reproduce      Generate Spectral CLI reproduction instructions');
  console.log('    jobs           List recent lint jobs');
  console.log('    history        View lint history');
  console.log('    rulesets       List, view, or check rulesets (view | check)');
  console.log('');
  console.log(chalk.cyan('Configuration Commands:'));
  console.log('    config         Manage CLI configuration (show, set, reset)');
  console.log('    completion     Generate shell completion script');
  console.log('    health         Check orchestrator service health');
  console.log('');
  console.log(chalk.dim('Default mode: embedded (server auto-starts with lint commands)'));
  console.log(chalk.dim('For production server: spectifyd --help'));
  console.log('');
  process.exit(0);
}

// ============================================================================
// LINTING COMMANDS
// ============================================================================

// Lint command
program
  .command('lint <file>')
  .description('Lint a document using one or multiple rulesets')
  .option('-r, --ruleset <name>', 'Ruleset(s) to use (comma-separated). Defaults to all available rulesets.')
  .option('-v, --version <version>', 'Ruleset version (applies to all rulesets if multiple specified)')
  .option('--override <override>', 'Override rule severities. Repeatable. E.g. --override rule1=off --override rule2=warn or --override rule1=off,rule2=warn', (val: string, prev: string[]) => prev.concat(val), [] as string[])
  .option('--no-cache', 'Disable cache lookup')
  .option('--show-all', 'Show all issues (no limit)')
  .option('--poll-interval <seconds>', 'Progress display interval in seconds for multi-ruleset runs (default: 5)', parseFloat)
  .action(async (file, options) => {
    try {
      // Don't pre-fill apiUrl - let lintCommand handle embedded mode detection
      await lintCommand(file, options);
    } catch (error) {
      await handleCommandError(error);
    }
  });

// Status command
program
  .command('status <jobId>')
  .description('Check the status of a lint job')
  .option('-w, --watch', 'Watch job status until completion')
  .action(async (jobId, options) => {
    try {
      const { requireServerMode } = await import('./utils/mode-validator.js');
      await requireServerMode('status'); const configManager = getConfigManager();
      const apiUrl = await configManager.getApiUrl();

      await statusCommand(jobId, {
        ...options,
        apiUrl,
      });
    } catch (error) {
      await handleCommandError(error);
    }
  });

// Results command
program
  .command('results <jobId>')
  .description('View detailed lint results')
  .option('--rule <ruleId>', 'Filter by rule ID')
  .option('--severity <level>', 'Filter by severity (error, warning, info, hint)')
  .option('--format <format>', 'Output format (table, json, sarif)', 'table')
  .option('--output <path>', 'Save report to file (SARIF format)')
  .option('--json', 'Output raw JSON response')
  .action(async (jobId, options) => {
    try {
      const { requireServerMode } = await import('./utils/mode-validator.js');
      await requireServerMode('results');
      const configManager = getConfigManager();
      const apiUrl = await configManager.getApiUrl();

      await resultsCommand(jobId, {
        ...options,
        apiUrl,
      });
    } catch (error) {
      await handleCommandError(error);
    }
  });

// Reproduce command
program
  .command('reproduce <jobId>')
  .description('Generate Spectral CLI reproduction instructions for a lint job')
  .option('-o, --output <path>', 'Save instructions to file')
  .action(async (jobId, options) => {
    try {
      const { requireServerMode } = await import('./utils/mode-validator.js');
      await requireServerMode('reproduce');
      const configManager = getConfigManager();
      const apiUrl = await configManager.getApiUrl();

      await reproduceCommand(jobId, {
        ...options,
        apiUrl,
      });
    } catch (error) {
      await handleCommandError(error);
    }
  });

// History command
program
  .command('history')
  .description('View lint history')
  .option('-l, --limit <number>', 'Number of entries to show', '10')
  .option('-f, --file <path>', 'Filter by file path')
  .option('--ruleset <name>', 'Filter by ruleset name')
  .option('--clear', 'Clear history')
  .action(async (options) => {
    try {
      await historyCommand({
        ...options,
        limit: parseInt(options.limit),
      });
    } catch (error) {
      await handleCommandError(error);
    }
  });

// Jobs command
program
  .command('jobs')
  .description('List recent lint jobs (requires standalone or companion mode)')
  .option('--status <status>', 'Filter by job status (completed, failed, running, timeout)')
  .option('--ruleset <name>', 'Filter by ruleset name')
  .option('-l, --limit <number>', 'Number of jobs to show (default: 20)')
  .option('--detailed', 'Show with document metadata (slower)')
  .option('--json', 'Output raw JSON response')
  .action(async (options) => {
    try {
      await jobsCommand({
        ...options,
        limit: options.limit ? parseInt(options.limit) : undefined,
      });
    } catch (error) {
      await handleCommandError(error);
    }
  });

// Rulesets command — parent with two subcommands:
//   spectify rulesets view  [--name N] [--version V] [--format table|json]
//   spectify rulesets check [--name N] [--version V] [--format text|json]
//                           [--rulesets-directory PATH]
// Bare `spectify rulesets` is an alias for `view` for backward compatibility.
const rulesetsCmd = program
  .command('rulesets')
  .description('List, view, or check rulesets');

rulesetsCmd
  .command('view', { isDefault: true })
  .description('List rulesets or show details of one (default subcommand)')
  .option('--name <name>', 'Ruleset name to view')
  .option('--version <version>', 'Ruleset version to view (requires --name)')
  .option('--format <format>', 'Output format (table, json)', 'table')
  .action(async (options) => {
    try {
      // Don't pre-fill apiUrl - let viewRulesetsCommand handle embedded mode detection
      await viewRulesetsCommand(options);
    } catch (error) {
      await handleCommandError(error);
    }
  });

rulesetsCmd
  .command('check')
  .description('Verify every configured ruleset version actually loads (in-process, no server)')
  .option('--name <name>', 'Restrict the check to a single ruleset')
  .option('--version <version>', 'Restrict the check to a single version (requires --name)')
  .option('-r, --rulesets-directory <path>', 'Catalogue directory (overrides SPECTIFYD_RULESETS_DIR)')
  .option('--format <format>', 'Output format (text, json)', 'text')
  .action(async (options) => {
    try {
      await checkRulesetsCommand(options);
    } catch (error) {
      await handleCommandError(error);
    }
  });

// Health command
program
  .command('health')
  .description('Check orchestrator service health')
  .option('--format <format>', 'Output format (text, json)', 'text')
  .action(async (options) => {
    try {
      const configManager = getConfigManager();
      const config = await configManager.get();

      // Don't pre-fill apiUrl - let healthCommand handle embedded mode detection
      await healthCommand({
        ...options,
        mode: config.defaultMode,
      });
    } catch (error) {
      await handleCommandError(error);
    }
  });

// ============================================================================
// CONFIGURATION COMMANDS
// ============================================================================

// Config command
program
  .command('config [action] [key] [value]')
  .description('Manage CLI configuration (show, set, reset)')
  .action(async (action, key, value) => {
    try {
      await configCommand({ action, key, value });
    } catch (error) {
      await handleCommandError(error);
    }
  });

// Completion command
program
  .command('completion')
  .description('Generate bash completion script')
  .allowUnknownOption() // Accept --shell for backward compatibility without documenting it
  .action(async (options) => {
    try {
      await completionCommand(options);
    } catch (error) {
      await handleCommandError(error);
    }
  });

// ============================================================================
// UTILITY COMMANDS
// ============================================================================

// Help command (alternative: spectify help <command>)
program
  .command('help [command]')
  .description('Display help for a command')
  .action((commandName) => {
    helpCommand(program, commandName);
  });

// Reset command (hidden from help)
program
  .command('reset', { hidden: true })
  .description('Reset terminal colors and formatting')
  .action(async () => {
    try {
      await resetCommand();
    } catch (error) {
      await handleCommandError(error);
    }
  });

// Check for --agents or -a flag BEFORE parsing (direct argv check)
if (process.argv.includes('--agents') || process.argv.includes('-a')) {
  agentsCommand();
  process.exit(0);
}

// Parse arguments
program.parse(process.argv);

// Show help if no command specified
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
