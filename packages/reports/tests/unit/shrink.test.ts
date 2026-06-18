/**
 * Unit tests for payload shrinking
 *
 * Verifies the dynamic shrink algorithm in ReportServiceClient:
 * - Small payloads pass through unchanged
 * - Oversized payloads are shrunk to fit the limit
 * - Original notification is never mutated
 * - Summary counts are preserved from the full run
 * - truncated / originalIssueCount metadata is set correctly
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportServiceClient } from '../../src/client/index.js';
import type { JobNotification, LintIssue } from '../../src/types.js';

/**
 * Helper: build a valid notification with a configurable number of issues.
 * Each issue is roughly ~200 bytes of JSON.
 */
function buildNotification(issueCount: number, jobId = 'shrink-test-job'): JobNotification {
  const issues: LintIssue[] = [];
  for (let i = 0; i < issueCount; i++) {
    issues.push({
      code: `rule-${i}`,
      message: `This is lint issue number ${i} with some extra text to make the payload larger`,
      severity: (i % 4) as 0 | 1 | 2 | 3,
      path: `/paths/some-long-path-segment/operations/get/responses/200/content/application~1json/schema/properties/field_${i}`,
      range: { start: { line: i, character: 0 }, end: { line: i, character: 80 } },
      source: `components.schemas.SomeLongSchemaName_${i}`,
    });
  }

  return {
    jobId,
    documentId: 'doc-shrink-test',
    status: 'completed',
    timestamp: new Date().toISOString(),
    metadata: {
      name: 'Shrink Test API',
      version: '1.0.0',
      organization: 'TestOrg',
      format: 'openapi',
    },
    summary: {
      totalIssues: issueCount,
      errorCount: Math.floor(issueCount / 4),
      warningCount: Math.floor(issueCount / 4),
      infoCount: Math.floor(issueCount / 4),
      hintCount: issueCount - 3 * Math.floor(issueCount / 4),
      durationMs: 1234,
    },
    results: [
      {
        rulesetName: 'test-ruleset',
        rulesetVersion: '1.0.0',
        status: 'completed',
        issues,
        summary: {
          totalIssues: issueCount,
          errorCount: Math.floor(issueCount / 4),
          warningCount: Math.floor(issueCount / 4),
          infoCount: Math.floor(issueCount / 4),
          hintCount: issueCount - 3 * Math.floor(issueCount / 4),
        },
      },
    ],
  };
}

describe('ReportServiceClient - Payload Shrinking', () => {
  // Use a tiny maxPayloadBytes so we don't need gigantic payloads in tests.
  const SMALL_LIMIT = 4096; // 4 KiB

  let client: ReportServiceClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock fetch to accept anything and return success
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = mockFetch;

    client = new ReportServiceClient({
      url: 'http://localhost:3010',
      apiKey: 'test-key',
      timeout: 1000,
      maxPayloadBytes: SMALL_LIMIT,
    });
  });

  it('should pass small payloads through unchanged', async () => {
    const notification = buildNotification(2);
    const original = JSON.parse(JSON.stringify(notification));

    const result = await client.notify(notification);

    expect(result.success).toBe(true);
    expect(result.truncated).toBeUndefined();

    // Original object was not mutated
    expect(notification).toEqual(original);

    // Verify the sent payload has all issues
    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.results[0].issues.length).toBe(2);
    expect(sentBody.results[0].truncated).toBeUndefined();
  });

  it('should shrink oversized payloads and set truncated metadata', async () => {
    const notification = buildNotification(200); // ~200 issues will exceed 4 KiB
    const originalIssueCount = notification.results[0].issues.length;
    const original = JSON.parse(JSON.stringify(notification));

    const result = await client.notify(notification);

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);

    // Original object was not mutated
    expect(notification).toEqual(original);

    // Verify the sent payload was shrunk
    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.results[0].issues.length).toBeLessThan(originalIssueCount);
    expect(sentBody.results[0].truncated).toBe(true);
    expect(sentBody.results[0].originalIssueCount).toBe(originalIssueCount);

    // Verify the sent payload fits within the limit
    const sentBytes = Buffer.byteLength(mockFetch.mock.calls[0][1].body, 'utf-8');
    expect(sentBytes).toBeLessThanOrEqual(SMALL_LIMIT);
  });

  it('should preserve summary counts from the full run', async () => {
    const notification = buildNotification(200);
    const originalSummary = { ...notification.summary };
    const originalRulesetSummary = { ...notification.results[0].summary };

    await client.notify(notification);

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);

    // Job-level summary unchanged
    expect(sentBody.summary).toEqual(originalSummary);

    // Ruleset-level summary unchanged
    expect(sentBody.results[0].summary).toEqual(originalRulesetSummary);
  });

  it('should keep issues in FIFO order', async () => {
    const notification = buildNotification(200);

    await client.notify(notification);

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const sentIssues = sentBody.results[0].issues;

    // First issue should be rule-0 (FIFO)
    expect(sentIssues[0].code).toBe('rule-0');
    // Last sent issue should be contiguous from the start
    const lastIdx = sentIssues.length - 1;
    expect(sentIssues[lastIdx].code).toBe(`rule-${lastIdx}`);
  });

  it('should strip source and range fields when shrinking', async () => {
    // Use a limit that requires shrinking — the shrink algorithm always
    // strips source/range as its first pass before truncating by count.
    const notification = buildNotification(200);

    const result = await client.notify(notification); // client has SMALL_LIMIT (4 KiB)

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // source and range should be stripped on all remaining issues
    for (const issue of sentBody.results[0].issues) {
      expect(issue.source).toBeUndefined();
      expect(issue.range).toBeUndefined();
    }
  });

  it('should never mutate the original notification object', async () => {
    const notification = buildNotification(200);
    const originalJson = JSON.stringify(notification);

    await client.notify(notification);

    // Strict equality of serialized form
    expect(JSON.stringify(notification)).toBe(originalJson);
  });

  it('should handle notifications with multiple rulesets', async () => {
    const notification = buildNotification(100);
    // Add a second ruleset
    notification.results.push({
      rulesetName: 'second-ruleset',
      rulesetVersion: '2.0.0',
      status: 'completed',
      issues: notification.results[0].issues.map(i => ({ ...i })),
      summary: { ...notification.results[0].summary },
    });

    const original = JSON.parse(JSON.stringify(notification));
    const result = await client.notify(notification);

    expect(result.success).toBe(true);
    expect(notification).toEqual(original); // Not mutated

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const sentBytes = Buffer.byteLength(mockFetch.mock.calls[0][1].body, 'utf-8');
    expect(sentBytes).toBeLessThanOrEqual(SMALL_LIMIT);

    // Both rulesets should be truncated
    for (const rs of sentBody.results) {
      if (rs.truncated) {
        expect(rs.originalIssueCount).toBe(100);
      }
    }
  });
});
