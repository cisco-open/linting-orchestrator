/**
 * Help command - Show help for a specific command
 */

import { Command } from 'commander';

export function helpCommand(program: Command, commandName?: string): void {
  if (!commandName) {
    // No command specified, show root help
    program.help();
    return;
  }

  // Find the command
  const command = program.commands.find(cmd => cmd.name() === commandName);
  
  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    console.log(`\nRun 'spectify --help' to see available commands.`);
    process.exit(1);
  }

  // Display help for the command
  command.help();
}
