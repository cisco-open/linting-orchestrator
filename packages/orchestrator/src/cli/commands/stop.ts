/**
 * Stop Command - Stop running orchestrator processes
 */

import chalk from 'chalk';
import { getConfigManager, SpectifyMode } from '../config-manager.js';

export interface StopOptions {
  mode?: SpectifyMode;
  port?: number;
  all?: boolean;
}

export async function stopCommand(options: StopOptions = {}): Promise<void> {
  const configManager = getConfigManager();

  try {
    if (options.all) {
      // Stop all running processes
      const processes = await configManager.getAllProcesses();
      
      if (processes.length === 0) {
        console.log(chalk.yellow('No orchestrator processes running'));
        return;
      }

      console.log(chalk.bold(`\n🛑 Stopping ${processes.length} orchestrator process(es)...\n`));

      for (const proc of processes) {
        try {
          process.kill(proc.pid, 'SIGTERM');
          await configManager.unregisterProcess(proc.mode);
          console.log(chalk.green(`✅ Stopped ${proc.mode} (PID ${proc.pid}, port ${proc.port})`));
        } catch (error) {
          console.log(chalk.red(`❌ Failed to stop ${proc.mode} (PID ${proc.pid}): ${error instanceof Error ? error.message : String(error)}`));
        }
      }

      console.log();
      return;
    }

    if (options.port) {
      // Stop by port
      const proc = await configManager.getProcessByPort(options.port);
      
      if (!proc) {
        console.log(chalk.yellow(`No orchestrator process found running on port ${options.port}`));
        process.exit(1);
      }

      console.log(chalk.bold(`\n🛑 Stopping orchestrator on port ${options.port}...\n`));

      try {
        process.kill(proc.pid, 'SIGTERM');
        await configManager.unregisterProcess(proc.mode);
        console.log(chalk.green(`✅ Stopped ${proc.mode} (PID ${proc.pid})`));
      } catch (error) {
        console.log(chalk.red(`❌ Failed to stop process: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }

      console.log();
      return;
    }

    // Stop by mode (default)
    const config = await configManager.get();
    const targetMode = options.mode || config.defaultMode;
    const proc = await configManager.getProcess(targetMode);

    if (!proc) {
      console.log(chalk.yellow(`No orchestrator process running in ${targetMode} mode`));
      console.log(chalk.dim(`\n   Configured port: ${config.ports[targetMode]}`));
      console.log(chalk.dim('   Check running processes: spectify ps\n'));
      process.exit(1);
    }

    console.log(chalk.bold(`\n🛑 Stopping orchestrator (${targetMode} mode)...\n`));

    try {
      process.kill(proc.pid, 'SIGTERM');
      await configManager.unregisterProcess(targetMode);
      console.log(chalk.green(`✅ Stopped successfully`));
      console.log(chalk.dim(`   PID: ${proc.pid}`));
      console.log(chalk.dim(`   Port: ${proc.port}\n`));
    } catch (error) {
      console.log(chalk.red(`❌ Failed to stop process: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }

  } catch (error) {
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
