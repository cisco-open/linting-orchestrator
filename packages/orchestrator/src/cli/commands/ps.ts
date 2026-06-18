/**
 * PS Command - List running orchestrator processes
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { getConfigManager } from '../config-manager.js';

export interface PsOptions {
  format?: 'table' | 'json';
}

export async function psCommand(options: PsOptions = {}): Promise<void> {
  const configManager = getConfigManager();

  try {
    const processes = await configManager.getAllProcesses();

    if (options.format === 'json') {
      console.log(JSON.stringify(processes, null, 2));
      return;
    }

    // Table format
    if (processes.length === 0) {
      console.log(chalk.yellow('\n📋 No orchestrator processes running\n'));
      console.log(chalk.dim('   Start a process: spectify start --daemon\n'));
      return;
    }

    console.log(chalk.bold('\n📋 Running orchestrator processes\n'));

    const table = new Table({
      head: ['Mode', 'PID', 'Port', 'Started', 'Uptime'],
      style: {
        head: ['cyan'],
      },
    });

    for (const proc of processes) {
      const uptime = formatUptime(Date.now() - new Date(proc.startedAt).getTime());
      const startedAt = new Date(proc.startedAt).toLocaleString();

      table.push([
        proc.mode,
        proc.pid.toString(),
        proc.port.toString(),
        startedAt,
        uptime,
      ]);
    }

    console.log(table.toString());
    console.log();

    // Show helpful commands
    console.log(chalk.dim('Commands:'));
    console.log(chalk.dim('   spectify stop --mode <mode>     Stop by mode'));
    console.log(chalk.dim('   spectify stop --port <port>     Stop by port'));
    console.log(chalk.dim('   spectify stop --all             Stop all'));
    console.log();

  } catch (error) {
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
