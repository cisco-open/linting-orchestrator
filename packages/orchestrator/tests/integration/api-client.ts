/**
 * API Client for Integration Tests
 * 
 * Helper utilities for interacting with MCP server and Spectify orchestrator APIs.
 */

export interface UploadResponse {
  documentId: string;
  message?: string;
}

export interface LintJobResponse {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
}

export interface JobStatusResponse {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: {
    completed: number;
    total: number;
  };
  startTime?: string;
  endTime?: string;
  error?: string;
}

export interface LintResult {
  jobId: string;
  documentId: string;
  rulesetName: string;
  rulesetVersion: string;
  status: 'completed' | 'failed';
  results: Array<{
    code: string;
    message: string;
    severity: number;
    path: string[];
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  }>
  summary: {
    totalIssues: number;
    errors: number;
    warnings: number;
    infos: number;
    hints: number;
  };
  executionTime?: number;
}

export interface RulesetInfo {
  name: string;
  version: string;
  defaultVersion: string;
  description?: string;
  availableVersions: string[];
}

export interface OrchestratorStats {
  jobs: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
  capacity: {
    activeJobs: number;
    maxConcurrentJobs: number;
    utilizationPercent: number;
  };
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
  };
  workers: {
    total: number;
    active: number;
    idle: number;
  };
}

/**
 * MCP Server API Client
 */
export class MCPClient {
  constructor(private baseUrl: string = 'http://localhost:3001') {}

  /**
   * Upload an OpenAPI document
   */
  async uploadDocument(content: object): Promise<string> {
    const response = await fetch(`${this.baseUrl}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Upload failed: ${response.status} ${error}`);
    }

    const data = await response.json() as UploadResponse;
    return data.documentId;
  }

  /**
   * Health check
   */
  async health(): Promise<{ status: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    
    return response.json();
  }
}

/**
 * Spectify Orchestrator API Client
 */
export class SpectifyClient {
  constructor(private baseUrl: string = 'http://localhost:3003') {}

  /**
   * Submit a lint job
   */
  async submitLintJob(request: {
    documentId: string;
    rulesetName: string;
    rulesetVersion?: string;
    forceRun?: boolean;
  }): Promise<string> {
    // Transform to match API structure
    const apiRequest = {
      documentId: request.documentId,
      rulesetName: request.rulesetName,
      ...(request.rulesetVersion && { rulesetVersion: request.rulesetVersion }),
      ...(request.forceRun !== undefined && {
        options: { forceRun: request.forceRun }
      })
    };

    const response = await fetch(`${this.baseUrl}/lint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiRequest)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Submit job failed: ${response.status} ${error}`);
    }

    const data = await response.json() as LintJobResponse;
    return data.jobId;
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const response = await fetch(`${this.baseUrl}/lint/${jobId}`);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Get status failed: ${response.status} ${error}`);
    }

    return response.json();
  }

  /**
   * Get job results
   */
  async getJobResults(jobId: string): Promise<LintResult> {
    const response = await fetch(`${this.baseUrl}/lint/${jobId}/results`);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Get results failed: ${response.status} ${error}`);
    }

    return response.json();
  }

  /**
   * Wait for job to complete
   */
  async waitForJobComplete(
    jobId: string,
    timeout: number = 30000,
    pollInterval: number = 500
  ): Promise<JobStatusResponse> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const status = await this.getJobStatus(jobId);
      
      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    throw new Error(`Job ${jobId} did not complete within ${timeout}ms`);
  }

  /**
   * List available rulesets
   */
  async listRulesets(): Promise<RulesetInfo[]> {
    const response = await fetch(`${this.baseUrl}/rulesets`);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`List rulesets failed: ${response.status} ${error}`);
    }

    return response.json();
  }

  /**
   * Get orchestrator statistics
   */
  async getStats(): Promise<OrchestratorStats> {
    const response = await fetch(`${this.baseUrl}/stats`);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Get stats failed: ${response.status} ${error}`);
    }

    return response.json();
  }

  /**
   * Invalidate cache for a document
   */
  async invalidateCache(documentId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/cache/${documentId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Invalidate cache failed: ${response.status} ${error}`);
    }
  }

  /**
   * Health check
   */
  async health(): Promise<{ status: string; stats?: OrchestratorStats }> {
    const response = await fetch(`${this.baseUrl}/health`);
    
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    
    return response.json();
  }
}

/**
 * Helper: Load OpenAPI document from file
 */
export async function loadOpenAPIDocument(filePath: string): Promise<object> {
  const fs = await import('fs/promises');
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}
