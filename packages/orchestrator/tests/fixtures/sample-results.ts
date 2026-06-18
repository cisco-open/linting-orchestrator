/**
 * Test fixtures for lint job results
 * 
 * Provides sample data for testing storage implementations
 */

import type { LintJobResult, LintIssue, RulesetExecutionResult } from '../../src/types.js';

/**
 * Create sample lint issues
 */
export function createSampleIssues(): LintIssue[] {
  return [
    {
      ruleId: 'typed-enum',
      code: 'typed-enum',
      message: 'Enum values must be typed',
      severity: 0, // error
      path: ['paths', '/pets', 'get', 'responses', '200', 'content', 'application/json', 'schema', 'properties', 'status'],
      range: {
        start: { line: 45, character: 10 },
        end: { line: 45, character: 30 }
      }
    },
    {
      ruleId: 'operation-tag-defined',
      code: 'operation-tag-defined',
      message: 'Operation tags must be defined in global tags',
      severity: 1, // warn
      path: ['paths', '/pets', 'post', 'tags', 0]
    },
    {
      ruleId: 'info-contact',
      code: 'info-contact',
      message: 'Info object must contain contact information',
      severity: 1, // warn
      path: ['info']
    },
    {
      ruleId: 'info-description',
      code: 'info-description',
      message: 'Info description should be comprehensive',
      severity: 2, // info
      path: ['info', 'description']
    },
    {
      ruleId: 'tag-description',
      code: 'tag-description',
      message: 'Tag should have description',
      severity: 3, // hint
      path: ['tags', 0]
    }
  ];
}

/**
 * Create sample ruleset execution result
 */
export function createSampleExecutionResult(documentId: string): RulesetExecutionResult {
  return {
    rulesetName: 'pubhub',
    rulesetVersion: '1.1.0',
    executionTime: 2500,
    success: true,
    issueCount: 5,
    issues: createSampleIssues(),
    metadata: {
      ruleEngine: 'spectral',
      documentId,
      cacheHit: false
    }
  };
}

/**
 * Create a complete sample lint job result
 */
export function createSampleJobResult(
  jobId: string = 'job-123',
  documentId: string = 'doc-456',
  rulesetName: string = 'pubhub',
  rulesetVersion: string = '1.1.0'
): LintJobResult {
  const issues = createSampleIssues();
  
  return {
    jobId,
    documentId,
    rulesetName,
    rulesetVersion,
    status: 'completed',
    timestamp: new Date('2025-11-19T10:00:00Z'),
    totalExecutionTime: 2500,
    summary: {
      totalIssues: 5,
      errorCount: 1,
      warningCount: 2,
      infoCount: 1,
      hintCount: 1
    },
    results: issues,
    executionDetails: createSampleExecutionResult(documentId)
  };
}

/**
 * Create multiple sample job results for the same document
 * Useful for testing document-based queries and invalidation
 */
export function createMultipleJobsForDocument(documentId: string): LintJobResult[] {
  return [
    createSampleJobResult('job-1', documentId, 'pubhub', '1.1.0'),
    createSampleJobResult('job-2', documentId, 'oas', '3.1.0'),
    createSampleJobResult('job-3', documentId, 'cisco', '2.0.0')
  ];
}

/**
 * Create sample job results for different documents
 * Useful for testing multi-document storage
 */
export function createMultipleJobsForDifferentDocuments(): LintJobResult[] {
  return [
    createSampleJobResult('job-1', 'doc-1', 'pubhub', '1.1.0'),
    createSampleJobResult('job-2', 'doc-2', 'pubhub', '1.1.0'),
    createSampleJobResult('job-3', 'doc-3', 'oas', '3.1.0'),
    createSampleJobResult('job-4', 'doc-1', 'oas', '3.1.0'), // Same doc as job-1, different ruleset
  ];
}

/**
 * Create a job result with many issues (for testing performance/size)
 */
