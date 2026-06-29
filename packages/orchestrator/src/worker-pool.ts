// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Worker Pool Manager
 * 
 * Manages a pool of worker threads for parallel OpenAPI document linting.
 * 
 * Architecture:
 * - Worker-per-ruleset: Each worker is dedicated to a specific ruleset
 * - Document affinity: Routes tasks to workers that have the document cached
 * - Dynamic scaling: Scales up/down based on queue depth and load
 * - Health monitoring: Auto-restarts failed workers
 * 
 * Workflow:
 * 1. Initialize: Create min workers per ruleset
 * 2. Execute: Route task to appropriate worker based on ruleset + document affinity
 * 3. Scale: Add/remove workers based on load
 * 4. Monitor: Health checks, restart failures
 * 
 * @module worker-pool
 */

import { Worker } from 'worker_threads';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WorkerPoolConfig } from './types.js';
import { RulesetLoader } from './ruleset-loader.js';
import type { DocumentStoreAdapter } from '@cisco_open/linting-document-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// Types
// ============================================

export interface WorkerInfo {
  workerId: string;
  worker: Worker;
  rulesetName: string;
  rulesetVersion: string;
  status: 'initializing' | 'ready' | 'busy' | 'error' | 'terminated';
  taskCount: number;
  averageExecutionTime: number;
  lastHeartbeat: Date;
  createdAt: Date;
  restartCount: number;

  // Document cache tracking
  cachedDocumentId?: string;
  cachedAt?: Date;

  // Current task (if busy)
  currentTaskId?: string;
}

export interface PoolStats {
  totalWorkers: number;
  readyWorkers: number;
  busyWorkers: number;
  errorWorkers: number;
  workersByRuleset: Map<string, number>;
  totalTasksExecuted: number;
  averageExecutionTime: number;
  pendingWaiters: number; // Tasks waiting for a free worker in the bounded queue
}

export interface ExecuteTaskRequest {
  taskId: string;
  documentId: string;
  rulesetName: string;
  rulesetVersion?: string;
  ruleOverrides?: Record<string, string>;
  timeout?: number;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  results?: any[];
  issues?: any[];
  error?: string;
  executionTime: number;
  workerId: string;
  cacheHit: boolean;
}

// ============================================
// Worker Pool Manager
// ============================================

export class WorkerPoolManager {
  private workers: Map<string, WorkerInfo> = new Map();
  private workersByRuleset: Map<string, Set<string>> = new Map(); // ruleset -> Set<workerId>
  private pendingTasks: Map<string, (result: TaskResult) => void> = new Map(); // taskId -> resolver
  private workerReadyCallbacks: Array<{
    rulesetKey: string;
    resolve: (worker: WorkerInfo | null) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = []; // Bounded wait queue for tasks waiting on a free worker
  private initialized = false;
  private totalTasksExecuted = 0;
  private totalExecutionTime = 0;
  private scalingMonitorInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private config: WorkerPoolConfig,
    private rulesetLoader: RulesetLoader,
    private documentStore: DocumentStoreAdapter,
    private resolverPath?: string
  ) { }

