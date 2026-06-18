// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Configuration loader for OpenAPI Lint Orchestrator
 * 
 * Zero-config by default with sensible defaults
 * Optional YAML file for advanced configuration
 * Environment variable overrides always available
 */

import 'dotenv/config';  // Load .env file before any config loading
import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import type { OrchestratorConfig, SpectifyMode } from './types.js';

// Resolve installation directory for default paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INSTALL_DIR = path.resolve(__dirname, '..');

/**
 * Resolve a resolver module name to its absolute file path.
 * Module lives in `{packageRoot}/resolvers/{name}.js`.
 * Returns `undefined` if `name` is falsy (disabled).
 */
export function resolveResolverPath(name: string | undefined): string | undefined {
  if (!name) return undefined;
  // INSTALL_DIR is the package root (one level above build/)
  return path.resolve(INSTALL_DIR, 'resolvers', `${name}.js`);
}

/**
 * Resolve the orchestrator home directory.
 * SPECTIFY_HOME env var overrides the default ~/.spectify.
 * Used as the base for all runtime data (uploads, reports, config).
 */
export function spectifyHome(): string {
  return process.env.SPECTIFY_HOME || path.join(os.homedir(), '.spectify');
}

/**
 * Default configuration (zero-config defaults)
 */
const DEFAULT_CONFIG: OrchestratorConfig = {
  server: {
    port: 3003,
    host: '0.0.0.0',
    maxDocumentSizeMB: 20  // 20MB default for large OpenAPI documents
  },
  documentStore: {
    type: 'local',
    baseDir: './uploads',
    fallbackHttp: 'http://localhost:3002'
  },
  workerPool: {
    minWorkersPerRuleset: 1,
    maxWorkersPerRuleset: 2,
    totalMaxWorkers: 15,
    taskTimeout: 30000,
    maxRetries: 2,
    workerWaitTimeout: 30000,  // Max ms to wait for a busy worker to become ready
    scaleUpThreshold: 10,
    scaleDownThreshold: 1,
    exponentialBackoff: {
      initialDelay: 1000,
      maxDelay: 30000,
      multiplier: 2
    },
    documentCache: {
      enabled: true,
      maxDocumentsPerWorker: 1,
      maxCacheSizePerWorker: 52428800, // 50MB
      evictAfterMinutes: 5
    }
  },
  rulesets: {
    directory: path.join(INSTALL_DIR, 'rulesets'),
    defaultVersion: 'latest',
    cacheEnabled: true
  },
  storage: {
    type: 'memory'
  },
  logging: {
    level: 'info',
    format: 'json',
    destination: 'console'
  },
  resolver: 'ignore-external-refs'
};

/**
 * Load configuration from optional file or use defaults
 */
export async function loadConfig(configPath?: string): Promise<OrchestratorConfig> {
  let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)); // Deep clone

  // If config file provided via --config flag, load it
  if (configPath) {
    try {
      const configContent = await readFile(configPath, 'utf-8');
      const fileConfig = parseYaml(configContent);
      config = mergeConfig(config, fileConfig);
    } catch (error) {
      console.warn(`Warning: Could not load config file ${configPath}, using defaults`);
    }
  }

  // Apply environment variable overrides (always available)
  applyEnvOverrides(config);

  // Auto-detect CPU-based limits
  applyAutoDetection(config);

  // Resolve rulesets directory relative to binary location if relative path
  resolveRulesetsDirectory(config);

  return config;
}

/**
 * Deep merge two configuration objects
 */
