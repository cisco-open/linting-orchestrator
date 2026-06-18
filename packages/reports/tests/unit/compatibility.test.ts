/**
 * Unit tests for compatibility checking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportServiceClient, CLIENT_VERSION } from '../../src/client/index.js';

describe('ReportServiceClient - Compatibility Checking', () => {
  let client: ReportServiceClient;

  beforeEach(() => {
    client = new ReportServiceClient({
      url: 'http://localhost:3010',
      apiKey: 'test-key',
      timeout: 1000,
    });
  });

  it('should detect compatible versions', async () => {
    // Mock fetch to return compatible health response
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        server: {
          version: '0.2.2',
        },
        clientLibrary: {
          version: '1.1.0',
          compatible: '^1.0.0', // Client 1.1.0 satisfies ^1.0.0
        },
      }),
    });

    const result = await client.checkCompatibility();

    expect(result.compatible).toBe(true);
    expect(result.clientVersion).toBe(CLIENT_VERSION);
    expect(result.serverExpectedVersion).toBe('^1.0.0');
    expect(result.serverVersion).toBe('0.2.2');
    expect(result.details).toBeUndefined();
  });

  it('should detect incompatible versions', async () => {
    // Mock fetch to return incompatible health response
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        server: {
          version: '0.2.2',
        },
        clientLibrary: {
          version: '1.1.0',
          compatible: '^2.0.0', // Client 1.1.0 does NOT satisfy ^2.0.0
        },
      }),
    });

    const result = await client.checkCompatibility();

    expect(result.compatible).toBe(false);
    expect(result.clientVersion).toBe(CLIENT_VERSION);
    expect(result.serverExpectedVersion).toBe('^2.0.0');
    expect(result.serverVersion).toBe('0.2.2');
    expect(result.details).toContain('does not satisfy');
  });

  it('should handle exact version matches', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        server: {
          version: '0.2.2',
        },
        clientLibrary: {
          version: CLIENT_VERSION,
          compatible: CLIENT_VERSION, // Exact match
        },
      }),
    });

    const result = await client.checkCompatibility();

    expect(result.compatible).toBe(true);
    expect(result.serverExpectedVersion).toBe(CLIENT_VERSION);
  });

  it('should handle version ranges', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        server: {
          version: '0.2.2',
        },
        clientLibrary: {
          version: '1.1.0',
          compatible: '>=1.0.0 <2.0.0', // Range
        },
      }),
    });

    const result = await client.checkCompatibility();

    expect(result.compatible).toBe(true);
    expect(result.serverExpectedVersion).toBe('>=1.0.0 <2.0.0');
  });

  it('should throw error when health endpoint fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    await expect(client.checkCompatibility()).rejects.toThrow('HTTP 503');
  });

  it('should throw error when health endpoint is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(client.checkCompatibility()).rejects.toThrow('Network error');
  });

  it('should throw error when health response is malformed', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        server: {
          version: '0.2.2',
        },
        // Missing clientLibrary.compatible field
      }),
    });

    await expect(client.checkCompatibility()).rejects.toThrow(
      'missing clientLibrary.compatible'
    );
  });

  it('should timeout on slow health endpoint', async () => {
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise(resolve => {
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: async () => ({ status: 'ok' }),
              }),
            5000
          ); // 5s, but timeout is 1s
        })
    );

    await expect(client.checkCompatibility()).rejects.toThrow();
  });
});
