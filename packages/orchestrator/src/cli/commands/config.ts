/**
 * Config command - Manage orchestrator CLI configuration
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { getConfigManager, SpectifyMode } from '../config-manager.js';
import { HistoryManager } from '../history-manager.js';

export interface ConfigOptions {
  action?: 'show' | 'set' | 'reset';
  key?: string;
  value?: string;
}

export async function configCommand(options: ConfigOptions = {}): Promise<void> {
  // If no action specified, show interactive menu
  if (!options.action) {
    await showInteractiveConfig();
    return;
  }

  switch (options.action) {
    case 'show':
      await showConfig();
      break;
    case 'set':
      if (!options.key || !options.value) {
        console.error(chalk.red('Error: Both key and value are required for set'));
        console.log(chalk.dim('Usage: spectify config set <key> <value>'));
        console.log(chalk.dim('Keys: mode, port.standalone, port.companion, url'));
        process.exit(1);
      }
      await setConfig(options.key, options.value);
      break;
    case 'reset':
      await resetConfig();
      break;
    default:
      console.error(chalk.red(`Unknown action: ${options.action}`));
      process.exit(1);
  }
}

async function showConfig(): Promise<void> {
  const configManager = getConfigManager();
  const config = await configManager.get();

  console.log(chalk.bold('\n📝 Current CLI Configuration\n'));
  console.log(chalk.cyan('Current Mode:'), chalk.bold(config.defaultMode));
  
  console.log(chalk.cyan('\nConfigured Ports:'));
  console.log(`   Standalone: ${chalk.bold(config.ports.standalone)}`);
  console.log(`   Embedded:   ${chalk.bold(config.ports.embedded)}`);
  console.log(`   Companion:  ${chalk.bold(config.ports.companion)}`);

  if (process.env.SPECTIFYD_URL) {
    console.log(chalk.cyan('\nURL Override (env):'), chalk.bold(process.env.SPECTIFYD_URL));
    console.log(chalk.dim('   Set via SPECTIFYD_URL — takes precedence over config'));
  } else if (config.url) {
    console.log(chalk.cyan('\nURL Override:'), chalk.bold(config.url));
    console.log(chalk.dim('   Overrides localhost:<port> for standalone/companion modes'));
    console.log(chalk.dim('   Clear with: spectify config set url ""'));
  } else {
    const configManager = getConfigManager();
    const effectiveUrl = await configManager.getApiUrl();
    console.log(chalk.cyan('\nEffective URL:'), chalk.dim(effectiveUrl));
  }

  if (config.lastUsed) {
    console.log(chalk.cyan('\nLast Used Session:'));
    console.log(chalk.dim(`   Mode: ${config.lastUsed.mode}`));
    console.log(chalk.dim(`   Port: ${config.lastUsed.port}`));
  }

  console.log(chalk.dim(`\nConfig file: ${configManager.getConfigPath()}`));
  console.log(chalk.dim('Use "spectify config set <key> <value>" to change settings'));
  console.log(chalk.dim('Keys: mode, port.standalone, port.companion, url'));
  console.log();
}

async function setConfig(key: string, value: string): Promise<void> {
  const configManager = getConfigManager();

  try {
    switch (key) {
      case 'mode':
        if (value !== 'standalone' && value !== 'embedded' && value !== 'companion') {
          throw new Error('Mode must be "standalone", "embedded", or "companion"');
        }
        await configManager.setDefaultMode(value as SpectifyMode);
        console.log(chalk.green(`✅ Current mode set to: ${value}`));
        break;

      case 'port.standalone': {
        const standalonePort = parseInt(value, 10);
        if (isNaN(standalonePort) || standalonePort < 1 || standalonePort > 65535) {
          throw new Error('Port must be a number between 1 and 65535');
        }
        await configManager.setPort('standalone', standalonePort);
        console.log(chalk.green(`✅ Standalone port set to: ${standalonePort}`));
        // Notify history using the effective URL (respects config.url override)
        const historyManager = new HistoryManager();
        await historyManager.onConfigChange(await configManager.getApiUrl('standalone'));
        break;
      }

      case 'port.companion': {
        const companionPort = parseInt(value, 10);
        if (isNaN(companionPort) || companionPort < 1 || companionPort > 65535) {
          throw new Error('Port must be a number between 1 and 65535');
        }
        await configManager.setPort('companion', companionPort);
        console.log(chalk.green(`✅ Companion port set to: ${companionPort}`));
        // Notify history using the effective URL (respects config.url override)
        const historyManagerCompanion = new HistoryManager();
        await historyManagerCompanion.onConfigChange(await configManager.getApiUrl('companion'));
        break;
      }

      case 'url': {
        const trimmed = value.trim();
        if (trimmed === '') {
          await configManager.setUrl(undefined);
          console.log(chalk.green('✅ URL override cleared — using http://localhost:<port>'));
        } else {
          try {
            new URL(trimmed);
          } catch {
            throw new Error('Value must be a valid URL (e.g. http://192.168.1.10:3003)');
          }
          await configManager.setUrl(trimmed);
          console.log(chalk.green(`✅ URL override set to: ${trimmed}`));
          const historyManager = new HistoryManager();
          await historyManager.onConfigChange(trimmed);
        }
        break;
      }

      default:
        throw new Error(`Unknown config key: ${key}`);
    }
  } catch (error) {
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function resetConfig(): Promise<void> {
  const configManager = getConfigManager();

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Reset configuration to defaults?',
      default: false,
    },
  ]);

  if (confirm) {
    await configManager.reset();
    console.log(chalk.green('✅ Configuration reset to defaults'));
    await showConfig();
  } else {
    console.log(chalk.dim('Cancelled'));
  }
}

async function showInteractiveConfig(): Promise<void> {
  const configManager = getConfigManager();
  const config = await configManager.get();

  // Show current config
  await showConfig();

  // Interactive menu
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Change current mode', value: 'mode' },
        { name: 'Change standalone port', value: 'port.standalone' },
        { name: 'Change companion port', value: 'port.companion' },
        { name: 'Set URL override (remote spectifyd)', value: 'url' },
        { name: 'Reset to defaults', value: 'reset' },
        { name: 'Exit', value: 'exit' },
      ],
    },
  ]);

  if (action === 'exit') {
    return;
  }

  if (action === 'reset') {
    await resetConfig();
    return;
  }

  if (action === 'mode') {
    const { mode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: 'Select current mode:',
        choices: [
          { name: 'Standalone (independent orchestrator server)', value: 'standalone' },
          { name: 'Embedded (CLI with embedded server)', value: 'embedded' },
          { name: 'Companion (companion to MCP OpenAPI Analyzer)', value: 'companion' },
        ],
        default: config.defaultMode,
      },
    ]);
    await configManager.setDefaultMode(mode);
    console.log(chalk.green(`\n✅ Current mode set to: ${mode}\n`));
  } else if (action === 'port.standalone') {
    const { port } = await inquirer.prompt([
      {
        type: 'number',
        name: 'port',
        message: 'Enter standalone port:',
        default: config.ports.standalone,
        validate: (input: number) => {
          const num = parseInt(String(input), 10);
          if (isNaN(num) || num < 1 || num > 65535) {
            return 'Port must be between 1 and 65535';
          }
          return true;
        },
      },
    ]);
    await configManager.setPort('standalone', port);
    console.log(chalk.green(`\n✅ Standalone port set to: ${port}\n`));
    const historyManager = new HistoryManager();
    await historyManager.onConfigChange(await configManager.getApiUrl('standalone'));
  } else if (action === 'port.companion') {
    const { port } = await inquirer.prompt([
      {
        type: 'number',
        name: 'port',
        message: 'Enter Companion port:',
        default: config.ports.companion,
        validate: (input: number) => {
          const num = parseInt(String(input), 10);
          if (isNaN(num) || num < 1 || num > 65535) {
            return 'Port must be between 1 and 65535';
          }
          return true;
        },
      },
    ]);
    await configManager.setPort('companion', port);
    console.log(chalk.green(`\n✅ Companion port set to: ${port}\n`));
    const historyManagerCompanion = new HistoryManager();
    await historyManagerCompanion.onConfigChange(await configManager.getApiUrl('companion'));
  } else if (action === 'url') {
    const { urlValue } = await inquirer.prompt([
      {
        type: 'input',
        name: 'urlValue',
        message: 'Enter URL override (empty to clear):',
        default: config.url || '',
        validate: (input: string) => {
          const trimmed = input.trim();
          if (trimmed === '') return true;
          try {
            new URL(trimmed);
            return true;
          } catch {
            return 'Must be a valid URL (e.g. http://192.168.1.10:3003)';
          }
        },
      },
    ]);
    const trimmed = urlValue.trim();
    if (trimmed === '') {
      await configManager.setUrl(undefined);
      console.log(chalk.green('\n✅ URL override cleared — using http://localhost:<port>\n'));
    } else {
      await configManager.setUrl(trimmed);
      console.log(chalk.green(`\n✅ URL override set to: ${trimmed}\n`));
      const historyManager = new HistoryManager();
      await historyManager.onConfigChange(trimmed);
    }
  }

  // Ask if they want to continue
  const { another } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'another',
      message: 'Make another change?',
      default: false,
    },
  ]);

  if (another) {
    await showInteractiveConfig();
  }
}
