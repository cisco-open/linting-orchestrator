/**
 * Formatters for orchestrator CLI output
 * Handles color coding, tables, and summary displays
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { LintJobResult, LintIssue, RuleSeverity } from '../types.js';
import { HistoryEntry } from './history-manager.js';
import { RulesetInfo } from './api-client.js';

/**
 * Ensure terminal colors are reset at end of output
 * This prevents terminal corruption when piping to more/less and interrupting
 */
function ensureReset(output: string): string {
  // Always end with a reset sequence to ensure terminal is left in clean state
  return output + '\x1b[0m';
}

/**
 * Get colored severity indicator
 */
export function formatSeverity(severity: number | RuleSeverity): string {
  const severityNum = typeof severity === 'number' ? severity :
    severity === 'error' ? 0 : severity === 'warn' ? 1 : severity === 'info' ? 2 : 3;

  switch (severityNum) {
    case 0: // error
      return chalk.red('error');
    case 1: // warning
      return chalk.yellow('warning');
    case 2: // info
      return chalk.blue('info');
    case 3: // hint
      return chalk.gray('hint');
    default:
      return String(severity);
  }
}

/**
 * Get severity icon
 */
export function getSeverityIcon(severity: number | RuleSeverity): string {
  const severityNum = typeof severity === 'number' ? severity :
    severity === 'error' ? 0 : severity === 'warn' ? 1 : severity === 'info' ? 2 : 3;

  switch (severityNum) {
    case 0: // error
      return chalk.red('✖');
    case 1: // warning
      return chalk.yellow('⚠');
    case 2: // info
      return chalk.blue('ℹ');
    case 3: // hint
      return chalk.gray('💡');
    default:
      return '•';
  }
}

/**
 * Format ruleset display name with override info.
 * Returns long form: "pubhub v1.1.0 (2 rules excluded, 1 severity override)"
 * Or short form: "pubhub v1.1.0" when no overrides present.
 */
export function formatRulesetDisplay(
  rulesetName: string,
  rulesetVersion: string,
  ruleOverrides?: Record<string, string>
): string {
  let display = `${rulesetName} v${rulesetVersion}`;
  if (ruleOverrides && Object.keys(ruleOverrides).length > 0) {
    const excluded = Object.values(ruleOverrides).filter(v => v === 'off').length;
    const severityChanges = Object.values(ruleOverrides).filter(v => v !== 'off').length;
    const parts: string[] = [];
    if (excluded > 0) parts.push(`${excluded} rule${excluded !== 1 ? 's' : ''} excluded`);
    if (severityChanges > 0) parts.push(`${severityChanges} severity override${severityChanges !== 1 ? 's' : ''}`);
    if (parts.length > 0) {
      display += ` (${parts.join(', ')})`;
    }
  }
  return display;
}

/**
 * Format ruleset name in short form: "pubhub*" if overrides present, "pubhub" otherwise.
 */
export function formatRulesetShort(
  rulesetName: string,
  ruleOverrides?: Record<string, string>
): string {
  if (ruleOverrides && Object.keys(ruleOverrides).length > 0) {
    return `${rulesetName}*`;
  }
  return rulesetName;
}

/**
 * Format lint result summary
 */
