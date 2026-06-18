/**
 * Reset command - Reset terminal colors and formatting
 */

export async function resetCommand(): Promise<void> {
  // Output ANSI reset sequence to clear all formatting
  process.stdout.write('\x1b[0m\n');
  
  console.log('Terminal colors reset.');
  console.log('\nAlternatively, you can use these standard commands:');
  console.log('  reset          - Full terminal reset');
  console.log('  tput reset     - Reset terminal using terminfo');
  console.log('  stty sane      - Reset terminal settings');
}
