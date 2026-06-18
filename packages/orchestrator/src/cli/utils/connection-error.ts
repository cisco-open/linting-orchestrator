/**
 * Shared connection error handling for CLI commands
 */

import chalk from 'chalk';
import { ConnectionError } from '../api-client.js';
import { getConfigManager } from '../config-manager.js';

/**
 * Handle any CLI command error: prints the health-style message for connection
 * errors, a plain error message for everything else, then exits with code 1.
 */
export async function handleCommandError(error: unknown): Promise<never> {
    if (error instanceof ConnectionError) {
        const configManager = getConfigManager();
        const config = await configManager.get();
        const mode = config.defaultMode;
        const port = config.ports[mode];

        console.log(chalk.red('⚠️  Orchestrator service is not running\n'));
        console.log(chalk.dim(`   Mode: ${mode}`));
        console.log(chalk.dim(`   Port: ${port}`));
        console.log(chalk.dim(`   URL: http://localhost:${port}\n`));
        console.log(chalk.yellow('To start the orchestrator service:\n'));
        console.log(chalk.bold(`   spectifyd\n`));
    } else {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red('Error:'), msg);
    }
    process.exit(1);
}