export function formatSummary(result: LintJobResult, dimmed: boolean = false): string {
  const { summary } = result;
  const lines: string[] = [];

  const applyStyle = (text: string) => dimmed ? chalk.dim(text) : text;
  const applyBold = (text: string) => dimmed ? chalk.dim(text) : chalk.bold(text);

  lines.push('');
  lines.push(applyBold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  lines.push(applyBold('Summary'));
  lines.push(applyBold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  if (summary.totalIssues === 0) {
    lines.push(applyStyle(chalk.green('✓ No issues found!')));
  } else {
    lines.push(applyStyle(`Total Issues: ${chalk.bold(summary.totalIssues)}`));
    if (summary.errorCount > 0) {
      lines.push(applyStyle(`  ${chalk.red('✖')} Errors:   ${chalk.red(summary.errorCount)}`));
    }
    if (summary.warningCount > 0) {
      lines.push(applyStyle(`  ${chalk.yellow('⚠')} Warnings: ${chalk.yellow(summary.warningCount)}`));
    }
    if (summary.infoCount > 0) {
      lines.push(applyStyle(`  ${chalk.blue('ℹ')} Info:     ${chalk.blue(summary.infoCount)}`));
    }
    if (summary.hintCount > 0) {
      lines.push(applyStyle(`  ${chalk.gray('💡')} Hints:    ${chalk.gray(summary.hintCount)}`));
    }
  }

  lines.push('');
  lines.push(applyStyle(`Ruleset:  ${formatRulesetDisplay(result.rulesetName, result.rulesetVersion, (result as any).ruleOverrides)}`));
  lines.push(applyStyle(`Document: ${result.documentId}`));
  lines.push(applyStyle(`Job ID:   ${result.jobId}`));

  if ((result.summary as any).cacheHit) {
    lines.push(chalk.dim('(cached result)'));
  }

  lines.push('');

  return ensureReset(lines.join('\n'));
}

/**
 * Format lint issues as a table
 */
export function formatIssuesTable(issues: LintIssue[], limit?: number): string {
  if (issues.length === 0) {
    return chalk.green('✓ No issues found!\n');
  }

  const displayIssues = limit ? issues.slice(0, limit) : issues;

  const table = new Table({
    head: [
      chalk.bold('Severity'),
      chalk.bold('Rule'),
      chalk.bold('Location'),
      chalk.bold('Message'),
    ],
    colWidths: [12, 35, 20, 50],
    wordWrap: true,
    style: {
      head: [],
      border: [],
    },
  });

  for (const issue of displayIssues) {
    const location = issue.path
      ? `${issue.path.join('.')}${issue.range ? `:${issue.range.start.line}` : ''}`
      : issue.range
        ? `line ${issue.range.start.line}`
        : '-';

    table.push([
      getSeverityIcon(issue.severity),
      chalk.cyan(issue.code || issue.ruleId),
      chalk.gray(location),
      issue.message,
    ]);
  }

  let output = table.toString() + '\n';

  if (limit && issues.length > limit) {
    output += chalk.dim(`\n... and ${issues.length - limit} more issues\n`);
    output += chalk.dim(`Use 'spectify results <jobId>' to see all issues\n`);
  }

  return ensureReset(output);
}

/**
 * Format issues grouped by rule (summary view for drill-down)
 */
export function formatRuleSummaryTable(issues: LintIssue[]): string {
  if (issues.length === 0) {
    return chalk.green('✓ No issues found!\n');
  }

  // Group issues by rule
  const ruleGroups = new Map<string, {
    code: string;
    errors: number;
    warnings: number;
    info: number;
    hints: number;
    total: number;
    message: string;
  }>();

  for (const issue of issues) {
    const ruleCode = issue.code || issue.ruleId;
    if (!ruleGroups.has(ruleCode)) {
      ruleGroups.set(ruleCode, {
        code: ruleCode,
        errors: 0,
        warnings: 0,
        info: 0,
        hints: 0,
        total: 0,
        message: issue.message, // Save first message as example
      });
    }

    const group = ruleGroups.get(ruleCode)!;
    group.total++;

    switch (issue.severity) {
      case 0: group.errors++; break;
      case 1: group.warnings++; break;
      case 2: group.info++; break;
      case 3: group.hints++; break;
    }
  }

  // Sort by total count (descending), then by severity
  const sortedRules = Array.from(ruleGroups.values()).sort((a, b) => {
    if (a.errors !== b.errors) return b.errors - a.errors;
    if (a.warnings !== b.warnings) return b.warnings - a.warnings;
    if (a.total !== b.total) return b.total - a.total;
    return a.code.localeCompare(b.code);
  });

  const table = new Table({
    head: [
      chalk.bold('Rule'),
      chalk.bold('Total'),
      chalk.bold('Errors'),
      chalk.bold('Warnings'),
      chalk.bold('Info'),
      chalk.bold('Hints'),
      chalk.bold('Example Message'),
    ],
    colWidths: [35, 8, 10, 12, 8, 8, 50],
    wordWrap: true,
    style: {
      head: [],
      border: [],
    },
  });

  for (const rule of sortedRules) {
    const errorText = rule.errors > 0 ? chalk.red(rule.errors) : chalk.dim('0');
    const warningText = rule.warnings > 0 ? chalk.yellow(rule.warnings) : chalk.dim('0');
    const infoText = rule.info > 0 ? chalk.blue(rule.info) : chalk.dim('0');
    const hintText = rule.hints > 0 ? chalk.gray(rule.hints) : chalk.dim('0');

    table.push([
      chalk.cyan(rule.code),
      rule.total.toString(),
      errorText,
      warningText,
      infoText,
      hintText,
      chalk.gray(rule.message.substring(0, 80) + (rule.message.length > 80 ? '...' : '')),
    ]);
  }

  return ensureReset(table.toString() + '\n');
}

/**
 * Format issues for a specific rule (detail view without repetition)
 */
export function formatRuleDetailView(issues: LintIssue[]): string {
  if (issues.length === 0) {
    return chalk.green('✓ No issues found!\n');
  }

  // Get rule information from first issue (all should be the same)
  const firstIssue = issues[0];
  const severity = getSeverityIcon(firstIssue.severity);
  const severityText = formatSeverity(firstIssue.severity);
  const ruleCode = firstIssue.code || firstIssue.ruleId;

  // Show rule header in clear white text
  const lines: string[] = [];
  lines.push(chalk.bold('Rule Details:'));
  lines.push(`  ${severity} ${severityText.toUpperCase()} - ${chalk.cyan(ruleCode)}`);

  // Wrap message text at 80 characters
  const message = firstIssue.message;
  const wrappedMessage = wrapText(message, 80, '  ');
  lines.push(wrappedMessage);
  lines.push('');

  console.log(lines.join('\n'));

  // Create table with Line # first, then Path (wider, no Suggestion column)
  const table = new Table({
    head: [
      chalk.bold('Line #'),
      chalk.bold('Path'),
    ],
    colWidths: [10, 110],
    wordWrap: true,
    style: {
      head: [],
      border: [],
    },
  });

  for (const issue of issues) {
    const lineStr = issue.range
      ? issue.range.start.line.toString()
      : '-';

    // Format path - join with dots for better wrapping
    const pathStr = issue.path && issue.path.length > 0
      ? issue.path.join('.')
      : '-';

    table.push([
      chalk.yellow(lineStr),
      pathStr,
    ]);
  }

  return ensureReset(table.toString() + '\n');
}

/**
 * Wrap text at specified width with prefix
 */
function wrapText(text: string, width: number, prefix: string = ''): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = prefix;

  for (const word of words) {
    const testLine = currentLine === prefix ? currentLine + word : currentLine + ' ' + word;

    if (testLine.length > width && currentLine !== prefix) {
      lines.push(currentLine);
      currentLine = prefix + word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine !== prefix) {
    lines.push(currentLine);
  }

  return lines.join('\n');
}

/**
 * Format history entries as a table
 */
export function formatHistoryTable(entries: HistoryEntry[]): string {
  if (entries.length === 0) {
    return chalk.dim('No history entries found.\n');
  }

  const table = new Table({
    head: [
      chalk.bold('Date'),
      chalk.bold('JobId / OpenAPI document'),
      chalk.bold('Ruleset'),
      chalk.bold('Issues'),
    ],
    colWidths: [20, 45, 20, 20],
    wordWrap: true,
  });

  for (const entry of entries) {
    const date = new Date(entry.timestamp).toLocaleString();
    const fileName = entry.filePath.split('/').pop() || entry.filePath;
    const issuesSummary = entry.summary.totalIssues === 0
      ? chalk.green('✓ No issues')
      : `${chalk.red(`${entry.summary.errorCount}E`)} ${chalk.yellow(`${entry.summary.warningCount}W`)}`;

    // Format JobId / OpenAPI document on two lines
    const jobIdAndFile = `${chalk.dim(entry.jobId)}\n${fileName}`;

    table.push([
      chalk.dim(date),
      jobIdAndFile,
      `${entry.rulesetName} v${entry.rulesetVersion}`,
      issuesSummary,
    ]);
  }

  return ensureReset(table.toString() + '\n');
}

/**
 * Format rulesets as a table
 */
export function formatRulesetsTable(rulesets: RulesetInfo[]): string {
  if (rulesets.length === 0) {
    return chalk.dim('No rulesets available.\n');
  }

  const table = new Table({
    head: [
      chalk.bold('Name'),
      chalk.bold('Versions'),
      chalk.bold('Rules'),
      chalk.bold('Description'),
    ],
    colWidths: [18, 22, 8, 58],
    wordWrap: true,
  });

  for (const ruleset of rulesets) {
    // Format description with display name on first line
    const description = ruleset.displayName
      ? `${chalk.bold(ruleset.displayName)}\n${ruleset.description || ''}`
      : ruleset.description || '-';

    // List all versions, default first
    const allVersions = ruleset.availableVersions && ruleset.availableVersions.length > 0
      ? ruleset.availableVersions
      : [ruleset.version];
    const defaultVer = ruleset.defaultVersion || ruleset.version;
    const sorted = [
      ...allVersions.filter(v => v === defaultVer),
      ...allVersions.filter(v => v !== defaultVer),
    ];
    const versionsStr = sorted
      .map(v => v === defaultVer ? chalk.green(`${v} (default)`) : chalk.dim(v))
      .join('\n');

    table.push([
      chalk.cyan(ruleset.name),
      versionsStr,
      String(ruleset.ruleCount),
      description,
    ]);
  }

  return ensureReset(table.toString() + '\n');
}

/**
 * Format job status
 */
export function formatJobStatus(status: any): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`Job ID: ${status.jobId}`);

  switch (status.status) {
    case 'queued':
      lines.push(`Status: ${chalk.yellow('⏳ Queued')}`);
      break;
    case 'running':
      lines.push(`Status: ${chalk.blue('▶ Running')}`);
      if (status.progress) {
        const percent = Math.round((status.progress.completed / status.progress.total) * 100);
        lines.push(`Progress: ${status.progress.completed}/${status.progress.total} (${percent}%)`);
        if (status.progress.currentRule) {
          lines.push(`Current: ${status.progress.currentRule}`);
        }
      }
      break;
    case 'completed':
      lines.push(`Status: ${chalk.green('✓ Completed')}`);
      break;
    case 'failed':
      lines.push(`Status: ${chalk.red('✖ Failed')}`);
      break;
  }

  if (status.startedAt) {
    lines.push(`Started: ${new Date(status.startedAt).toLocaleString()}`);
  }
  if (status.completedAt) {
    lines.push(`Completed: ${new Date(status.completedAt).toLocaleString()}`);
  }

  lines.push('');

  return ensureReset(lines.join('\n'));
}

