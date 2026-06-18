#!/usr/bin/env node

// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Orchestrator server CLI
 * 
 * Primary entrypoint for running orchestrator as a server.
 * Supports two modes:
 * - standalone: Independent server with own document store (~/.spectify/uploads)
 * - companion: Integrates with MCP, requires --document-store path
 * 
 * Used when running:
 * - `npm start`
 * - `node build/index.js`
 * - `spectifyd` (global binary)
 * 
 * @module index
 */

import { Command } from 'commander';
import { startServer } from './server.js';
import { API_VERSION } from './utils/version.js';
import { createStandaloneModeConfig, createCompanionModeConfig, spectifyHome } from './config.js';
import type { OrchestratorConfig } from './types.js';
import * as path from 'path';
import chalk from 'chalk';

const program = new Command();

program
  .name('spectifyd')
  .description('Linting orchestrator daemon (spectifyd)')
  .option('-p, --port <port>', 'server port (local: 3003, passthrough: 3004)', (val) => parseInt(val, 10))
  .option('-H, --host <host>', 'server host', '0.0.0.0')
  .option('-d, --store-directory <path>', 'directory where documents are stored')
  .option('-t, --store-type <type>', 'document store type: local or passthrough', 'local')
  .option('-r, --rulesets-directory <path>', 'directory containing rulesets (or set SPECTIFYD_RULESETS_DIR)')
  .option('--max-workers <count>', 'maximum total workers', (val) => parseInt(val, 10))
  .option('--log-level <level>', 'log level: error, warn, info, debug, trace', 'info')
  .version(API_VERSION, '-V, --version', 'output the API server version')
  .helpOption('-h, --help', 'display help for command')
  .addHelpText('after', `
Examples:
  ${chalk.cyan('Standalone')} (local document storage, default):
    $ spectifyd
    $ spectifyd --store-type local --store-directory $HOME/.spectify/uploads

  ${chalk.cyan('Companion')} (passthrough store of an MCP server):
    $ spectifyd --store-type passthrough --store-directory /path/to/mcp/documents
`);

program.parse(process.argv);

const options = program.opts();

/**
 * Main function - starts server with graceful shutdown
 */
async function main() {
  try {
    // Validate store type
    const storeType = options.storeType as 'local' | 'passthrough';
    if (storeType !== 'local' && storeType !== 'passthrough') {
      console.error(chalk.red(`Error: Invalid store type '${storeType}'. Must be 'local' or 'passthrough'`));
      process.exit(1);
    }

    // Determine port (default based on store type)
    const defaultPort = storeType === 'passthrough' ? 3004 : 3003;
    const port = options.port || parseInt(process.env.SPECTIFYD_PORT || '', 10) || defaultPort;

    // Determine store directory
    let storeDirectory: string;

    if (storeType === 'passthrough') {
      // Passthrough: require explicit directory
      storeDirectory = options.storeDirectory || process.env.SPECTIFYD_DOCUMENT_STORE_DIR || '';

      if (!storeDirectory) {
        console.error(chalk.red('\nError: --store-directory is required for passthrough type'));
        console.log(chalk.yellow('\nPassthrough storage integrates with external systems like MCP.'));
        console.log(chalk.yellow('You must specify the path to the external document directory:\n'));
        console.log(chalk.gray('  spectifyd --store-type passthrough --store-directory /path/to/documents\n'));
        process.exit(1);
      }
    } else {
      // Local: default to $SPECTIFY_HOME/uploads
      const defaultDir = path.join(spectifyHome(), 'uploads');
      storeDirectory = options.storeDirectory || process.env.SPECTIFYD_DOCUMENT_STORE_DIR || defaultDir;
    }

    // Build configuration (use companion/standalone configs for convenience)
    let config: OrchestratorConfig;

    if (storeType === 'passthrough') {
      config = createCompanionModeConfig();
    } else {
      config = createStandaloneModeConfig();
    }

    // Apply CLI overrides
    config.server.port = port;
    config.server.host = options.host || config.server.host;

    if (config.documentStore) {
      config.documentStore.baseDir = storeDirectory;
      config.documentStore.type = storeType;
    }

    const rulesetsDir = options.rulesetsDirectory || process.env.SPECTIFYD_RULESETS_DIR;
    if (rulesetsDir) {
      config.rulesets.directory = rulesetsDir;
    }

    if (options.logLevel) {
      config.logging.level = options.logLevel;
    }

    if (options.maxWorkers) {
      config.workerPool.totalMaxWorkers = options.maxWorkers;
    }

    // Validate Report Service availability (if enabled and required)
    if (config.reportService?.enabled && config.reportService?.stopIfUnavailable) {
      try {
        console.log(chalk.gray('Checking Report Service availability...'));
        const response = await fetch(`${config.reportService.url}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });

        if (!response.ok) {
          throw new Error(`Report Service returned status ${response.status}`);
        }

        console.log(chalk.green('✓ Report Service available'));
      } catch (error) {
        const mode = storeType === 'passthrough' ? 'Companion' : 'Standalone';
        console.error(chalk.red(`\nError: ${mode} mode requires Report Service to be running.`));
        console.error(chalk.yellow('\nReport Service is not available at:'), config.reportService.url);
        console.error(chalk.yellow('\nPlease start the Report Service:'));
        console.error(chalk.gray('  spectifyr'));
        console.error(chalk.yellow('\nOr disable report integration in .env:'));
        console.error(chalk.gray('  SPECTIFYD_REPORTS_ENABLED=false\n'));
        process.exit(1);
      }
    } else if (config.reportService?.enabled && !config.reportService?.stopIfUnavailable) {
      // Light mode: just log warning if unavailable
      try {
        const response = await fetch(`${config.reportService.url}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000) // Shorter timeout for non-critical check
        });

        if (response.ok) {
          console.log(chalk.green('✓ Report Service available'));
        } else {
          console.log(chalk.yellow('⚠ Report Service unavailable - notifications will be queued'));
        }
      } catch {
        console.log(chalk.yellow('⚠ Report Service unavailable - notifications will be queued'));
      }
    }

    // Start server
    const instance = await startServer(config);

    // Setup graceful shutdown handlers
    const shutdownHandler = async (signal: string) => {
      console.log(chalk.yellow(`\n\nReceived ${signal}, shutting down gracefully...`));

      try {
        await instance.shutdown();
        console.log(chalk.green('✅ Server stopped'));
        process.exit(0);
      } catch (error) {
        console.error(chalk.red('Error during shutdown:'), error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdownHandler('SIGINT'));
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));

  } catch (error) {
    console.error(chalk.red('Fatal error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Start the server
main();

