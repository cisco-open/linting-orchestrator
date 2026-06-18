/**
 * Unit tests for ReportServiceClient.getStatus() — reachability check and retry timing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { ReportServiceClient } from '../../src/client/index.js';
import type { JobNotification } from '../../src/client/types.js';

const testPendingDir = join(process.cwd(), 'test-status-pending');

const baseNotification: JobNotification = {
  jobId: 'status-test-job-1',
  documentId: 'doc-status-1',
  status: 'completed',
  results: [],
  summary: {
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
    hintCount: 0,
    totalIssues: 0,
    durationMs: 100,
  },
  metadata: { name: 'Status Test API' },
  timestamp: new Date().toISOString(),
};

describe('ReportServiceClient - getStatus()', () => {
  let client: ReportServiceClient;
  // retryJobInterval set to 60000 so nextRetryAt timing assertions are predictable
  const CONFIG_RETRY_INTERVAL = 60000;

  beforeEach(async () => {
    if (existsSync(testPendingDir)) {
      rmSync(testPendingDir, { recursive: true, force: true });
    }
    client = new ReportServiceClient({
      url: 'http://localhost:3010',
      apiKey: 'test-key',
      timeout: 5000,
      pendingDir: testPendingDir,
      enableRetryJob: false,
      retryJobInterval: CONFIG_RETRY_INTERVAL,
    });
    await client.initialize();
  });

  afterEach(() => {
    client.stopRetryJob();
    if (existsSync(testPendingDir)) {
      rmSync(testPendingDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // reachable field
  // -----------------------------------------------------------------------
  describe('reachable field', () => {
    it('should report reachable=true when service health endpoint returns ok', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const status = await client.getStatus();

      expect(status.reachable).toBe(true);
      expect(status.enabled).toBe(true);
      expect(status.serviceUrl).toBe('http://localhost:3010');
    });

    it('should report reachable=false when service health endpoint returns non-2xx', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false });

      const status = await client.getStatus();

      expect(status.reachable).toBe(false);
    });

    it('should report reachable=false when service is unreachable (fetch throws)', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const status = await client.getStatus();

      expect(status.reachable).toBe(false);
    });

    it('should report reachable=false when health check is aborted', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });

      const status = await client.getStatus();

      expect(status.reachable).toBe(false);
    });

    it('should ping the /health endpoint on the configured service URL', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      await client.getStatus();

      expect(global.fetch).toHaveBeenCalledOnce();
      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
      expect(url).toBe('http://localhost:3010/health');
    });
  });

  // -----------------------------------------------------------------------
  // pending notifications count
  // -----------------------------------------------------------------------
  describe('pendingNotifications field', () => {
    it('should return 0 when no notifications are pending', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const status = await client.getStatus();

      expect(status.pendingNotifications).toBe(0);
    });

    it('should reflect notifications stored after a failed send', async () => {
      // /reports/jobs calls fail; /health calls succeed
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if ((url as string).endsWith('/health')) {
          return Promise.resolve({ ok: true });
        }
        return Promise.reject(new Error('Connection refused'));
      });

      await client.notify(baseNotification);

      const status = await client.getStatus();
      expect(status.pendingNotifications).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // retry job state — retryJobRunning / nextRetryAt
  // -----------------------------------------------------------------------
  describe('retry job state', () => {
    it('should report retryJobRunning=false when retry job not started', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const status = await client.getStatus();

      expect(status.retryJobRunning).toBe(false);
      expect(status.nextRetryAt).toBeUndefined();
    });

    it('should report retryJobRunning=true after startRetryJob()', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      client.startRetryJob();

      const status = await client.getStatus();
      expect(status.retryJobRunning).toBe(true);
    });

    it('should expose the configured retryJobInterval in status', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      client.startRetryJob();
      const status = await client.getStatus();

      // retryJobInterval always reflects the constructor config value
      expect(status.retryJobInterval).toBe(CONFIG_RETRY_INTERVAL);
    });

    it('should set nextRetryAt to ~one config interval from job start', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const before = Date.now();
      client.startRetryJob(); // uses config retryJobInterval (60000)
      const status = await client.getStatus();
      const after = Date.now();

      expect(status.nextRetryAt).toBeDefined();
      const nextRetry = new Date(status.nextRetryAt!).getTime();
      // nextRetryAt = startedAt + (0+1) * CONFIG_RETRY_INTERVAL
      expect(nextRetry).toBeGreaterThanOrEqual(before + CONFIG_RETRY_INTERVAL - 50);
      expect(nextRetry).toBeLessThanOrEqual(after + CONFIG_RETRY_INTERVAL + 50);
    });

    it('should report nextRetryAt in the future', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      client.startRetryJob();
      const status = await client.getStatus();

      const nextRetry = new Date(status.nextRetryAt!).getTime();
      expect(nextRetry).toBeGreaterThan(Date.now());
    });

    it('should report retryJobRunning=false and no nextRetryAt after stopRetryJob()', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      client.startRetryJob();
      expect((await client.getStatus()).retryJobRunning).toBe(true);

      client.stopRetryJob();
      const status = await client.getStatus();

      expect(status.retryJobRunning).toBe(false);
      expect(status.nextRetryAt).toBeUndefined();
    });

    it('should not start a second timer when startRetryJob() is called twice', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      client.startRetryJob();
      const before = (await client.getStatus()).nextRetryAt;
      client.startRetryJob(); // no-op: timer already running

      const after = (await client.getStatus()).nextRetryAt;
      // nextRetryAt should remain the same (same startedAt)
      expect(after).toBe(before);
    });
  });

  // -----------------------------------------------------------------------
  // lastRetryRun
  // -----------------------------------------------------------------------
  describe('lastRetryRun field', () => {
    it('should be undefined before any retry cycle', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const status = await client.getStatus();
      expect(status.lastRetryRun).toBeUndefined();
    });

    it('should be set after retryPendingNotifications() runs', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const before = new Date().toISOString();
      await client.retryPendingNotifications();
      const after = new Date().toISOString();

      const status = await client.getStatus();
      expect(status.lastRetryRun).toBeDefined();
      expect(status.lastRetryRun! >= before).toBe(true);
      expect(status.lastRetryRun! <= after).toBe(true);
    });
  });
});
