/**
 * Service Utilities for Integration Tests
 * 
 * Utilities to start, stop, and manage the MCP server and Spectify orchestrator
 * during integration testing.
 */

import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { setTimeout } from 'timers/promises';

export interface ServiceConfig {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  port: number;
  healthEndpoint: string;
  startupTimeout?: number; // milliseconds
}

export interface ServiceHandle {
  name: string;
  process: ChildProcess;
  port: number;
  stop: () => Promise<void>;
}

/**
 * Start a service and wait for it to be ready
 */
export async function startService(config: ServiceConfig): Promise<ServiceHandle> {
  const {
    name,
    command,
    args,
    cwd,
    env = {},
    port,
    healthEndpoint,
    startupTimeout = 30000
  } = config;

  console.log(`[${name}] Starting service on port ${port}...`);

  // Spawn the process
  const proc = spawn(command, args, {
    cwd: resolve(cwd),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Capture output for debugging
  const output: string[] = [];
  proc.stdout?.on('data', (data) => {
    const line = data.toString();
    output.push(line);
    if (process.env.DEBUG_SERVICES) {
      console.log(`[${name}] ${line.trim()}`);
    }
  });

  proc.stderr?.on('data', (data) => {
    const line = data.toString();
    output.push(line);
    if (process.env.DEBUG_SERVICES || line.toLowerCase().includes('error')) {
      console.error(`[${name}] ${line.trim()}`);
    }
  });

  // Handle process errors
  proc.on('error', (error) => {
    console.error(`[${name}] Process error:`, error);
  });

  // Wait for service to be ready
  const ready = await waitForService(name, healthEndpoint, startupTimeout);
  
  if (!ready) {
    proc.kill();
    throw new Error(
      `[${name}] Failed to start within ${startupTimeout}ms.\n` +
      `Last output:\n${output.slice(-20).join('')}`
    );
  }

  console.log(`[${name}] Service ready! ✓`);

  // Return handle
  return {
    name,
    process: proc,
    port,
    stop: async () => {
      console.log(`[${name}] Stopping service...`);
      proc.kill('SIGTERM');
      
      // Give it 5 seconds to shut down gracefully
      await setTimeout(5000);
      
      if (!proc.killed) {
        console.warn(`[${name}] Force killing...`);
        proc.kill('SIGKILL');
      }
      
      console.log(`[${name}] Stopped ✓`);
    }
  };
}

/**
 * Wait for a service to respond to health checks
 */
async function waitForService(
  name: string,
  url: string,
  timeout: number
): Promise<boolean> {
  const startTime = Date.now();
  let attempts = 0;
  
  while (Date.now() - startTime < timeout) {
    attempts++;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });
      
      if (response.ok) {
        console.log(`[${name}] Health check passed after ${attempts} attempts`);
        return true;
      }
    } catch (error) {
      // Service not ready yet, continue waiting
    }
    
    // Wait 500ms before next attempt
    await setTimeout(500);
  }
  
  return false;
}

/**
 * Stop all services
 */
export async function stopAllServices(services: ServiceHandle[]): Promise<void> {
  console.log('Stopping all services...');
  
  // Stop in reverse order
  for (const service of services.reverse()) {
    await service.stop();
  }
  
  console.log('All services stopped ✓');
}

/**
 * MCP Server configuration
 */
export function getMCPServerConfig(): ServiceConfig {
  return {
    name: 'MCP-Server',
    command: 'npm',
    args: ['start'],
    cwd: './mcp-openapi-analysis',
    env: {
      PORT: '3001',
      NODE_ENV: 'test'
    },
    port: 3001,
    healthEndpoint: 'http://localhost:3001/health'
  };
}

/**
 * Check if MCP server is running (external dependency)
 */
export async function checkMCPServer(url: string = 'http://localhost:3002/health'): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Assert MCP server is running or throw helpful error
 */
export async function requireMCPServer(): Promise<void> {
  const mcpRunning = await checkMCPServer();
  
  if (!mcpRunning) {
    throw new Error(
      '\n' +
      '❌ MCP OpenAPI Analyzer not running on http://localhost:3002\n' +
      '\n' +
      'Spectify integration tests require the MCP server (external dependency).\n' +
      '\n' +
      'Start the MCP server with:\n' +
      '  cd mcp-openapi-analysis\n' +
      '  npm install && npm run build\n' +
      '  npm start\n' +
      '\n' +
      'Or configure a mock document store for offline testing:\n' +
      '  export DOCUMENT_STORE_DIR=./tests/fixtures/mock-uploads\n' +
      '\n' +
      'See docs/MCP_OPENAPI_ANALYZER_INTEGRATION.md for details.\n'
    );
  }
  
  console.log('✓ MCP server is running on http://localhost:3002\n');
}

/**
 * Spectify Orchestrator configuration
 */
export function getOrchestratorConfig(): ServiceConfig {
  return {
    name: 'Spectify-Orchestrator',
    command: 'npm',
    args: ['start'],
    cwd: '.',
    env: {
      ORCHESTRATOR_PORT: '3003',
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      DOCUMENT_STORE_DIR: '../mcp-openapi-analysis/datastore/documents',
      MIN_WORKERS_PER_RULESET: '1',
      MAX_WORKERS_PER_RULESET: '2',
      TOTAL_MAX_WORKERS: '6'
    },
    port: 3003,
    healthEndpoint: 'http://localhost:3003/health',
    startupTimeout: 60000 // Spectral loading can take time
  };
}

/**
 * Helper: Check if port is available
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1000)
    });
    return false; // Port is in use
  } catch {
    return true; // Port is available
  }
}