  /**
   * Initialize worker pool with minimum workers per ruleset
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error('Worker pool already initialized');
    }

    console.log('🔧 Initializing Worker Pool...');

    // Get all available rulesets
    const rulesets = this.rulesetLoader.listRulesets();

    if (rulesets.length === 0) {
      throw new Error('No rulesets available - cannot initialize worker pool');
    }

    // Calculate optimal worker count
    const cpuCount = os.cpus().length;
    const maxWorkersTotal = Math.min(this.config.totalMaxWorkers, cpuCount * 2);
    const minWorkersPerRuleset = Math.max(1, Math.floor(maxWorkersTotal / rulesets.length));

    console.log(`   CPU cores: ${cpuCount}`);
    console.log(`   Rulesets: ${rulesets.length}`);
    console.log(`   Workers per ruleset: ${minWorkersPerRuleset}`);
    console.log(`   Total max workers: ${maxWorkersTotal}`);

    // Create minimum workers for each ruleset
    const workerPromises: Promise<void>[] = [];
    const failedRulesets: string[] = [];

    for (const ruleset of rulesets) {
      const workersToCreate = Math.min(minWorkersPerRuleset, this.config.minWorkersPerRuleset);

      for (let i = 0; i < workersToCreate; i++) {
        workerPromises.push(
          this.createWorker(ruleset.name, ruleset.defaultVersion).catch(error => {
            console.error(`   ❌ Failed to create worker for ${ruleset.name}: ${error.message}`);
            failedRulesets.push(ruleset.name);
          })
        );
      }
    }

    // Wait for all workers to initialize
    await Promise.all(workerPromises);

    if (this.workers.size === 0) {
      throw new Error('Failed to initialize any workers - check ruleset configurations');
    }

    if (failedRulesets.length > 0) {
      console.warn(`   ⚠️  Some rulesets failed to load: ${[...new Set(failedRulesets)].join(', ')}`);
    }

    this.initialized = true;
    console.log(`✅ Worker Pool initialized with ${this.workers.size} workers`);
    this.logPoolStatus();

    // Start dynamic scaling monitor
    this.startScalingMonitor();
  }

  /**
   * Execute task on appropriate worker
   */
  async executeTask(request: ExecuteTaskRequest): Promise<TaskResult> {
    if (!this.initialized) {
      throw new Error('Worker pool not initialized');
    }

    const { taskId, documentId, rulesetName, rulesetVersion, ruleOverrides, timeout } = request;

    // Resolve ruleset version
    const version = rulesetVersion || this.rulesetLoader.getMetadata(rulesetName).defaultVersion;

    // Get document path (zero-copy architecture!)
    const documentPath = await this.documentStore.getDocumentPath(documentId);

    // Verify document exists
    const exists = await this.documentStore.documentExists(documentId);
    if (!exists) {
      throw new Error(`Document not found: ${documentId}`);
    }

    // Find appropriate worker
    const worker = await this.selectWorker(rulesetName, version, documentId);

    if (!worker) {
      throw new Error(`No available worker for ruleset: ${rulesetName}@${version}`);
    }

    // Execute task
    return this.executeOnWorker(worker, {
      taskId,
      documentId,
      documentPath,
      ruleOverrides,
      timeout: timeout || this.config.taskTimeout
    });
  }

