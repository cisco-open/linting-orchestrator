/**
 * SARIF 2.1.0 Builder
 * 
 * Transforms LintJobResult into SARIF (Static Analysis Results Interchange Format)
 * Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 * 
 * @module formatters/sarif-builder
 */

import crypto from 'crypto';
import type {
  LintJobResult,
  LintIssue,
  SarifReport,
  SarifRun,
  SarifTool,
  SarifRule,
  SarifResult,
  SarifLevel,
  SarifLocation,
  SarifRegion,
  SarifArtifact,
  ReportGenerationOptions,
} from '../types.js';

/**
 * SarifBuilder - Converts lint results to SARIF 2.1.0 format
 */
export class SarifBuilder {
  /**
   * Build a complete SARIF report from lint job result
   */
  buildSarif(result: LintJobResult, options?: ReportGenerationOptions): SarifReport {
    return {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [this.buildRun(result, options)],
    };
  }

  /**
   * Build a SARIF run from lint result
   */
  private buildRun(result: LintJobResult, options?: ReportGenerationOptions): SarifRun {
    return {
      tool: this.buildTool(result),
      artifacts: this.buildArtifacts(result),
      results: this.buildResults(result, options),
      properties: this.buildRunProperties(result),
    };
  }

  /**
   * Build tool metadata
   */
  private buildTool(result: LintJobResult): SarifTool {
    // Use a simple version string or parse from result
    const version = '0.7.0'; // Updated when server version changes

    return {
      driver: {
        name: 'cisco-linting-orchestrator',
        version: version,
        informationUri: 'https://github.com/cisco-open/linting-orchestrator',
        rules: this.buildRules(result),
      },
    };
  }

  /**
   * Build rule catalog from lint issues
   * Creates unique rule entries from all issues
   */
  private buildRules(result: LintJobResult): SarifRule[] {
    const rulesMap = new Map<string, SarifRule>();

    for (const issue of result.results) {
      if (!rulesMap.has(issue.code)) {
        rulesMap.set(issue.code, {
          id: issue.code,
          shortDescription: {
            text: this.extractShortDescription(issue.message),
          },
          fullDescription: {
            text: issue.message,
          },
          defaultConfiguration: {
            level: this.mapSeverityToSarifLevel(issue.severity),
          },
          helpUri: this.buildHelpUri(result, issue),
          properties: {
            category: this.extractCategory(issue),
            tags: this.extractTags(issue),
          },
        });
      }
    }

    return Array.from(rulesMap.values());
  }

  /**
   * Extract short description from message (first sentence or up to 80 chars)
   */
  private extractShortDescription(message: string): string {
    // Try to find first sentence
    const firstSentence = message.match(/^[^.!?]+[.!?]/);
    if (firstSentence) {
      return firstSentence[0];
    }

    // Fallback: truncate at 80 chars
    if (message.length > 80) {
      return message.substring(0, 77) + '...';
    }

    return message;
  }

  /**
   * Build help URI for a rule
   */
  private buildHelpUri(result: LintJobResult, issue: LintIssue): string | undefined {
    // For PubHub ruleset, use PubHub docs
    if (result.rulesetName === 'pubhub') {
      return `https://pubhub.cisco.com/docs/spectify/rules/${issue.code}`;
    }

    // Generic orchestrator docs
    return `https://github.com/cisco-open/spectify/docs/rules/${issue.code}`;
  }

  /**
   * Extract category from issue (if available in path or code)
   */
  private extractCategory(issue: LintIssue): string {
    // Try to extract from code (e.g., "devx-publishing-001" → "publishing")
    const categoryMatch = issue.code.match(/^[a-z]+-([a-z]+)-/);
    if (categoryMatch) {
      return categoryMatch[1];
    }

    return 'general';
  }

  /**
   * Extract tags from issue
   */
  private extractTags(issue: LintIssue): string[] {
    const tags: string[] = [];

    // Add severity as tag (map number to string)
    const severityNames = ['error', 'warning', 'info', 'hint'];
    tags.push(severityNames[issue.severity] || 'warning');

    // Add category
    const category = this.extractCategory(issue);
    if (category !== 'general') {
      tags.push(category);
    }

    return tags;
  }

