/**
 * API Client for linting orchestrator HTTP API
 * Wraps all API endpoints with proper error handling and typing
 */

import { LintJobResult } from '../types.js';

/**
 * Thrown when the CLI cannot reach the orchestrator service.
 * Caught by handleCommandError() to print a consistent "not running" message.
 */
export class ConnectionError extends Error {
  constructor(public readonly baseUrl: string) {
    super(`Cannot connect to the linting orchestrator at ${baseUrl}`);
    this.name = 'ConnectionError';
  }
}

export interface UploadDocumentRequest {
  content: string;
  format?: 'json' | 'yaml';
  metadata?: {
    fileName?: string;
    source?: string;
    tags?: string[];
  };
}

export interface UploadDocumentResponse {
  documentId: string;
  version: number;
  format: 'json' | 'yaml';
  message: string;
}

export interface LintRequest {
  documentId: string;
  rulesetName: string;
  rulesetVersion?: string;
  ruleOverrides?: Record<string, string>;
  failOnError?: boolean;
}

export interface LintResponse {
  jobId: string;
  message: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'timeout';
  progress?: {
    completed: number;
    total: number;
    currentRule?: string;
  };
  startedAt?: string;
  completedAt?: string;
}

export interface RulesetInfo {
  name: string;
  version: string;
  availableVersions: string[];
  defaultVersion: string;
  displayName: string;
  description: string;
  ruleCount: number;
  tags: string[];
  category?: string;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: string;
  mode?: 'standalone' | 'embedded' | 'companion' | 'mcp';
  server?: {
    port: number;
    host: string;
    startedAt: string;
  };
  runtime?: {
    nodeVersion: string;
    spectralCore?: string;
    spectralRulesets?: string;
    spectralCli?: string;
    resolver: string | null;
  };
}

export interface StatsResponse {
  totalJobs: number;
  jobsByStatus: {
    completed: number;
    failed: number;
    running: number;
  };
  cacheHitRate: number;
  rulesets: {
    name: string;
    version: string;
    jobCount: number;
  }[];
}

/**
 * Check if server is reachable and provide helpful error message
 */
async function checkServerConnection(baseUrl: string): Promise<void> {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }
  } catch (error: any) {
    if (error.name === 'TimeoutError' || error.cause?.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNRESET') {
      throw new ConnectionError(baseUrl);
    }
    throw error;
  }
}

export class SpectifyAPIClient {
  private lastSessionId: string | null = null;

  constructor(private baseUrl: string = 'http://localhost:3003') { }

  /**
   * Get last known session ID from server (from response headers)
   */
  getSessionId(): string | null {
    return this.lastSessionId;
  }

  /**
   * Get base server URL
   */
  getServerUrl(): string {
    return this.baseUrl;
  }

  /**
   * Upload OpenAPI document (standalone mode)
   */
  async uploadDocument(request: UploadDocumentRequest): Promise<UploadDocumentResponse> {
    await checkServerConnection(this.baseUrl);

    const response = await fetch(`${this.baseUrl}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    // Capture session ID from response header
    const sessionId = response.headers.get('X-Spectify-Session-Id');
    if (sessionId) {
      this.lastSessionId = sessionId;
    }

    if (!response.ok) {
      const error: any = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Failed to upload document: ${error.error || response.statusText}`);
    }