export function createLargeJobResult(
  issueCount: number = 100
): LintJobResult {
  const issues: LintIssue[] = [];
  
  for (let i = 0; i < issueCount; i++) {
    issues.push({
      ruleId: `rule-${i}`,
      code: `rule-${i}`,
      message: `Issue ${i}: This is a test issue`,
      severity: (i % 4) as 0 | 1 | 2 | 3,
      path: ['paths', `/endpoint-${i}`, 'get', 'responses', '200']
    });
  }

  const summary = {
    totalIssues: issueCount,
    errorCount: issues.filter(i => i.severity === 0).length,
    warningCount: issues.filter(i => i.severity === 1).length,
    infoCount: issues.filter(i => i.severity === 2).length,
    hintCount: issues.filter(i => i.severity === 3).length
  };

  return {
    jobId: 'job-large',
    documentId: 'doc-large',
    rulesetName: 'pubhub',
    rulesetVersion: '1.1.0',
    status: 'completed',
    timestamp: new Date('2025-11-19T10:00:00Z'),
    totalExecutionTime: 5000,
    summary,
    results: issues,
    executionDetails: {
      rulesetName: 'pubhub',
      rulesetVersion: '1.1.0',
      executionTime: 5000,
      success: true,
      issueCount,
      issues: [],
      metadata: {
        ruleEngine: 'spectral',
        documentId: 'doc-large',
        cacheHit: false
      }
    }
  };
}

/**
 * Create a job result with realistic rule distribution for testing filtering/stats.
 * Generates issues with known rule IDs, severities, and path prefixes.
 */
export function createRealisticLargeJobResult(
  issueCount: number = 500
): LintJobResult {
  const ruleDefinitions = [
    { ruleId: 'description-for-every-attribute', severity: 1 as const, pathBase: 'components.schemas' },
    { ruleId: 'examples-for-every-schema', severity: 1 as const, pathBase: 'components.schemas' },
    { ruleId: 'typed-enum', severity: 0 as const, pathBase: 'paths./pets' },
    { ruleId: 'info-contact', severity: 1 as const, pathBase: 'info' },
    { ruleId: 'success-status-code', severity: 2 as const, pathBase: 'paths./users' },
    { ruleId: 'short-summaries', severity: 3 as const, pathBase: 'paths./orders' },
  ];

  const issues: LintIssue[] = [];
  for (let i = 0; i < issueCount; i++) {
    const def = ruleDefinitions[i % ruleDefinitions.length];
    issues.push({
      ruleId: def.ruleId,
      code: def.ruleId,
      message: `Issue ${i} from ${def.ruleId}`,
      severity: def.severity,
      path: def.pathBase.split('.').concat([`prop-${i}`]),
      range: {
        start: { line: i + 1, character: 0 },
        end: { line: i + 1, character: 20 }
      }
    });
  }

  const summary = {
    totalIssues: issueCount,
    errorCount: issues.filter(i => i.severity === 0).length,
    warningCount: issues.filter(i => i.severity === 1).length,
    infoCount: issues.filter(i => i.severity === 2).length,
    hintCount: issues.filter(i => i.severity === 3).length
  };

  return {
    jobId: 'job-realistic',
    documentId: 'doc-realistic',
    rulesetName: 'documentation',
    rulesetVersion: '2.0.0',
    status: 'completed',
    timestamp: new Date('2026-03-14T10:00:00Z'),
    totalExecutionTime: 8000,
    summary,
    results: issues,
    executionDetails: {
      rulesetName: 'documentation',
      rulesetVersion: '2.0.0',
      executionTime: 8000,
      success: true,
      issueCount,
      issues: [],
      metadata: {
        ruleEngine: 'spectral',
        documentId: 'doc-realistic',
        cacheHit: false
      }
    }
  };
}

/**
 * Create a failed job result
 */
export function createFailedJobResult(): LintJobResult {
  return {
    jobId: 'job-failed',
    documentId: 'doc-invalid',
    rulesetName: 'pubhub',
    rulesetVersion: '1.1.0',
    status: 'failed',
    timestamp: new Date('2025-11-19T10:00:00Z'),
    totalExecutionTime: 500,
    summary: {
      totalIssues: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      hintCount: 0
    },
    results: [],
    executionDetails: {
      rulesetName: 'pubhub',
      rulesetVersion: '1.1.0',
      executionTime: 500,
      success: false,
      error: 'Invalid OpenAPI document',
      issueCount: 0,
      issues: [],
      metadata: {
        ruleEngine: 'spectral',
        documentId: 'doc-invalid'
      }
    }
  };
}
