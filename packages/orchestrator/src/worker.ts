// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Worker Thread Implementation
 * 
 * Each worker is dedicated to a specific ruleset and maintains:
 * - Pre-loaded Spectral ruleset for fast execution
 * - Document cache (LRU, 1 document) for repeated linting
 * - Health monitoring and status reporting
 * 
 * Architecture:
 * - Zero-copy: Receives document file paths, not content
 * - Stateful: Pre-loaded ruleset stays in memory
 * - Cached: Last document cached for reuse
 * 
 * @module worker
 */

import { parentPort, workerData } from 'worker_threads';
import pkg from '@stoplight/spectral-core';
const { Spectral, Ruleset } = pkg;
// @ts-ignore - ESM export resolution issue with TypeScript
import { bundleAndLoadRuleset } from '@stoplight/spectral-ruleset-bundler/with-loader';
import type { ISpectralDiagnostic } from '@stoplight/spectral-core';
import fs from 'fs/promises';
import { pathToFileURL } from 'url';

// ============================================
// Worker Initialization Data
// ============================================

interface WorkerInitData {
  workerId: string;
  rulesetName: string;
  rulesetVersion: string;
  rulesetPath: string;  // Absolute path to ruleset file
  rulesetLoader: 'bundler' | 'native';  // Which loader mechanism to use
  resolverPath?: string; // Absolute path to custom $ref resolver module
  config: {
    documentCache: {
      enabled: boolean;
      maxDocumentsPerWorker: number;
      maxCacheSizePerWorker: number;
      evictAfterMinutes: number;
    };
    taskTimeout: number;
  };
}

// ============================================
// Message Types
// ============================================

interface IncomingMessage {
  type: 'execute' | 'evict-cache' | 'shutdown' | 'ping';
  payload?: any;
}

interface ExecuteMessage extends IncomingMessage {
  type: 'execute';
  payload: {
    taskId: string;
    documentId: string;
    documentPath: string;
    timeout?: number;
    ruleOverrides?: Record<string, string>;
  };
}

interface OutgoingMessage {
  type: 'ready' | 'status' | 'result' | 'error' | 'pong';
  payload?: any;
}

// ============================================
// Worker State
// ============================================

let spectral: any = null; // Spectral instance (any to avoid CommonJS/ESM type issues)
let initData: WorkerInitData;
let workerStatus: 'initializing' | 'ready' | 'busy' | 'error' | 'terminated' = 'initializing';

// Document cache (LRU, 1 document)
let cachedDocument: any = null;
let cachedDocumentId: string | null = null;
let cachedAt: Date | null = null;
let cacheSize: number = 0;

// Performance tracking
let taskCount = 0;
let totalExecutionTime = 0;
let lastHeartbeat = new Date();

// ============================================
// Initialization
// ============================================

/**
 * Initialize worker with pre-loaded Spectral ruleset
 */