/**
 * Format health status
 */
export function formatHealth(health: any): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold('Linting Orchestrator — Health Status'));
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const statusIcon = health.status === 'healthy' || health.status === 'ok'
    ? chalk.green('✓')
    : health.status === 'degraded'
      ? chalk.yellow('⚠')
      : chalk.red('✖');

  lines.push(`Status:  ${statusIcon} ${health.status}`);
  lines.push(`Version: ${health.version}`);

  // Show server metadata
  if (health.server) {
    lines.push('');
    lines.push(chalk.bold('Server Information'));
    if ((health as any).mode) {
      lines.push(`Mode:      ${(health as any).mode}`);
    }
    lines.push(`Port:      ${health.server.port}`);
    lines.push(`Host:      ${health.server.host}`);

    if (health.server.startedAt) {
      const started = new Date(health.server.startedAt);
      lines.push(`Started:   ${started.toLocaleString()}`);
    }
  }

  // Show document store configuration
  if ((health as any).documentStore) {
    lines.push('');
    lines.push(chalk.bold('Document Store'));
    lines.push(`Type:      ${(health as any).documentStore.type}`);
    if ((health as any).documentStore.fullPath) {
      lines.push(`Location:  ${(health as any).documentStore.fullPath}`);
    } else if ((health as any).documentStore.baseDir) {
      lines.push(`Location:  ${(health as any).documentStore.baseDir}`);
    }
  }

  // Show runtime information (Spectral versions, resolver)
  if ((health as any).runtime) {
    const rt = (health as any).runtime;
    lines.push('');
    lines.push(chalk.bold('Runtime'));
    if (rt.nodeVersion) lines.push(`Node:      ${rt.nodeVersion}`);
    if (rt.spectralCore) lines.push(`Spectral:  core ${rt.spectralCore}`);
    if (rt.spectralRulesets) lines.push(`           rulesets ${rt.spectralRulesets}`);
    if (rt.spectralCli) lines.push(`           cli ${rt.spectralCli}`);
    lines.push(`Resolver:  ${rt.resolver ? rt.resolver : chalk.dim('none (Spectral default)')}`);
  }

  // Show Report Service integration status (always show, even if not configured)
  lines.push('');
  lines.push(chalk.bold('Report Service Integration'));

  if ((health as any).reportService) {
    const rs = (health as any).reportService;

    // Status indicator based on actual connection state
    let statusIcon: string;
    if (rs.status === 'connected') {
      statusIcon = chalk.green('✓ Connected');
    } else if (rs.status === 'degraded') {
      statusIcon = chalk.yellow('⚠ Degraded');
      if (rs.pendingNotifications > 0) {
        statusIcon += chalk.dim(` (service unreachable, ${rs.pendingNotifications} pending)`);
      }
    } else if (rs.status === 'unreachable') {
      statusIcon = chalk.red('✖ Unreachable');
    } else if (rs.status === 'error') {
      statusIcon = chalk.red('✖ Error');
    } else if (rs.enabled) {
      statusIcon = chalk.green('✓ Enabled');
    } else {
      statusIcon = chalk.red('✖ Disabled');
    }
    lines.push(`Status:    ${statusIcon}`);

    if (rs.serviceUrl) {
      lines.push(`URL:       ${rs.serviceUrl}`);
    }

    // Show message for degraded/error states
    if (rs.message) {
      lines.push(`           ${chalk.dim(rs.message)}`);
    }

    if (rs.pendingNotifications !== undefined && rs.pendingNotifications !== 'N/A') {
      const pendingColor = rs.pendingNotifications > 0 ? chalk.yellow : chalk.dim;
      lines.push(`Pending:   ${pendingColor(rs.pendingNotifications.toString())}`);
    }

    if (rs.retryJobRunning !== undefined) {
      const retryIcon = rs.retryJobRunning ? chalk.green('✓ Running') : chalk.dim('○ Stopped');
      lines.push(`Retry Job: ${retryIcon}`);
    }

    if (rs.lastRetryRun) {
      const lastRun = new Date(rs.lastRetryRun);
      lines.push(`Last Run:  ${lastRun.toLocaleString()}`);
    }

    // Show next retry time when there are pending notifications
    if (rs.nextRetryAt && rs.pendingNotifications > 0) {
      const nextRetry = new Date(rs.nextRetryAt);
      const now = new Date();
      const diffMs = nextRetry.getTime() - now.getTime();
      if (diffMs > 0) {
        const diffSecs = Math.ceil(diffMs / 1000);
        const minutes = Math.floor(diffSecs / 60);
        const seconds = diffSecs % 60;
        const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        lines.push(`Next Retry: ${chalk.cyan(`in ${timeStr}`)}`);
      } else {
        lines.push(`Next Retry: ${chalk.cyan('imminent')}`);
      }
    } else if (rs.retryJobRunning && rs.retryJobInterval && rs.pendingNotifications > 0) {
      // Fallback: show retry interval if no specific next time
      const intervalMinutes = Math.round(rs.retryJobInterval / 60000);
      lines.push(`Retry Interval: ${chalk.dim(`every ${intervalMinutes}m`)}`);
    }

    if (rs.error) {
      lines.push(`Error:     ${chalk.red(rs.error)}`);
    }
  } else {
    lines.push(`Status:    ${chalk.dim('○ Not configured')}`);
    lines.push(chalk.dim(`To enable: Set SPECTIFYD_REPORTS_ENABLED=true in .env`));
  }

  // Show capacity and worker stats
  if (health.stats) {
    const stats = health.stats;

    if (stats.capacity) {
      lines.push('');
      lines.push(chalk.bold('Capacity'));
      const pct = stats.capacity.utilizationPercent || 0;
      const capacityColor = pct >= 90 ? chalk.red : pct >= 70 ? chalk.yellow : chalk.green;
      lines.push(`Active:    ${capacityColor(`${stats.capacity.activeJobs}/${stats.capacity.maxConcurrentJobs}`)} jobs (${capacityColor(`${pct}%`)})`);
    }

    if (stats.jobs) {
      lines.push(`Queued:    ${stats.jobs.queued}  Running: ${stats.jobs.running}  Completed: ${stats.jobs.completed}  Failed: ${stats.jobs.failed}`);
    }

    if (stats.workers) {
      lines.push('');
      lines.push(chalk.bold('Workers'));
      lines.push(`Total:     ${stats.workers.total}  Active: ${stats.workers.active}  Idle: ${stats.workers.idle}`);
    }

    if (stats.cache) {
      const hitRate = stats.cache.hitRate !== undefined
        ? `${(stats.cache.hitRate * 100).toFixed(0)}%`
        : 'N/A';
      lines.push('');
      lines.push(chalk.bold('Cache'));
      lines.push(`Hit Rate:  ${hitRate}  (${stats.cache.hits} hits / ${stats.cache.misses} misses)`);
    }
  }

  if (health.uptime !== undefined) {
    const uptimeSeconds = health.uptime;
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;

    let uptimeStr = '';
    if (hours > 0) uptimeStr += `${hours}h `;
    if (minutes > 0) uptimeStr += `${minutes}m `;
    uptimeStr += `${seconds}s`;

    lines.push('');
    lines.push(`Uptime:    ${uptimeStr}`);
  }

  lines.push('');

  return ensureReset(lines.join('\n'));
}