  /**
   * Map severity to SARIF level
   */
  private mapSeverityToSarifLevel(severity: 0 | 1 | 2 | 3): SarifLevel {
    // 0=error, 1=warn, 2=info, 3=hint
    switch (severity) {
      case 0:
        return 'error';
      case 1:
        return 'warning';
      case 2:
      case 3:
        return 'note';
      default:
        return 'warning';
    }
  }

  /**
   * Build artifact metadata (document being analyzed)
   */
  private buildArtifacts(result: LintJobResult): SarifArtifact[] {
    return [
      {
        location: {
          uri: `file://${result.documentId}`,
        },
        properties: {
          documentId: result.documentId,
          documentName: result.documentId, // Could be enriched with actual name
        },
      },
    ];
  }

  /**
   * Build SARIF results from lint issues
   */
  private buildResults(result: LintJobResult, options?: ReportGenerationOptions): SarifResult[] {
    return result.results.map((issue) => this.buildResult(result, issue, options));
  }

  /**
   * Build a single SARIF result from a lint issue
   */
  private buildResult(
    result: LintJobResult,
    issue: LintIssue,
    options?: ReportGenerationOptions
  ): SarifResult {
    // Map numeric severity to string for properties
    const severityNames = ['error', 'warning', 'info', 'hint'];
    const severityString = severityNames[issue.severity] || 'warning';

    return {
      ruleId: issue.code,
      level: this.mapSeverityToSarifLevel(issue.severity),
      message: {
        text: issue.message,
      },
      locations: this.buildLocations(result, issue, options),
      fingerprints: this.generateFingerprints(result, issue),
      properties: {
        severity: severityString,
        path: issue.path,
        rulesetName: result.rulesetName,
        rulesetVersion: result.rulesetVersion,
      },
    };
  }

  /**
   * Build locations for an issue
   */
  private buildLocations(
    result: LintJobResult,
    issue: LintIssue,
    options?: ReportGenerationOptions
  ): SarifLocation[] {
    const location: SarifLocation = {
      physicalLocation: {
        artifactLocation: {
          uri: `file://${result.documentId}`,
        },
        region: this.buildRegion(issue, options),
      },
    };

    return [location];
  }

  /**
   * Build region (line/column range) for an issue
   */
  private buildRegion(issue: LintIssue, _options?: ReportGenerationOptions): SarifRegion | undefined {
    if (!issue.range) {
      return undefined;
    }

    const region: SarifRegion = {
      startLine: issue.range.start.line,
      startColumn: issue.range.start.character,
    };

    if (issue.range.end) {
      region.endLine = issue.range.end.line;
      region.endColumn = issue.range.end.character;
    }

    // Note: the orchestrator's LintIssue doesn't have snippet field currently
    // This can be added in future if needed

    return region;
  }

  /**
   * Generate fingerprints for deduplication
   * Uses primaryLocationLineHash scheme (path + line + rule)
   */
  private generateFingerprints(result: LintJobResult, issue: LintIssue): Record<string, string> {
    const fingerprints: Record<string, string> = {};

    // Primary location line hash (standard scheme)
    const primaryLocation = this.buildPrimaryLocationHash(result, issue);
    fingerprints.primaryLocationLineHash = primaryLocation;

    return fingerprints;
  }

  /**
   * Build primary location hash for fingerprinting
   * Format: hash(documentId + path + line + ruleId)
   */
  private buildPrimaryLocationHash(result: LintJobResult, issue: LintIssue): string {
    const components = [
      result.documentId,
      issue.path.map(String).join('/'),
      issue.range?.start.line ?? 0,
      issue.code,
    ];

    const input = components.join(':');
    return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
  }

  /**
   * Build run properties (orchestrator-specific metadata)
   */
  private buildRunProperties(result: LintJobResult): Record<string, any> {
    return {
      spectify: {
        jobId: result.jobId,
        documentId: result.documentId,
        rulesetName: result.rulesetName,
        rulesetVersion: result.rulesetVersion,
        executionTime: result.totalExecutionTime,
        timestamp: result.timestamp.toISOString(),
        summary: {
          totalIssues: result.summary.totalIssues,
          bySeverity: {
            error: result.summary.errorCount,
            warning: result.summary.warningCount,
            info: result.summary.infoCount,
            hint: result.summary.hintCount,
          },
        },
      },
    };
  }
}