    return response.json() as Promise<UploadDocumentResponse>;
  }

  /**
   * Submit a lint job
   */
  async submitLint(request: LintRequest): Promise<LintResponse> {
    await checkServerConnection(this.baseUrl);

    const response = await fetch(`${this.baseUrl}/lint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    // Capture session ID from response header
    const sessionId = response.headers.get('X-Spectify-Session-Id');
    if (sessionId) {
      this.lastSessionId = sessionId;
    }

    if (!response.ok) {
      const error: any = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Failed to submit lint job: ${error.error || response.statusText}`);
    }

    return response.json() as Promise<LintResponse>;
  }

  /**
   * Check job status
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    await checkServerConnection(this.baseUrl);

    const response = await fetch(`${this.baseUrl}/lint/${jobId}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Job ${jobId} not found`);
      }
      throw new Error(`Failed to get job status: ${response.statusText}`);
    }

    return response.json() as Promise<JobStatusResponse>;
  }

  /**
   * Get job results
   */
  async getJobResults(jobId: string): Promise<LintJobResult> {
    const response = await fetch(`${this.baseUrl}/lint/${jobId}/results`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Job ${jobId} not found`);
      }
      if (response.status === 400) {
        const error: any = await response.json().catch(() => ({ error: 'Job not completed' }));
        throw new Error(error.error || 'Job not completed yet');
      }
      throw new Error(`Failed to get job results: ${response.statusText}`);
    }

    return response.json() as Promise<LintJobResult>;
  }

  /**
   * Poll job until completion
   */
  async pollJobUntilComplete(
    jobId: string,
    options: {
      interval?: number;
      timeout?: number;
      onProgress?: (status: JobStatusResponse) => void;
    } = {}
  ): Promise<JobStatusResponse> {
    const { interval = 1000, timeout = 300000, onProgress } = options;
    const startTime = Date.now();

    while (true) {
      const status = await this.getJobStatus(jobId);

      if (onProgress) {
        onProgress(status);
      }

      if (status.status === 'completed' || status.status === 'completed_with_errors' ||
          status.status === 'failed' || status.status === 'timeout') {
        return status;
      }

      if (Date.now() - startTime > timeout) {
        throw new Error('Timeout waiting for job completion');
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  /**
   * List available rulesets
   */
  async getRulesets(): Promise<RulesetInfo[]> {
    await checkServerConnection(this.baseUrl);

    const response = await fetch(`${this.baseUrl}/rulesets`);

    if (!response.ok) {
      throw new Error(`Failed to get rulesets: ${response.statusText}`);
    }

    const data: any = await response.json();
    // Server returns array directly, not wrapped in { rulesets: [] }
    return Array.isArray(data) ? data : (data.rulesets || []);
  }

  /**
   * Get detailed information about a specific ruleset including rules
   */
  async getRulesetDetails(name: string, version?: string): Promise<any> {
    await checkServerConnection(this.baseUrl);

    const url = version
      ? `${this.baseUrl}/rulesets/${name}?version=${version}`
      : `${this.baseUrl}/rulesets/${name}`;

    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Ruleset '${name}' not found`);
      }
      throw new Error(`Failed to get ruleset details: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get health status
   */
  async getHealth(): Promise<HealthResponse> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000)
      });
    } catch (error: any) {
      if (error.name === 'TimeoutError' || error.cause?.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNRESET') {
        throw new ConnectionError(this.baseUrl);
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }

    return response.json() as Promise<HealthResponse>;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<StatsResponse> {
    const response = await fetch(`${this.baseUrl}/stats`);

    if (!response.ok) {
      throw new Error(`Failed to get stats: ${response.statusText}`);
    }

    return response.json() as Promise<StatsResponse>;
  }

  /**
   * Delete cached results for a document
   */
  async deleteCachedResults(documentId: string): Promise<{ message: string }> {
    const response = await fetch(`${this.baseUrl}/cache/${documentId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Failed to delete cache: ${response.statusText}`);
    }

    return response.json() as Promise<{ message: string }>;
  }

  /**
   * Generate report for completed job
   */
  async generateReport(jobId: string, format: 'sarif' = 'sarif'): Promise<any> {
    await checkServerConnection(this.baseUrl);

    const response = await fetch(`${this.baseUrl}/lint/${jobId}/reports/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format }),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Job ${jobId} not found or not yet completed`);
      }
      if (response.status === 400) {
        const error: any = await response.json().catch(() => ({ error: 'Invalid request' }));
        throw new Error(error.error || 'Job not completed yet or invalid format');
      }
      throw new Error(`Failed to generate report: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * List jobs (lightweight - documentId only)
   */
  async listJobs(queryParams: Record<string, string> = {}): Promise<any> {
    const params = new URLSearchParams(queryParams);
    const response = await fetch(`${this.baseUrl}/lint/jobs?${params}`);

    if (!response.ok) {
      throw new Error(`Failed to list jobs: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * List jobs with document metadata (detailed)
   */
  async listJobsDetailed(queryParams: Record<string, string> = {}): Promise<any> {
    const params = new URLSearchParams(queryParams);
    const response = await fetch(`${this.baseUrl}/lint/jobs/details?${params}`);

    if (!response.ok) {
      throw new Error(`Failed to list jobs: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get Spectral CLI reproduction instructions for a completed job
   */
  async getReproductionInstructions(jobId: string): Promise<string> {
    await checkServerConnection(this.baseUrl);

    const response = await fetch(`${this.baseUrl}/lint/${jobId}/reproduce`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Job ${jobId} not found or not yet completed`);
      }
      if (response.status === 400) {
        const error: any = await response.json().catch(() => ({ error: 'Job not yet completed' }));
        throw new Error(error.error || 'Job not yet completed');
      }
      throw new Error(`Failed to get reproduction instructions: ${response.statusText}`);
    }

    return response.text();
  }
}
