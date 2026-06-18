/**
 * Unit tests for payload validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportServiceClient } from '../../src/client/index.js';
import type { JobNotification } from '../../src/types.js';

describe('ReportServiceClient - Payload Validation', () => {
  let client: ReportServiceClient;

  beforeEach(() => {
    client = new ReportServiceClient({
      url: 'http://localhost:3010',
      apiKey: 'test-key',
      timeout: 1000,
    });
  });

  it('should validate required jobId field', async () => {
    const notification = {
      documentId: 'doc-123',
      timestamp: new Date().toISOString(),
      status: 'completed',
      results: [],
    } as unknown as JobNotification;

    const result = await client.notify(notification);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error?.message).toContain('jobId is required');
  });

  it('should validate required documentId field', async () => {
    const notification = {
      jobId: 'job-123',
      timestamp: new Date().toISOString(),
      status: 'completed',
      results: [],
    } as unknown as JobNotification;

    const result = await client.notify(notification);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error?.message).toContain('documentId is required');
  });

  it('should validate required timestamp field', async () => {
    const notification = {
      jobId: 'job-123',
      documentId: 'doc-123',
      status: 'completed',
      results: [],
    } as unknown as JobNotification;

    const result = await client.notify(notification);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error?.message).toContain('timestamp is required');
  });

  it('should validate status enum', async () => {
    const notification = {
      jobId: 'job-123',
      documentId: 'doc-123',
      timestamp: new Date().toISOString(),
      status: 'invalid-status',
      results: [],
    } as unknown as JobNotification;

    const result = await client.notify(notification);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error?.message).toContain('status must be one of: completed, failed, timeout');
    expect(result.error?.message).toContain('(got: invalid-status)');
  });

  it('should validate metadata.format enum', async () => {
    const notification = {
      jobId: 'job-123',
      documentId: 'doc-123',
      timestamp: new Date().toISOString(),
      status: 'completed',
      results: [],
      metadata: {
        format: 'invalid-format',
      },
    } as unknown as JobNotification;

    const result = await client.notify(notification);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error?.message).toContain('metadata.format must be one of: openapi, swagger, asyncapi, unknown');
  });

  it('should validate results is an array', async () => {
    const notification = {
      jobId: 'job-123',
      documentId: 'doc-123',
      timestamp: new Date().toISOString(),
      status: 'completed',
      results: 'not-an-array',
    } as unknown as JobNotification;

    const result = await client.notify(notification);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error?.message).toContain('results must be an array');
  });

  it('should validate result status enum', async () => {
    const notification = {
      jobId: 'job-123',
      documentId: 'doc-123',
      timestamp: new Date().toISOString(),
      status: 'completed',
      results: [
        {
          status: 'invalid',
          rulesetName: 'test',
        },
      ],
    } as unknown as JobNotification;

    const result = await client.notify(notification);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error?.message).toContain('results[0].status must be one of');
  });

  it('should validate issue severity range', async () => {
    const notification = {
      jobId: 'job-123',
      documentId: 'doc-123',
      timestamp: new Date().toISOString(),
      status: 'completed',
      results: [
        {
          status: 'completed',
          rulesetName: 'test',
          issues: [
            {
              severity: 5, // Invalid - must be 0-3
              code: 'test-rule',
              message: 'Test issue',
              path: [],
            },
          ],
        },
      ],
    } as unknown as JobNotification;

    const result = await client.notify(notification);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error?.message).toContain('severity must be 0-3');
  });

  it('should validate summary field types', async () => {
    const notification = {
      jobId: 'job-123',
      documentId: 'doc-123',
      timestamp: new Date().toISOString(),
      status: 'completed',
      results: [],
      summary: {
        totalIssues: 'not-a-number',
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        hintCount: 0,
        durationMs: 100,
      },
    } as unknown as JobNotification;

    const result = await client.notify(notification);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error?.message).toContain('summary.totalIssues must be a number');
  });

  it('should collect multiple validation errors', async () => {
    const notification = {
      status: 'invalid-status',
      results: 'not-an-array',
    } as unknown as JobNotification;

    const result = await client.notify(notification);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error?.message).toContain('jobId is required');
    expect(result.error?.message).toContain('documentId is required');
    expect(result.error?.message).toContain('timestamp is required');
    expect(result.error?.message).toContain('status must be one of');
    expect(result.error?.message).toContain('results must be an array');
  });

  it('should accept valid notification', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const notification: JobNotification = {
      jobId: 'job-123',
      documentId: 'doc-123',
      timestamp: new Date().toISOString(),
      status: 'completed',
      results: [
        {
          status: 'completed',
          rulesetName: 'test',
          issues: [
            {
              severity: 1, // Valid: 0-3
              code: 'test-rule',
              message: 'Test issue',
              path: [],
            },
          ],
        },
      ],
      summary: {
        totalIssues: 1,
        errorCount: 0,
        warningCount: 1,
        infoCount: 0,
        hintCount: 0,
        durationMs: 100,
      },
      metadata: {
        format: 'openapi', // Valid enum value
      },
    };

    const result = await client.notify(notification);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('should not make network call for invalid payloads', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const notification = {
      status: 'completed',
      results: [],
    } as unknown as JobNotification;

    await client.notify(notification);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