async function initialize(): Promise<void> {
  try {
    initData = workerData as WorkerInitData;

    if (!initData || !initData.workerId || !initData.rulesetPath) {
      throw new Error('Invalid worker initialization data');
    }

    // Validate ruleset file exists
    try {
      await fs.access(initData.rulesetPath);
    } catch (error) {
      throw new Error(`Ruleset file not found: ${initData.rulesetPath}`);
    }

    // Load Spectral ruleset using whichever mechanism the catalogue
    // entry's `loader` field selected. Defaults to `bundler` if absent.
    // See ruleset-loader.ts for the same two-branch logic and rationale.
    let ruleset: any;
    const loaderKind = initData.rulesetLoader ?? 'bundler';

    if (loaderKind === 'native') {
      if (!/\.(js|cjs|mjs)$/i.test(initData.rulesetPath)) {
        throw new Error(
          `loader: native only supports .js / .cjs / .mjs entrypoints, got: ${initData.rulesetPath}`
        );
      }
      const mod = await import(pathToFileURL(initData.rulesetPath).href);
      const def = extractRulesetDef(mod);
      if (!def || (!def.rules && !def.extends && !def.overrides)) {
        throw new Error(
          `module at ${initData.rulesetPath} did not export a Spectral ruleset definition`
        );
      }
      ruleset = new Ruleset(def as any, { source: initData.rulesetPath });
    } else {
      ruleset = await bundleAndLoadRuleset(initData.rulesetPath, {
        fs: { promises: fs },
        fetch: fetch as any
      });
    }

    // Load custom resolver if configured
    let resolverOpts: Record<string, any> = {};
    if (initData.resolverPath) {
      try {
        const resolverModule = await import(pathToFileURL(initData.resolverPath).href);
        const resolver = resolverModule.default ?? resolverModule;
        resolverOpts = { resolver };
      } catch (err: any) {
        throw new Error(`Failed to load resolver from ${initData.resolverPath}: ${err.message}`);
      }
    }

    // Initialize Spectral with pre-loaded ruleset (and optional custom resolver)
    spectral = new Spectral(resolverOpts);
    spectral.setRuleset(ruleset as any);

    workerStatus = 'ready';
    lastHeartbeat = new Date();

    // Notify main thread that worker is ready
    sendMessage({
      type: 'ready',
      payload: {
        workerId: initData.workerId,
        rulesetName: initData.rulesetName,
        rulesetVersion: initData.rulesetVersion,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    workerStatus = 'error';
    sendMessage({
      type: 'error',
      payload: {
        workerId: initData?.workerId || 'unknown',
        phase: 'initialization',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }
    });
    throw error;
  }
}

// ============================================
// Task Execution
// ============================================

/**
 * Execute Spectral rules on a document
 */
async function executeTask(msg: ExecuteMessage): Promise<void> {
  const { taskId, documentId, documentPath, timeout, ruleOverrides } = msg.payload;
  const startTime = Date.now();

  try {
    if (!spectral) {
      throw new Error('Spectral not initialized');
    }

    workerStatus = 'busy';
    sendStatus();

    // Check if document is in cache BEFORE loading
    const wasCacheHit = cachedDocumentId === documentId;

    // Load document (from cache or filesystem)
    const document = await loadDocument(documentId, documentPath);

    // Execute Spectral rules with timeout
    const executionTimeout = timeout || initData.config.taskTimeout;
    const results = await executeWithTimeout(
      () => spectral!.run(document),
      executionTimeout
    ) as any; // Spectral returns unknown in some contexts

    // Update performance metrics
    const executionTime = Date.now() - startTime;
    taskCount++;
    totalExecutionTime += executionTime;
    lastHeartbeat = new Date();

    // Send results back to main thread
    workerStatus = 'ready';
    let formattedResults = (results || []).map(formatDiagnostic);

    // Apply rule overrides (post-filter): exclude 'off' rules, remap severities
    if (ruleOverrides && Object.keys(ruleOverrides).length > 0) {
      formattedResults = applyRuleOverrides(formattedResults, ruleOverrides);
    }

    sendMessage({
      type: 'result',
      payload: {
        taskId,
        success: true,
        results: formattedResults,
        executionTime,
        cacheHit: wasCacheHit,
        timestamp: new Date().toISOString()
      }
    });

    sendStatus();

  } catch (error) {
    const executionTime = Date.now() - startTime;
    workerStatus = 'ready';

    sendMessage({
      type: 'result',
      payload: {
        taskId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        timestamp: new Date().toISOString()
      }
    });

    sendStatus();
  }
}

/**
 * Load document from cache or filesystem (zero-copy architecture)
 */
async function loadDocument(documentId: string, documentPath: string): Promise<any> {
  // Check cache first
  if (initData.config.documentCache.enabled && cachedDocumentId === documentId) {
    // Check if cache is still valid
    if (cachedAt && initData.config.documentCache.evictAfterMinutes > 0) {
      const cacheAge = Date.now() - cachedAt.getTime();
      const maxAge = initData.config.documentCache.evictAfterMinutes * 60 * 1000;

      if (cacheAge > maxAge) {
        // Cache expired, evict
        evictCache();
      } else {
        // Cache hit! Return cached document
        return cachedDocument;
      }
    } else {
      // Cache hit! Return cached document
      return cachedDocument;
    }
  }

  // Cache miss - load from filesystem
  try {
    const content = await fs.readFile(documentPath, 'utf-8');
    const document = JSON.parse(content);

    // Cache document if enabled
    if (initData.config.documentCache.enabled) {
      cacheDocument(documentId, document);
    }

    return document;

  } catch (error) {
    throw new Error(`Failed to load document from ${documentPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Cache document in memory (LRU with 1 slot)
 */
function cacheDocument(documentId: string, document: any): void {
  // Evict old cache if exists
  if (cachedDocumentId !== null) {
    evictCache();
  }

  // Calculate document size (rough estimate)
  const docSize = JSON.stringify(document).length;

  // Check size limit
  if (docSize > initData.config.documentCache.maxCacheSizePerWorker) {
    // Document too large to cache
    return;
  }

  // Cache document
  cachedDocument = document;
  cachedDocumentId = documentId;
  cachedAt = new Date();
  cacheSize = docSize;
}

/**
 * Evict cached document
 */
function evictCache(): void {
  cachedDocument = null;
  cachedDocumentId = null;
  cachedAt = null;
  cacheSize = 0;
}

/**
 * Execute function with timeout
 */
async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      const error = new Error(`Execution timeout after ${timeoutMs}ms`);
      (error as any).code = 'TIMEOUT';  // Mark as timeout error
      reject(error);
    }, timeoutMs);

    fn()
      .then(result => {
        if (!timedOut) {
          clearTimeout(timer);
          resolve(result);
        }
      })
      .catch(error => {
        if (!timedOut) {
          clearTimeout(timer);
          reject(error);
        }
      });
  });
}

/**
 * Format Spectral diagnostic to our result format
 */
function formatDiagnostic(diagnostic: ISpectralDiagnostic): any {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    path: diagnostic.path,
    range: diagnostic.range,
    source: diagnostic.source
  };
}

/**
 * Apply rule overrides to formatted diagnostics (post-filter).
 * - 'off': remove the diagnostic entirely
 * - severity level: remap the diagnostic's severity
 *
 * Severity mapping: error=0, warn=1, info=2, hint=3
 */
const SEVERITY_MAP: Record<string, number> = { error: 0, warn: 1, info: 2, hint: 3 };

function applyRuleOverrides(
  diagnostics: any[],
  overrides: Record<string, string>
): any[] {
  return diagnostics
    .filter(d => overrides[d.code] !== 'off')
    .map(d => {
      const override = overrides[d.code];
      if (override && override !== 'off' && SEVERITY_MAP[override] !== undefined) {
        return { ...d, severity: SEVERITY_MAP[override] };
      }
      return d;
    });
}

// ============================================
// Message Handling
// ============================================

/**
 * Send message to main thread
 */
function sendMessage(message: OutgoingMessage): void {
  if (parentPort) {
    parentPort.postMessage(message);
  }
}

/**
 * Send status update to main thread
 */
function sendStatus(): void {
  sendMessage({
    type: 'status',
    payload: {
      workerId: initData.workerId,
      status: workerStatus,
      taskCount,
      averageExecutionTime: taskCount > 0 ? totalExecutionTime / taskCount : 0,
      cachedDocumentId,
      cachedAt: cachedAt?.toISOString(),
      cacheSize,
      lastHeartbeat: lastHeartbeat.toISOString()
    }
  });
}

/**
 * Handle incoming messages from main thread
 */
function handleMessage(msg: IncomingMessage): void {
  switch (msg.type) {
    case 'execute':
      executeTask(msg as ExecuteMessage).catch(error => {
        sendMessage({
          type: 'error',
          payload: {
            workerId: initData.workerId,
            phase: 'execution',
            error: error instanceof Error ? error.message : String(error)
          }
        });
      });
      break;

    case 'evict-cache':
      evictCache();
      sendStatus();
      break;

    case 'shutdown':
      workerStatus = 'terminated';
      sendStatus();
      process.exit(0);
      break;

    case 'ping':
      lastHeartbeat = new Date();
      sendMessage({
        type: 'pong',
        payload: {
          workerId: initData.workerId,
          timestamp: lastHeartbeat.toISOString()
        }
      });
      break;

    default:
      sendMessage({
        type: 'error',
        payload: {
          workerId: initData.workerId,
          phase: 'message-handling',
          error: `Unknown message type: ${msg.type}`
        }
      });
  }
}

// ============================================
// Worker Entry Point
// ============================================

if (parentPort) {
  // Set up message listener
  parentPort.on('message', handleMessage);

  // Start initialization
  initialize().catch(error => {
    console.error('[Worker] Initialization failed:', error);
    process.exit(1);
  });
} else {
  console.error('[Worker] No parent port available - must be run as worker thread');
  process.exit(1);
}

/**
 * Extract a Spectral ruleset definition from a Node module namespace.
 * Mirrors `extractRulesetDef` in ruleset-loader.ts. Handles ESM default,
 * CJS default, and Babel CJS double-wrap shapes.
 */
function extractRulesetDef(mod: unknown): { rules?: unknown; extends?: unknown; overrides?: unknown } | null {
  if (!mod || typeof mod !== 'object') return null;
  const ns = mod as Record<string, unknown>;
  let candidate = (ns.default ?? ns) as Record<string, unknown>;
  if (
    candidate
    && typeof candidate === 'object'
    && !('rules' in candidate)
    && !('extends' in candidate)
    && !('overrides' in candidate)
    && candidate.default
    && typeof candidate.default === 'object'
  ) {
    candidate = candidate.default as Record<string, unknown>;
  }
  return candidate as { rules?: unknown; extends?: unknown; overrides?: unknown };
}
