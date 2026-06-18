/**
 * Start Command - Launch orchestrator server
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { getConfigManager, SpectifyMode } from '../config-manager.js';
import { isPortAvailable, findAvailablePort } from '../utils/port-checker.js';
import { startServer } from '../../server.js';
import { createEmbeddedModeConfig, createStandaloneModeConfig, createCompanionModeConfig } from '../../config.js';
import type { OrchestratorConfig } from '../../types.js';

export interface StartOptions {
  mode?: SpectifyMode;
  config?: string;
  port?: number;
  host?: string;
  documentStore?: string;
  dev?: boolean;
  interactive?: boolean;
  daemon?: boolean;
}

export async function startCommand(options: StartOptions = {}): Promise<void> {
  const configManager = getConfigManager();
  const config = await configManager.get();

  console.log(chalk.bold.blue('\n🚀 Linting Orchestrator — Quality Assurance for API specifications\n'));

  // Determine mode (embedded, standalone, or companion)
  const mode = options.mode || config.defaultMode || 'embedded';
  let targetPort = options.port || config.ports[mode] || 3003;

  console.log(chalk.cyan('Mode:'), mode);
  console.log(chalk.cyan('Configured Port:'), targetPort);

  // Check if port is available
  const portAvailable = await isPortAvailable(targetPort);

  if (!portAvailable) {
    console.log(chalk.yellow(`\n⚠️  Port ${targetPort} is already in use\n`));

    // Find next available port
    const suggestedPort = await findAvailablePort(targetPort + 1);
    
    if (options.interactive !== false) {
      // Interactive mode
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            {
              name: `Use different port (suggested: ${suggestedPort || 'scan...'})`,
              value: 'different',
            },
            {
              name: 'Cancel',
              value: 'cancel',
            },
          ],
        },
      ]);

      if (action === 'cancel') {
        console.log(chalk.dim('Cancelled'));
        process.exit(0);
      }

      // Ask for port
      const { newPort } = await inquirer.prompt([
        {
          type: 'number',
          name: 'newPort',
          message: 'Enter port number:',
          default: suggestedPort || targetPort + 1,
          validate: async (input: number) => {
            const num = parseInt(String(input), 10);
            if (isNaN(num) || num < 1 || num > 65535) {
              return 'Port must be between 1 and 65535';
            }
            const available = await isPortAvailable(num);
            if (!available) {
              return `Port ${num} is also in use`;
            }
            return true;
          },
        },
      ]);

      targetPort = newPort;

      // Ask if config should be updated
      const { updateConfig } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'updateConfig',
          message: `Update default ${mode} port to ${targetPort}?`,
          default: false,
        },
      ]);

      if (updateConfig) {
        await configManager.setPort(mode, targetPort);
        console.log(chalk.green(`✅ Configuration updated\n`));
      }
    } else {
      // Non-interactive: fail with suggestion
      console.error(chalk.red(`Error: Port ${targetPort} is already in use`));
      console.log(chalk.yellow(`\nSuggestion: Use a different port:`));
      console.log(chalk.dim(`   spectify start --mode ${mode} --port ${suggestedPort || targetPort + 1}\n`));
      process.exit(1);
    }
  }

  // Update last used
  await configManager.setLastUsed(mode, targetPort);

  // Build configuration based on mode
  let serverConfig: OrchestratorConfig;
  
  if (mode === 'embedded') {
    serverConfig = createEmbeddedModeConfig();
  } else if (mode === 'companion') {
    serverConfig = createCompanionModeConfig();
  } else {
    serverConfig = createStandaloneModeConfig();
  }
  
  // Apply CLI option overrides
  serverConfig.server = {
    port: targetPort,
    host: options.host || '0.0.0.0',
    maxDocumentSizeMB: serverConfig.server.maxDocumentSizeMB  // Preserve config value
  };
  
  if (options.documentStore && serverConfig.documentStore) {
    serverConfig.documentStore = {
      ...serverConfig.documentStore,
      baseDir: options.documentStore,
      type: serverConfig.documentStore.type // Preserve type
    };
  }
  
  // Display configuration
  console.log(chalk.dim(`\n   Port: ${targetPort}`));
  console.log(chalk.dim(`   Host: ${serverConfig.server.host}`));
  console.log(chalk.dim(`   Document Store: ${serverConfig.documentStore?.baseDir}`));
  if (options.config) {
    console.log(chalk.dim(`   Config: ${options.config}`));
  }
  console.log();
  
  // Start the server (embedded in-process)
  const spinner = ora('Starting the Orchestrator service...').start();
  
  try {
    // Import and start server directly (no spawning!)
    const instance = await startServer(serverConfig);
    
    spinner.succeed('Server started successfully!');
    
    // Register the process for tracking
    await configManager.registerProcess(mode, process.pid, targetPort);
    
    // Display quick start info
    console.log(chalk.bold('\n✨ Quick Start:\n'));
    
    console.log(chalk.yellow('   Check health:'));
    console.log(chalk.gray(`      curl http://localhost:${targetPort}/health | jq\n`));
    
    console.log(chalk.yellow('   List available rulesets:'));
    console.log(chalk.gray(`      curl http://localhost:${targetPort}/rulesets | jq\n`));
    
    console.log(chalk.yellow('   Lint a document:'));
    console.log(chalk.gray(`      spectify lint openapi.yaml\n`));
    
    console.log(chalk.gray('   Press Ctrl+C to stop the server\n'));
    
    // Setup graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(chalk.yellow(`\n\nReceived ${signal}, shutting down...`));
      
      try {
        // Unregister process before shutdown
        await configManager.unregisterProcess(mode);
        await instance.shutdown();
        console.log(chalk.green('✅ Server stopped'));
        process.exit(0);
      } catch (error) {
        console.error(chalk.red('Error during shutdown:'), error);
        process.exit(1);
      }
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
  } catch (error) {
    spinner.fail('Failed to start server');
    console.error(chalk.red('\nError:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

