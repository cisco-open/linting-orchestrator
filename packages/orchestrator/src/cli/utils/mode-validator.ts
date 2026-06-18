/**
 * Mode-specific command validation
 * 
 * Ensures commands are only used in appropriate modes
 */

import chalk from 'chalk';
import { getConfigManager } from '../config-manager.js';

/**
 * Check if command is allowed in current mode
 * Exits with helpful error message if not allowed
 * 
 * @param commandName Name of the command being run
 */
export async function requireServerMode(commandName: string): Promise<void> {
  const configManager = getConfigManager();
  const config = await configManager.get();
  
  if (config.defaultMode === 'embedded') {
    console.error(chalk.red(`\n❌ Command '${commandName}' is not available in embedded mode\n`));
    console.log('Embedded mode is for quick, self-contained linting without server management.');
    console.log('This command is only available in standalone or companion modes.\n');
    console.log(chalk.cyan('Available commands in embedded mode:'));
    console.log('  • spectify lint <file>       - Lint an OpenAPI document');
    console.log('  • spectify health            - Check service health (embedded server)');
    console.log('  • spectify rulesets          - List available rulesets');
    console.log('  • spectify config            - Manage CLI configuration\n');
    console.log(chalk.cyan('To use this command, switch to standalone mode:'));
    console.log(`  spectify config set mode standalone\n`);
    process.exit(1);
  }
}
