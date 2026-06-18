#!/usr/bin/env node
/**
 * Manual cleanup CLI for the Linting Reports Service
 * 
 * Allows administrators to delete old lint job reports from the database.
 * 
 * Usage:
 *   npm run cleanup -- --days 30              # Delete jobs older than 30 days
 *   npm run cleanup -- --days 90 --dry-run    # Preview what would be deleted
 *   npm run cleanup -- --status failed        # Delete only failed jobs
 *   npm run cleanup -- --help                 # Show help
 */

import { DatabaseAdapter } from '../database.js';
import { JobStatus } from '../types.js';
import { join } from 'path';

interface CleanupOptions {
  days?: number;
  status?: JobStatus;
  dryRun?: boolean;
  interactive?: boolean;
}

class CleanupCLI {
  private database: DatabaseAdapter;

  constructor(dbPath: string) {
    this.database = new DatabaseAdapter(dbPath);
  }

  /**
   * Run cleanup with specified options
   */
  async run(options: CleanupOptions): Promise<void> {
    // Show help if requested or no valid options
    if (options.days === 0 || (!options.days && !options.status)) {
      this.showHelp();
      if (options.days === 0) {
        // Help was explicitly requested
        return;
      }
      console.error('\n❌ Error: Must specify --days or --status');
      process.exit(1);
    }

    console.log('🧹 Linting Reports Cleanup Tool\n');

    // Get current database stats
    const totalJobs = this.database.getTotalJobs();
    const timestamps = this.database.getJobTimestamps();
    const dbSize = this.formatBytes(this.database.getDatabaseSize());

    console.log('📊 Current Database Stats:');
    console.log(`   Total jobs: ${totalJobs}`);
    console.log(`   Oldest job: ${timestamps.oldest || 'N/A'}`);
    console.log(`   Newest job: ${timestamps.newest || 'N/A'}`);
    console.log(`   Database size: ${dbSize}\n`);

    // Calculate what will be deleted
    const jobsToDelete = this.getJobsToDelete(options);

    if (jobsToDelete.length === 0) {
      console.log('✅ No jobs match the cleanup criteria.');
      return;
    }

    console.log(`🗑️  Jobs matching cleanup criteria: ${jobsToDelete.length}\n`);

    // Show sample of jobs to be deleted
    this.showJobsSample(jobsToDelete);

    if (options.dryRun) {
      console.log('\n🔍 DRY RUN MODE - No changes made');
      return;
    }

    // Confirm deletion (if interactive mode)
    if (options.interactive !== false) {
      const confirmed = await this.confirmDeletion(jobsToDelete.length);
      if (!confirmed) {
        console.log('\n❌ Cleanup cancelled');
        return;
      }
    }

    // Perform deletion
    this.deleteJobs(jobsToDelete);

    // Show results
    const newTotal = this.database.getTotalJobs();
    const newDbSize = this.formatBytes(this.database.getDatabaseSize());

    console.log('\n✅ Cleanup complete!');
    console.log(`   Jobs deleted: ${jobsToDelete.length}`);
    console.log(`   Jobs remaining: ${newTotal}`);
    console.log(`   New database size: ${newDbSize}`);
  }