/**
 * Format jobs list as a table
 */
export function formatJobsTable(jobs: any[], detailed: boolean = false): string {
  if (jobs.length === 0) {
    return chalk.dim('No jobs found.\n');
  }

  const table = new Table({
    head: detailed
      ? [
        chalk.bold('Date'),
        chalk.bold('JobId'),
        chalk.bold('Document'),
        chalk.bold('Ruleset'),
        chalk.bold('Status'),
        chalk.bold('Issues'),
      ]
      : [
        chalk.bold('Date'),
        chalk.bold('JobId'),
        chalk.bold('DocumentId'),
        chalk.bold('Ruleset'),
        chalk.bold('Status'),
        chalk.bold('Issues'),
      ],
    colWidths: detailed ? [18, 15, 30, 18, 12, 15] : [18, 15, 15, 18, 12, 15],
    wordWrap: true,
  });

  for (const job of jobs) {
    const date = new Date(job.timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Format status with color
    let statusDisplay = job.status;
    if (job.status === 'completed') {
      statusDisplay = chalk.green('✓ done');
    } else if (job.status === 'completed_with_errors') {
      statusDisplay = chalk.yellow('⚠ done');
    } else if (job.status === 'failed') {
      statusDisplay = chalk.red('✗ failed');
    } else if (job.status === 'timeout') {
      statusDisplay = chalk.red('⏱ timeout');
    } else if (job.status === 'running') {
      statusDisplay = chalk.blue('⟳ running');
    }

    // Format issues summary
    let issuesSummary = '';
    if (job.summary && job.summary.totalIssues === 0) {
      issuesSummary = chalk.green('✓ 0');
    } else if (job.summary) {
      const parts = [];
      if (job.summary.errorCount > 0) parts.push(chalk.red(`${job.summary.errorCount}E`));
      if (job.summary.warningCount > 0) parts.push(chalk.yellow(`${job.summary.warningCount}W`));
      if (job.summary.infoCount > 0) parts.push(chalk.cyan(`${job.summary.infoCount}I`));
      issuesSummary = parts.join(' ');
    } else {
      issuesSummary = chalk.dim('n/a');
    }

    // Short job ID (first 12 chars)
    const shortJobId = chalk.dim(job.jobId.slice(0, 12));

    // Ruleset version
    const rulesetDisplay = `${job.rulesetName}\n${chalk.dim('v' + job.rulesetVersion)}`;

    if (detailed && job.document) {
      // Detailed mode - show document name
      const docName = job.document.name || 'Unknown';
      const docInfo = job.document.version
        ? `${docName}\n${chalk.dim('v' + job.document.version)}`
        : docName;

      table.push([
        chalk.dim(date),
        shortJobId,
        docInfo,
        rulesetDisplay,
        statusDisplay,
        issuesSummary,
      ]);
    } else {
      // Lightweight mode - show document ID
      const shortDocId = chalk.dim(job.documentId.slice(0, 12));

      table.push([
        chalk.dim(date),
        shortJobId,
        shortDocId,
        rulesetDisplay,
        statusDisplay,
        issuesSummary,
      ]);
    }
  }

  return ensureReset(table.toString() + '\n');
}