  /**
   * Select best worker for task (document affinity routing)
   */
  private async selectWorker(
    rulesetName: string,
    rulesetVersion: string,
    documentId: string
  ): Promise<WorkerInfo | null> {
    const rulesetKey = `${rulesetName}@${rulesetVersion}`;
    const workerIds = this.workersByRuleset.get(rulesetKey);

    if (!workerIds || workerIds.size === 0) {
      // No workers for this ruleset - try to create one
      await this.createWorker(rulesetName, rulesetVersion);
      return this.selectWorker(rulesetName, rulesetVersion, documentId);
    }

    // Get candidate workers
    const candidates: WorkerInfo[] = [];
    for (const workerId of workerIds) {
      const worker = this.workers.get(workerId);
      if (worker && worker.status !== 'error' && worker.status !== 'terminated') {
        candidates.push(worker);
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Priority 1: Workers with cached document (document affinity)
    const withDocument = candidates.filter(
      w => w.status === 'ready' && w.cachedDocumentId === documentId
    );

    if (withDocument.length > 0) {
      // Return least busy worker with document cached
      return withDocument.reduce((best, current) =>
        current.taskCount < best.taskCount ? current : best
      );
    }

    // Priority 2: Ready workers (no cache hit)
    const readyWorkers = candidates.filter(w => w.status === 'ready');

    if (readyWorkers.length > 0) {
      // Return least busy ready worker
      return readyWorkers.reduce((best, current) =>
        current.taskCount < best.taskCount ? current : best
      );
    }

    // Priority 3: Wait for a busy worker to become ready (bounded wait)
    const waitTimeout = this.config.workerWaitTimeout ?? 30000;
    return new Promise<WorkerInfo | null>((resolve) => {
      const timer = setTimeout(() => {
        // Remove from queue on timeout
        const idx = this.workerReadyCallbacks.findIndex(cb => cb.resolve === resolve);
        if (idx !== -1) this.workerReadyCallbacks.splice(idx, 1);
        resolve(null);
      }, waitTimeout);

      this.workerReadyCallbacks.push({
        rulesetKey,
        resolve,
        timer
      });
    });
  }

  /**
   * Execute task on specific worker
   */
  private executeOnWorker(
    workerInfo: WorkerInfo,
    task: {
      taskId: string;
      documentId: string;
      documentPath: string;
      ruleOverrides?: Record<string, string>;
      timeout: number;
    }
  ): Promise<TaskResult> {
    return new Promise((resolve, reject) => {
      const { taskId, documentId, documentPath, ruleOverrides, timeout } = task;

      // Mark worker as busy
      workerInfo.status = 'busy';
      workerInfo.currentTaskId = taskId;

      // Set up result handler
      const resultHandler = (msg: any) => {
        if (msg.type === 'result' && msg.payload.taskId === taskId) {
          // Clean up
          workerInfo.worker.off('message', resultHandler);
          this.pendingTasks.delete(taskId);

          // Update worker status
          workerInfo.status = 'ready';
          workerInfo.currentTaskId = undefined;
          workerInfo.taskCount++;

          // Drain worker-ready queue: notify first waiter for this ruleset
          this.notifyWorkerReady(workerInfo);

          if (msg.payload.success) {
            // Update metrics
            this.totalTasksExecuted++;
            this.totalExecutionTime += msg.payload.executionTime;
            workerInfo.averageExecutionTime =
              (workerInfo.averageExecutionTime * (workerInfo.taskCount - 1) + msg.payload.executionTime) /
              workerInfo.taskCount;

            // Update cache tracking
            if (msg.payload.cacheHit) {
              workerInfo.cachedDocumentId = documentId;
              workerInfo.cachedAt = new Date();
            }

            resolve({
              taskId,
              success: true,
              results: msg.payload.results,
              executionTime: msg.payload.executionTime,
              workerId: workerInfo.workerId,
              cacheHit: msg.payload.cacheHit
            });
          } else {
            reject(new Error(msg.payload.error || 'Task execution failed'));
          }
        }
      };

      // Set up error handler
      const errorHandler = (error: Error) => {
        workerInfo.worker.off('message', resultHandler);
        workerInfo.worker.off('error', errorHandler);
        this.pendingTasks.delete(taskId);

        workerInfo.status = 'error';
        workerInfo.currentTaskId = undefined;

        reject(new Error(`Worker error: ${error.message}`));

        // Try to restart worker
        this.handleWorkerFailure(workerInfo);
      };

      // Set up timeout
      const timer = setTimeout(() => {
        workerInfo.worker.off('message', resultHandler);
        workerInfo.worker.off('error', errorHandler);
        this.pendingTasks.delete(taskId);

        workerInfo.status = 'ready';
        workerInfo.currentTaskId = undefined;

        // Drain worker-ready queue on timeout (worker becomes available)
        this.notifyWorkerReady(workerInfo);

        const timeoutError = new Error(`Task timeout after ${timeout}ms`);
        (timeoutError as any).code = 'TIMEOUT';
        reject(timeoutError);
      }, timeout);

      // Register handlers
      workerInfo.worker.on('message', resultHandler);
      workerInfo.worker.on('error', errorHandler);
      this.pendingTasks.set(taskId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });

      // Send execute message to worker
      workerInfo.worker.postMessage({
        type: 'execute',
        payload: {
          taskId,
          documentId,
          documentPath,
          timeout,
          ruleOverrides
        }
      });
    });
  }

  /**
   * Create new worker for ruleset
   */
  private async createWorker(
    rulesetName: string,
    rulesetVersion: string
  ): Promise<void> {
    const workerId = `${rulesetName}-${rulesetVersion}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const rulesetKey = `${rulesetName}@${rulesetVersion}`;

    // Check total worker limit
    if (this.workers.size >= this.config.totalMaxWorkers) {
      throw new Error(`Worker pool at max capacity: ${this.config.totalMaxWorkers}`);
    }

    // Load ruleset to get path
    const ruleset = await this.rulesetLoader.loadVersion(rulesetName, rulesetVersion);
    const rulesetPath = ruleset.rulesetPath;

    // Create worker thread
    const workerScriptPath = path.join(__dirname, 'worker.js');
    const worker = new Worker(workerScriptPath, {
      workerData: {
        workerId,
        rulesetName,
        rulesetVersion,
        rulesetPath,
        rulesetLoader: ruleset.loader ?? 'bundler',
        resolverPath: this.resolverPath,
        config: {
          documentCache: this.config.documentCache,
          taskTimeout: this.config.taskTimeout
        }
      }
    });

    // Create worker info
    const workerInfo: WorkerInfo = {
      workerId,
      worker,
      rulesetName,
      rulesetVersion,
      status: 'initializing',
      taskCount: 0,
      averageExecutionTime: 0,
      lastHeartbeat: new Date(),
      createdAt: new Date(),
      restartCount: 0
    };

    // Wait for worker to become ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Worker ${workerId} initialization timeout`));
      }, 30000); // 30s timeout

      const messageHandler = (msg: any) => {
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          worker.off('message', messageHandler);
          worker.off('error', errorHandler);
          workerInfo.status = 'ready';
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          worker.off('message', messageHandler);
          worker.off('error', errorHandler);
          reject(new Error(msg.payload.error || 'Worker initialization failed'));
        }
      };

      const errorHandler = (error: Error) => {
        clearTimeout(timeout);
        worker.off('message', messageHandler);
        worker.off('error', errorHandler);
        reject(error);
      };

      worker.on('message', messageHandler);
      worker.on('error', errorHandler);
    });

    // Register worker
    this.workers.set(workerId, workerInfo);

    if (!this.workersByRuleset.has(rulesetKey)) {
      this.workersByRuleset.set(rulesetKey, new Set());
    }
    this.workersByRuleset.get(rulesetKey)!.add(workerId);

    console.log(`   ✅ Worker ${workerId} ready (${rulesetName}@${rulesetVersion})`);
  }

  /**
   * Notify the first waiter in the worker-ready queue that a worker is available.
   * Called when a worker transitions back to 'ready' after completing a task or timing out.
   */
  private notifyWorkerReady(workerInfo: WorkerInfo): void {
    const rulesetKey = `${workerInfo.rulesetName}@${workerInfo.rulesetVersion}`;

    // Find the first callback waiting for this ruleset
    const idx = this.workerReadyCallbacks.findIndex(cb => cb.rulesetKey === rulesetKey);
    if (idx !== -1) {
      const callback = this.workerReadyCallbacks.splice(idx, 1)[0];
      clearTimeout(callback.timer);
      callback.resolve(workerInfo);
    }
  }

  /**
   * Handle worker failure (auto-restart)
   */
  private async handleWorkerFailure(workerInfo: WorkerInfo): Promise<void> {
    console.error(`❌ Worker ${workerInfo.workerId} failed`);

    // Check restart limit
    if (workerInfo.restartCount >= this.config.maxRetries) {
      console.error(`   Maximum retries exceeded for ${workerInfo.workerId}`);
      workerInfo.status = 'terminated';
      return;
    }

    // Terminate failed worker
    try {
      await workerInfo.worker.terminate();
    } catch (error) {
      // Ignore termination errors
    }

    // Remove from maps
    this.workers.delete(workerInfo.workerId);
    const rulesetKey = `${workerInfo.rulesetName}@${workerInfo.rulesetVersion}`;
    this.workersByRuleset.get(rulesetKey)?.delete(workerInfo.workerId);

    // Create replacement worker
    try {
      console.log(`   🔄 Restarting worker for ${workerInfo.rulesetName}@${workerInfo.rulesetVersion}`);
      await this.createWorker(workerInfo.rulesetName, workerInfo.rulesetVersion);
    } catch (error) {
      console.error(`   Failed to restart worker: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Dynamic scaling monitor — checks queue pressure every 2 seconds.
   * 
   * Scale-up: If pending waiters for a ruleset >= scaleUpThreshold and
   *           current workers < maxWorkersPerRuleset, spawn a new worker.
   * Scale-down: If all workers for a ruleset are idle (ready) and
   *             current workers > minWorkersPerRuleset, terminate one.
   */
  private startScalingMonitor(): void {
    const SCALING_CHECK_INTERVAL_MS = 2000;

    this.scalingMonitorInterval = setInterval(() => {
      for (const [rulesetKey, workerIds] of this.workersByRuleset) {
        const currentWorkers = workerIds.size;
        if (currentWorkers === 0) continue;

        // Count pending waiters for this ruleset
        const pendingForRuleset = this.workerReadyCallbacks
          .filter(cb => cb.rulesetKey === rulesetKey).length;

        // Count busy workers for this ruleset
        let busyCount = 0;
        let readyCount = 0;
        for (const workerId of workerIds) {
          const worker = this.workers.get(workerId);
          if (worker?.status === 'busy') busyCount++;
          if (worker?.status === 'ready') readyCount++;
        }

        // Scale UP: queue pressure exceeds threshold and we have capacity
        if (pendingForRuleset >= this.config.scaleUpThreshold
          && currentWorkers < this.config.maxWorkersPerRuleset
          && this.workers.size < this.config.totalMaxWorkers) {
          // Parse rulesetName@rulesetVersion
          const [rulesetName, rulesetVersion] = rulesetKey.split('@');
          console.log(`📈 Scaling up ${rulesetKey}: ${currentWorkers} workers, ${pendingForRuleset} pending waiters`);
          this.createWorker(rulesetName, rulesetVersion).catch(err => {
            console.error(`   ⚠️  Scale-up failed for ${rulesetKey}: ${err instanceof Error ? err.message : String(err)}`);
          });
        }

        // Scale DOWN: all workers idle, we have more than minimum
        if (readyCount === currentWorkers && busyCount === 0 && pendingForRuleset === 0
          && currentWorkers > this.config.minWorkersPerRuleset) {
          this.scaleDownOne(rulesetKey);
        }
      }
    }, SCALING_CHECK_INTERVAL_MS);

    // Don't let the interval prevent process exit
    if (this.scalingMonitorInterval.unref) {
      this.scalingMonitorInterval.unref();
    }
  }

  /**
   * Terminate one idle worker for a ruleset (scale down).
   * Picks the worker with the lowest task count (least utilized).
   */
  private async scaleDownOne(rulesetKey: string): Promise<void> {
    const workerIds = this.workersByRuleset.get(rulesetKey);
    if (!workerIds) return;

    // Find the least-utilized ready worker
    let target: WorkerInfo | null = null;
    for (const workerId of workerIds) {
      const worker = this.workers.get(workerId);
      if (worker?.status === 'ready') {
        if (!target || worker.taskCount < target.taskCount) {
          target = worker;
        }
      }
    }

    if (!target) return;

    console.log(`📉 Scaling down ${rulesetKey}: removing worker ${target.workerId} (${workerIds.size} → ${workerIds.size - 1})`);

    try {
      await target.worker.terminate();
    } catch {
      // Ignore termination errors
    }

    this.workers.delete(target.workerId);
    workerIds.delete(target.workerId);
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const stats: PoolStats = {
      totalWorkers: this.workers.size,
      readyWorkers: 0,
      busyWorkers: 0,
      errorWorkers: 0,
      workersByRuleset: new Map(),
      totalTasksExecuted: this.totalTasksExecuted,
      averageExecutionTime: this.totalTasksExecuted > 0 ? this.totalExecutionTime / this.totalTasksExecuted : 0,
      pendingWaiters: this.workerReadyCallbacks.length
    };

    for (const worker of this.workers.values()) {
      if (worker.status === 'ready') stats.readyWorkers++;
      if (worker.status === 'busy') stats.busyWorkers++;
      if (worker.status === 'error') stats.errorWorkers++;

      const rulesetKey = `${worker.rulesetName}@${worker.rulesetVersion}`;
      stats.workersByRuleset.set(
        rulesetKey,
        (stats.workersByRuleset.get(rulesetKey) || 0) + 1
      );
    }

    return stats;
  }

  /**
   * Shutdown all workers
   */
  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down worker pool...');

    // Stop scaling monitor
    if (this.scalingMonitorInterval) {
      clearInterval(this.scalingMonitorInterval);
      this.scalingMonitorInterval = null;
    }

    const shutdownPromises: Promise<void>[] = [];

    for (const workerInfo of this.workers.values()) {
      const terminatePromise = workerInfo.worker.terminate()
        .then(() => { })
        .catch(error => {
          console.error(`Error terminating worker ${workerInfo.workerId}:`, error);
        });
      shutdownPromises.push(terminatePromise);
    }

    await Promise.all(shutdownPromises);

    // Clear all pending waiters (resolve with null so they don't hang)
    for (const cb of this.workerReadyCallbacks) {
      clearTimeout(cb.timer);
      cb.resolve(null);
    }
    this.workerReadyCallbacks = [];

    this.workers.clear();
    this.workersByRuleset.clear();
    this.pendingTasks.clear();
    this.initialized = false;

    console.log('✅ Worker pool shutdown complete');
  }

  /**
   * Log current pool status
   */
  private logPoolStatus(): void {
    const stats = this.getStats();
    console.log(`\n📊 Worker Pool Status:`);
    console.log(`   Total workers: ${stats.totalWorkers}`);
    console.log(`   Ready: ${stats.readyWorkers}, Busy: ${stats.busyWorkers}, Error: ${stats.errorWorkers}`);
    console.log(`   Workers by ruleset:`);

    for (const [ruleset, count] of stats.workersByRuleset.entries()) {
      console.log(`      ${ruleset}: ${count}`);
    }
    console.log();
  }
}