function mergeConfig(base: any, override: any): any {
  const result = { ...base };

  for (const key in override) {
    if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = mergeConfig(base[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }

  return result;
}

/**
 * Resolve rulesets directory to absolute path
 * If relative path, resolve relative to the binary location (build/ directory)
 * This allows spectifyd to run from any directory
 */
function resolveRulesetsDirectory(config: any): void {
  const rulesetsDir = config.rulesets.directory;

  // If already absolute, leave it
  if (path.isAbsolute(rulesetsDir)) {
    return;
  }

  // Get the directory containing this config module
  // In production: /path/to/spectify/build/config.js
  // We want: /path/to/spectify/rulesets
  const moduleDir = new URL('.', import.meta.url).pathname;
  const projectRoot = path.resolve(moduleDir, '..');
  const absoluteRulesetsDir = path.resolve(projectRoot, rulesetsDir);

  config.rulesets.directory = absoluteRulesetsDir;
}

/**
 * Get default pending reports directory based on environment
 * Production: ~/.spectify/reports/pending
 * Development: ./pending-reports (local to project)
 */
function getPendingDir(): string {
  if (process.env.SPECTIFYD_REPORTS_PENDING_DIR) {
    return process.env.SPECTIFYD_REPORTS_PENDING_DIR;
  }
  return path.join(spectifyHome(), 'reports', 'pending');
}

/**
 * Get reports-service mode with auto-detection from deployment context
 */
function getReportServiceMode(deploymentMode: SpectifyMode): SpectifyMode {
  return deploymentMode;
}

/**
 * Determine if the daemon should stop on linting-reporting-service unavailability
 * Mode-based defaults:
 * - Light mode: false (optional, continue if unavailable)
 * - Companion/Standalone: true (required, fail if unavailable)
 */
function getStopIfUnavailable(mode: SpectifyMode): boolean {
  // Environment override takes precedence
  if (process.env.SPECTIFYD_REPORTS_STOP_IF_UNAVAILABLE !== undefined) {
    return process.env.SPECTIFYD_REPORTS_STOP_IF_UNAVAILABLE === 'true';
  }

  // Mode-based defaults:
  // - Light mode: optional (continue if unavailable)
  // - Companion/Standalone: required (fail if unavailable)
  return mode === 'companion' || mode === 'standalone';
}

/**
 * Apply environment variable overrides
 *
 * Daemon-side env vars are prefixed SPECTIFYD_*. Client-side connection
 * config for the linting reporting service is prefixed
 * SPECTIFYD_REPORTS_* (the reports service itself reads SPECTIFYR_*).
 */
function applyEnvOverrides(config: any): void {
  // Rulesets directory (allow override via environment)
  if (process.env.SPECTIFYD_RULESETS_DIR) {
    config.rulesets.directory = process.env.SPECTIFYD_RULESETS_DIR;
  }

  // Server configuration
  if (process.env.SPECTIFYD_PORT) {
    config.server.port = parseInt(process.env.SPECTIFYD_PORT, 10);
  }
  if (process.env.SPECTIFYD_HOST) {
    config.server.host = process.env.SPECTIFYD_HOST;
  }

  // Document store
  if (process.env.SPECTIFYD_DOCUMENT_STORE_TYPE) {
    config.documentStore.type = process.env.SPECTIFYD_DOCUMENT_STORE_TYPE;
  }
  if (process.env.SPECTIFYD_DOCUMENT_STORE_DIR) {
    config.documentStore.baseDir = process.env.SPECTIFYD_DOCUMENT_STORE_DIR;
  } else {
    // Default to SPECTIFY_HOME/uploads rather than ./uploads
    config.documentStore.baseDir = path.join(spectifyHome(), 'uploads');
  }
  if (process.env.SPECTIFYD_DOCUMENT_STORE_FALLBACK_HTTP) {
    config.documentStore.fallbackHttp = process.env.SPECTIFYD_DOCUMENT_STORE_FALLBACK_HTTP;
  }

  // Worker pool
  if (process.env.SPECTIFYD_MIN_WORKERS_PER_RULESET) {
    config.workerPool.minWorkersPerRuleset = parseInt(process.env.SPECTIFYD_MIN_WORKERS_PER_RULESET, 10);
  }

  if (process.env.SPECTIFYD_MAX_WORKERS_PER_RULESET) {
    config.workerPool.maxWorkersPerRuleset = parseInt(process.env.SPECTIFYD_MAX_WORKERS_PER_RULESET, 10);
  }

  if (process.env.SPECTIFYD_TOTAL_MAX_WORKERS) {
    config.workerPool.totalMaxWorkers = parseInt(process.env.SPECTIFYD_TOTAL_MAX_WORKERS, 10);
  }

  if (process.env.SPECTIFYD_WORKER_TIMEOUT) {
    config.workerPool.taskTimeout = parseInt(process.env.SPECTIFYD_WORKER_TIMEOUT, 10);
  }

  if (process.env.SPECTIFYD_WORKER_WAIT_TIMEOUT) {
    config.workerPool.workerWaitTimeout = parseInt(process.env.SPECTIFYD_WORKER_WAIT_TIMEOUT, 10);
  }

  // Document cache
  if (process.env.SPECTIFYD_DOCUMENT_CACHE_ENABLED) {
    config.workerPool.documentCache.enabled = process.env.SPECTIFYD_DOCUMENT_CACHE_ENABLED === 'true';
  }

  // Storage
  if (process.env.SPECTIFYD_STORAGE_TYPE) {
    config.storage.type = process.env.SPECTIFYD_STORAGE_TYPE;
  }

  if (process.env.SPECTIFYD_REDIS_URL) {
    config.storage.connectionString = process.env.SPECTIFYD_REDIS_URL;
  }

  // Logging
  if (process.env.SPECTIFYD_LOG_LEVEL) {
    config.logging.level = process.env.SPECTIFYD_LOG_LEVEL;
  }

  if (process.env.SPECTIFYD_LOG_FORMAT) {
    config.logging.format = process.env.SPECTIFYD_LOG_FORMAT;
  }

  // Resolver (custom $ref resolver module name)
  if (process.env.SPECTIFYD_RESOLVER !== undefined) {
    config.resolver = process.env.SPECTIFYD_RESOLVER;
  }

  // Linting reporting service integration (client-side connection config)
  if (process.env.SPECTIFYD_REPORTS_ENABLED === 'true') {
    // Get deployment mode from config (will be set by factory functions)
    const deploymentMode = (config.mode as SpectifyMode) || 'standalone';
    const mode = getReportServiceMode(deploymentMode);

    config.reportService = {
      enabled: true,
      url: process.env.SPECTIFYD_REPORTS_URL || 'http://localhost:3010',
      apiKey: process.env.SPECTIFYD_REPORTS_API_KEY || '',
      mode,
      timeout: parseInt(process.env.SPECTIFYD_REPORTS_TIMEOUT || '5000', 10),
      maxRetries: parseInt(process.env.SPECTIFYD_REPORTS_MAX_RETRIES || '3', 10),
      baseRetryDelay: parseInt(process.env.SPECTIFYD_REPORTS_BASE_RETRY_DELAY || '1000', 10),
      pendingDir: getPendingDir(),
      enableRetryJob: process.env.SPECTIFYD_REPORTS_RETRY_JOB_ENABLED !== 'false',
      retryJobInterval: parseInt(process.env.SPECTIFYD_REPORTS_RETRY_JOB_INTERVAL || '300000', 10),
      stopIfUnavailable: getStopIfUnavailable(mode),
    };
  } else if (process.env.SPECTIFYD_REPORTS_ENABLED === 'false') {
    config.reportService = undefined;
  }
  // If SPECTIFYD_REPORTS_ENABLED not set, leave as undefined (not configured)
}

/**
 * Auto-detect optimal worker pool size based on CPU cores
 */
function applyAutoDetection(config: any): void {
  const cpuCount = os.cpus().length;

  // Auto-detect total max workers if not explicitly set
  // Use 75% of CPU cores, capped at configured max
  const autoDetectedMax = Math.max(4, Math.floor(cpuCount * 0.75));
  const configuredMax = config.workerPool.totalMaxWorkers || 15;

  // Use the minimum of auto-detected and configured
  config.workerPool.totalMaxWorkers = Math.min(autoDetectedMax, configuredMax);

  // Adjust max workers per ruleset to be reasonable
  const maxPerRuleset = config.workerPool.maxWorkersPerRuleset || 2;

  // Ensure we can support at least 3-4 rulesets concurrently
  const minTotalForRulesets = maxPerRuleset * 4;
  if (config.workerPool.totalMaxWorkers < minTotalForRulesets) {
    console.warn(
      `Warning: totalMaxWorkers (${config.workerPool.totalMaxWorkers}) may be too low. ` +
      `Recommended: at least ${minTotalForRulesets} for ${maxPerRuleset} workers per ruleset × 4 rulesets`
    );
  }
}

/**
 * Validate configuration
 */
export function validateConfig(config: OrchestratorConfig): void {
  if (config.server.port < 1 || config.server.port > 65535) {
    throw new Error(`Invalid port: ${config.server.port}`);
  }

  if (config.workerPool.minWorkersPerRuleset < 1) {
    throw new Error('minWorkersPerRuleset must be at least 1');
  }

  if (config.workerPool.maxWorkersPerRuleset < config.workerPool.minWorkersPerRuleset) {
    throw new Error('maxWorkersPerRuleset must be >= minWorkersPerRuleset');
  }

  if (config.workerPool.totalMaxWorkers < config.workerPool.maxWorkersPerRuleset) {
    throw new Error('totalMaxWorkers must be >= maxWorkersPerRuleset');
  }

  if (config.workerPool.taskTimeout < 1000) {
    throw new Error('taskTimeout must be at least 1000ms');
  }

  if (config.workerPool.workerWaitTimeout < 1000) {
    throw new Error('workerWaitTimeout must be at least 1000ms');
  }

  if (!['memory', 'redis', 'custom'].includes(config.storage.type)) {
    throw new Error(`Invalid storage type: ${config.storage.type}`);
  }

  if (!['local', 'passthrough', 'filesystem', 'http', 'hybrid'].includes(config.documentStore.type)) {
    throw new Error(`Invalid documentStore type: ${config.documentStore.type}`);
  }
}

/**
 * Get configuration summary for logging
 */
export function getConfigSummary(config: OrchestratorConfig): Record<string, any> {
  return {
    port: config.server.port,
    workerPool: {
      minPerRuleset: config.workerPool.minWorkersPerRuleset,
      maxPerRuleset: config.workerPool.maxWorkersPerRuleset,
      totalMax: config.workerPool.totalMaxWorkers,
      timeout: config.workerPool.taskTimeout,
      cacheEnabled: config.workerPool.documentCache.enabled
    },
    storage: config.storage.type,
    documentStore: config.documentStore.type,
    logging: config.logging.level
  };
}

/**
 * Create lightweight configuration for embedded mode
 * 
 * Used by CLI when starting embedded server
 * Optimized for single-user, developer laptop use
 */
export function createEmbeddedModeConfig(overrides?: Partial<OrchestratorConfig>): OrchestratorConfig {
  const homeDir = os.homedir();

  const config: OrchestratorConfig = {
    mode: 'embedded',
    server: {
      port: 3005,  // Separate port for embedded mode (avoid conflict with standalone)
      host: '0.0.0.0',
      maxDocumentSizeMB: 20
    },
    documentStore: {
      type: 'local',
      baseDir: `${homeDir}/.spectify/uploads`,
      fallbackHttp: 'http://localhost:3002'
    },
    workerPool: {
      minWorkersPerRuleset: 1,
      maxWorkersPerRuleset: 2,
      totalMaxWorkers: 10,  // Lighter footprint for laptops
      taskTimeout: 30000,
      maxRetries: 2,
      workerWaitTimeout: 30000,
      scaleUpThreshold: 10,
      scaleDownThreshold: 1,
      exponentialBackoff: {
        initialDelay: 1000,
        maxDelay: 30000,
        multiplier: 2
      },
      documentCache: {
        enabled: true,
        maxDocumentsPerWorker: 1,
        maxCacheSizePerWorker: 52428800, // 50MB
        evictAfterMinutes: 5
      }
    },
    rulesets: {
      directory: path.join(INSTALL_DIR, 'rulesets'),
      defaultVersion: 'latest',
      cacheEnabled: true
    },
    storage: {
      type: 'memory'  // No persistence needed in embedded mode
    },
    logging: {
      level: 'info',
      format: 'text',
      destination: 'console'
    }
  };

  // Apply overrides
  if (overrides) {
    return mergeConfig(config, overrides);
  }

  return config;
}

/**
 * Create production configuration for standalone server mode
 * 
 * Used when running spectifyd as dedicated process
 * Optimized for production, multi-user, always-on deployments
 * Document store defaults to ~/.spectify/uploads (user home directory)
 */
export function createStandaloneModeConfig(overrides?: Partial<OrchestratorConfig>): OrchestratorConfig {
  const homeDir = os.homedir();

  const config: OrchestratorConfig = {
    mode: 'standalone',
    server: {
      port: 3003,
      host: '0.0.0.0',
      maxDocumentSizeMB: 20
    },
    documentStore: {
      type: 'local',
      baseDir: `${homeDir}/.spectify/uploads`,  // Default to user's home directory
      fallbackHttp: 'http://localhost:3002'
    },
    workerPool: {
      minWorkersPerRuleset: 2,
      maxWorkersPerRuleset: 10,
      totalMaxWorkers: 40,  // Production-grade capacity (see docs/SCALABILITY.md)
      taskTimeout: 30000,
      maxRetries: 3,
      workerWaitTimeout: 30000,
      scaleUpThreshold: 10,
      scaleDownThreshold: 2,
      exponentialBackoff: {
        initialDelay: 1000,
        maxDelay: 30000,
        multiplier: 2
      },
      documentCache: {
        enabled: true,
        maxDocumentsPerWorker: 1,
        maxCacheSizePerWorker: 52428800, // 50MB
        evictAfterMinutes: 10
      }
    },
    rulesets: {
      directory: path.join(INSTALL_DIR, 'rulesets'),
      defaultVersion: 'latest',
      cacheEnabled: true
    },
    storage: {
      type: 'memory'  // Can be overridden to 'redis' for persistence
    },
    logging: {
      level: 'info',
      format: 'json',
      destination: 'console'
    }
  };

  // Apply overrides
  if (overrides) {
    return mergeConfig(config, overrides);
  }

  return config;
}

/**
 * Create configuration for MCP companion mode
 * 
 * Used when the orchestrator is started by MCP OpenAPI Analyzer
 * Shares MCP's document store, lighter resource footprint
 * Document store path MUST be provided explicitly (no default)
 */
export function createCompanionModeConfig(overrides?: Partial<OrchestratorConfig>): OrchestratorConfig {
  const config: OrchestratorConfig = {
    mode: 'companion',
    server: {
      port: 3004,  // Use 3004 to avoid conflicts with standalone (3003)
      host: '0.0.0.0',
      maxDocumentSizeMB: 20
    },
    documentStore: {
      type: 'passthrough',
      baseDir: '',  // MUST be provided via CLI or environment - no default!
      fallbackHttp: 'http://localhost:3002'
    },
    workerPool: {
      minWorkersPerRuleset: 2,
      maxWorkersPerRuleset: 8,
      totalMaxWorkers: 30,  // Scaled up for batch workloads (see docs/SCALABILITY.md)
      taskTimeout: 30000,
      maxRetries: 2,
      workerWaitTimeout: 30000,
      scaleUpThreshold: 10,
      scaleDownThreshold: 1,
      exponentialBackoff: {
        initialDelay: 1000,
        maxDelay: 30000,
        multiplier: 2
      },
      documentCache: {
        enabled: true,
        maxDocumentsPerWorker: 1,
        maxCacheSizePerWorker: 52428800, // 50MB
        evictAfterMinutes: 5
      }
    },
    rulesets: {
      directory: path.join(INSTALL_DIR, 'rulesets'),
      defaultVersion: 'latest',
      cacheEnabled: true
    },
    storage: {
      type: 'memory'  // MCP handles persistence
    },
    logging: {
      level: 'debug',  // More verbose for troubleshooting
      format: 'json',
      destination: 'console'
    }
  };

  // Apply overrides
  if (overrides) {
    return mergeConfig(config, overrides);
  }

  return config;
}