  /**
   * Get list of jobs matching cleanup criteria
   */
  private getJobsToDelete(options: CleanupOptions): Array<{ id: string; completedAt: string; status: string }> {
    let query = 'SELECT id, completed_at as completedAt, status FROM jobs WHERE 1=1';
    const params: unknown[] = [];

    if (options.days) {
      query += ` AND completed_at < datetime('now', '-' || ? || ' days')`;
      params.push(options.days);
    }

    if (options.status) {
      query += ' AND status = ?';
      params.push(options.status);
    }

    query += ' ORDER BY completed_at ASC';

    const stmt = (this.database as any).db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Delete specified jobs
   */
  private deleteJobs(jobs: Array<{ id: string }>): void {
    const stmt = (this.database as any).db.prepare('DELETE FROM jobs WHERE id = ?');

    const deleteTransaction = (this.database as any).db.transaction(() => {
      for (const job of jobs) {
        stmt.run(job.id);
      }
    });

    deleteTransaction();
  }

  /**
   * Show sample of jobs to be deleted
   */
  private showJobsSample(jobs: Array<{ id: string; completedAt: string; status: string }>): void {
    const sampleSize = Math.min(10, jobs.length);
    console.log(`📋 Sample (showing first ${sampleSize} of ${jobs.length}):\n`);

    console.log('   Job ID                                  Status      Completed At');
    console.log('   ' + '-'.repeat(75));

    for (let i = 0; i < sampleSize; i++) {
      const job = jobs[i];
      const statusBadge = this.getStatusBadge(job.status);
      console.log(`   ${job.id.padEnd(39)} ${statusBadge.padEnd(11)} ${job.completedAt}`);
    }

    if (jobs.length > sampleSize) {
      console.log(`   ... and ${jobs.length - sampleSize} more`);
    }
  }

  /**
   * Get colored status badge for terminal output
   */
  private getStatusBadge(status: string): string {
    const badges: Record<string, string> = {
      completed: '✅ DONE',
      failed: '❌ FAIL',
      timeout: '⏱️  TIME',
    };
    return badges[status] || status;
  }

  /**
   * Confirm deletion with user
   */
  private async confirmDeletion(count: number): Promise<boolean> {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(`\n⚠️  Delete ${count} job(s)? This cannot be undone! (yes/no): `, (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes');
      });
    });
  }

  /**
   * Format bytes to human-readable size
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Show help message
   */
  private showHelp(): void {
    console.log(`
Usage: npm run cleanup -- [options]

Options:
  --days <number>       Delete jobs older than N days
  --status <status>     Delete only jobs with specific status (completed|failed|timeout)
  --dry-run             Show what would be deleted without actually deleting
  --yes                 Skip confirmation prompt (non-interactive mode)
  --help                Show this help message

Examples:
  npm run cleanup -- --days 30
    Delete all jobs older than 30 days

  npm run cleanup -- --days 90 --dry-run
    Preview jobs older than 90 days without deleting

  npm run cleanup -- --status failed --days 7
    Delete failed jobs older than 7 days

  npm run cleanup -- --days 365 --yes
    Delete jobs older than 1 year without confirmation

  npm run cleanup -- --status timeout
    Delete all timeout jobs
    `);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.database.close();
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): CleanupOptions {
  const args = process.argv.slice(2);
  const options: CleanupOptions = { interactive: true };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--days':
        options.days = parseInt(args[++i], 10);
        if (isNaN(options.days) || options.days <= 0) {
          console.error('❌ Error: --days must be a positive number');
          process.exit(1);
        }
        break;

      case '--status':
        const status = args[++i] as JobStatus;
        if (!['completed', 'failed', 'timeout'].includes(status)) {
          console.error('❌ Error: --status must be one of: completed, failed, timeout');
          process.exit(1);
        }
        options.status = status;
        break;

      case '--dry-run':
        options.dryRun = true;
        break;

      case '--yes':
        options.interactive = false;
        break;

      case '--help':
      case '-h':
        return { days: 0 }; // Will trigger help display

      default:
        console.error(`❌ Unknown option: ${arg}`);
        process.exit(1);
    }
  }

  return options;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const defaultDbPath = join(process.env.HOME || process.env.USERPROFILE || '~', '.spectify', 'reports', 'database', 'reports.db');
  const dbPath = process.env.SPECTIFYR_DB_PATH || process.env.DATABASE_PATH || defaultDbPath;

  const cleanup = new CleanupCLI(dbPath);

  try {
    await cleanup.run(options);
  } catch (error) {
    console.error('\n❌ Error during cleanup:', error);
    process.exit(1);
  } finally {
    cleanup.close();
  }
}

// Run CLI if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { CleanupCLI, CleanupOptions };
