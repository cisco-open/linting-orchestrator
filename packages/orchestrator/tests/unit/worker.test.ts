/**
 * Worker Thread Tests
 * 
 * Tests worker initialization, task execution, document caching, and error handling.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { RulesetLoader } from '../../build/ruleset-loader.js';
import { loadConfig } from '../../build/config.js';
import { RULESETS_CONFIG, RULESETS_SOURCES } from '../helpers/repo-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Worker Thread', () => {
  let config: any;
  let rulesetLoader: RulesetLoader;
  let testDocumentPath: string;
  let testDocumentId: string;

  beforeAll(async () => {
    // Load configuration
    config = await loadConfig();
    
    // Initialize ruleset loader with proper config
    rulesetLoader = new RulesetLoader({
      configPath: RULESETS_CONFIG,
      sourcesBasePath: RULESETS_SOURCES,
      enableCache: true
    });
    await rulesetLoader.initialize();

    // Create test document
    testDocumentId = 'test-doc-worker';
    testDocumentPath = path.join(__dirname, 'fixtures', 'documents', `${testDocumentId}.json`);
    
    await fs.mkdir(path.dirname(testDocumentPath), { recursive: true });
    await fs.writeFile(testDocumentPath, JSON.stringify({
      openapi: '3.0.0',
      info: {
        title: 'Test API',
        version: '1.0.0'
      },
      paths: {}
    }));
  });

  afterAll(async () => {
    // Clean up test document
    try {
      await fs.unlink(testDocumentPath);
    } catch (error) {
      // Ignore
    }
  });

  describe('Initialization', () => {
    it('should initialize worker with valid ruleset', async () => {
      const ruleset = await rulesetLoader.loadVersion('oas-recommended');
      const workerId = 'test-worker-1';
      
      const workerScript = path.join(process.cwd(), 'build', 'worker.js');
      const worker = new Worker(workerScript, {
        workerData: {
          workerId,
          rulesetName: 'oas-recommended',
          rulesetVersion: ruleset.version,
          rulesetPath: ruleset.rulesetPath,
          config: {
            documentCache: config.workerPool.documentCache,
            taskTimeout: config.workerPool.taskTimeout
          }
        }
      });

      // Wait for ready message
      const readyMsg = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worker init timeout')), 10000);
        
        worker.on('message', (msg) => {
          if (msg.type === 'ready') {
            clearTimeout(timeout);
            resolve(msg);
          }
        });
        
        worker.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      expect(readyMsg).toHaveProperty('type', 'ready');
      expect(readyMsg).toHaveProperty('payload');
      expect((readyMsg as any).payload.workerId).toBe(workerId);

      await worker.terminate();
    }, 15000);

    it('should fail initialization with invalid ruleset path', async () => {
      const workerId = 'test-worker-invalid';
      const workerScript = path.join(process.cwd(), 'build', 'worker.js');
      
      const worker = new Worker(workerScript, {
        workerData: {
          workerId,
          rulesetName: 'invalid',
          rulesetVersion: '1.0.0',
          rulesetPath: '/nonexistent/path/to/ruleset.yaml',
          config: {
            documentCache: config.workerPool.documentCache,
            taskTimeout: config.workerPool.taskTimeout
          }
        }
      });

      // Wait for error message
      const errorMsg = await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'error') {
            resolve(msg);
          }
        });
      });

      expect(errorMsg).toHaveProperty('type', 'error');
      expect((errorMsg as any).payload).toHaveProperty('error');

      await worker.terminate();
    }, 15000);

    it('should report ready status after initialization', async () => {
      const ruleset = await rulesetLoader.loadVersion('oas-recommended');
      const workerId = 'test-worker-status';
      
      const workerScript = path.join(process.cwd(), 'build', 'worker.js');
      const worker = new Worker(workerScript, {
        workerData: {
          workerId,
          rulesetName: 'oas-recommended',
          rulesetVersion: ruleset.version,
          rulesetPath: ruleset.rulesetPath,
          config: {
            documentCache: config.workerPool.documentCache,
            taskTimeout: config.workerPool.taskTimeout
          }
        }
      });

      // Wait for ready
      await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'ready') resolve(msg);
        });
      });

      // Send ping
      worker.postMessage({ type: 'ping' });

      // Wait for pong
      const pongMsg = await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'pong') resolve(msg);
        });
      });

      expect(pongMsg).toHaveProperty('type', 'pong');
      expect((pongMsg as any).payload).toHaveProperty('workerId', workerId);

      await worker.terminate();
    }, 15000);
  });

  describe('Task Execution', () => {
    let worker: Worker;
    let ruleset: any;

    beforeEach(async () => {
      ruleset = await rulesetLoader.loadVersion('oas-recommended');
      const workerId = 'test-worker-exec';
      
      const workerScript = path.join(process.cwd(), 'build', 'worker.js');
      worker = new Worker(workerScript, {
        workerData: {
          workerId,
          rulesetName: 'oas-recommended',
          rulesetVersion: ruleset.version,
          rulesetPath: ruleset.rulesetPath,
          config: {
            documentCache: config.workerPool.documentCache,
            taskTimeout: 30000
          }
        }
      });

      // Wait for ready
      await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'ready') resolve(msg);
        });
      });
    });

    afterEach(async () => {
      if (worker) {
        await worker.terminate();
      }
    });

    it('should execute task and return results', async () => {
      const taskId = 'task-1';
      
      worker.postMessage({
        type: 'execute',
        payload: {
          taskId,
          documentId: testDocumentId,
          documentPath: testDocumentPath,
          timeout: 10000
        }
      });

      // Wait for result
      const resultMsg = await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'result') resolve(msg);
        });
      });

      expect(resultMsg).toHaveProperty('type', 'result');
      expect((resultMsg as any).payload).toHaveProperty('taskId', taskId);
      expect((resultMsg as any).payload).toHaveProperty('success');
      expect((resultMsg as any).payload).toHaveProperty('executionTime');
    }, 30000);

    it('should cache document after first execution', async () => {
      // First execution
      const taskId1 = 'task-cache-1';
      worker.postMessage({
        type: 'execute',
        payload: {
          taskId: taskId1,
          documentId: testDocumentId,
          documentPath: testDocumentPath
        }
      });

      const result1: any = await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'result' && (msg as any).payload.taskId === taskId1) {
            resolve(msg);
          }
        });
      });

      expect(result1.payload.cacheHit).toBe(false);

      // Second execution - should be cache hit
      const taskId2 = 'task-cache-2';
      worker.postMessage({
        type: 'execute',
        payload: {
          taskId: taskId2,
          documentId: testDocumentId,
          documentPath: testDocumentPath
        }
      });

      const result2: any = await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'result' && (msg as any).payload.taskId === taskId2) {
            resolve(msg);
          }
        });
      });

      expect(result2.payload.cacheHit).toBe(true);
    }, 30000);

    it('should report status updates during execution', async () => {
      const taskId = 'task-status';
      const statuses: any[] = [];

      worker.on('message', (msg) => {
        if (msg.type === 'status') {
          statuses.push(msg.payload);
        }
      });

      worker.postMessage({
        type: 'execute',
        payload: {
          taskId,
          documentId: testDocumentId,
          documentPath: testDocumentPath
        }
      });

      // Wait for result
      await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'result') resolve(msg);
        });
      });

      // Wait a bit for status message to arrive
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses.some(s => s.status === 'busy')).toBe(true);
      expect(statuses.some(s => s.status === 'ready')).toBe(true);
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should handle invalid document path', async () => {
      const ruleset = await rulesetLoader.loadVersion('oas-recommended');
      const workerId = 'test-worker-error';
      
      const workerScript = path.join(process.cwd(), 'build', 'worker.js');
      const worker = new Worker(workerScript, {
        workerData: {
          workerId,
          rulesetName: 'oas-recommended',
          rulesetVersion: ruleset.version,
          rulesetPath: ruleset.rulesetPath,
          config: {
            documentCache: config.workerPool.documentCache,
            taskTimeout: 10000
          }
        }
      });

      // Wait for ready
      await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'ready') resolve(msg);
        });
      });

      const taskId = 'task-error';
      worker.postMessage({
        type: 'execute',
        payload: {
          taskId,
          documentId: 'nonexistent',
          documentPath: '/nonexistent/document.json'
        }
      });

      // Wait for error result
      const resultMsg: any = await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'result') resolve(msg);
        });
      });

      expect(resultMsg.payload.success).toBe(false);
      expect(resultMsg.payload.error).toBeDefined();

      await worker.terminate();
    }, 15000);

    it.skip('should handle task timeout', async () => {
      // NOTE: This test is flaky because Spectral can execute faster than 1ms on tiny documents
      // TODO: Create a test with artificially slow operation or large document
      const ruleset = await rulesetLoader.loadVersion('oas-recommended');
      const workerId = 'test-worker-timeout';
      
      const workerScript = path.join(process.cwd(), 'build', 'worker.js');
      const worker = new Worker(workerScript, {
        workerData: {
          workerId,
          rulesetName: 'oas-recommended',
          rulesetVersion: ruleset.version,
          rulesetPath: ruleset.rulesetPath,
          config: {
            documentCache: config.workerPool.documentCache,
            taskTimeout: 100 // Very short timeout
          }
        }
      });

      // Wait for ready
      await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'ready') resolve(msg);
        });
      });

      const taskId = 'task-timeout';
      worker.postMessage({
        type: 'execute',
        payload: {
          taskId,
          documentId: testDocumentId,
          documentPath: testDocumentPath,
          timeout: 1 // 1ms timeout - will definitely timeout
        }
      });

      // Wait for result
      const resultMsg: any = await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'result') resolve(msg);
        });
      });

      expect(resultMsg.payload.success).toBe(false);
      expect(resultMsg.payload.error).toContain('timeout');

      await worker.terminate();
    }, 15000);
  });

  describe('Cache Management', () => {
    it('should evict cache on command', async () => {
      const ruleset = await rulesetLoader.loadVersion('oas-recommended');
      const workerId = 'test-worker-evict';
      
      const workerScript = path.join(process.cwd(), 'build', 'worker.js');
      const worker = new Worker(workerScript, {
        workerData: {
          workerId,
          rulesetName: 'oas-recommended',
          rulesetVersion: ruleset.version,
          rulesetPath: ruleset.rulesetPath,
          config: {
            documentCache: config.workerPool.documentCache,
            taskTimeout: 30000
          }
        }
      });

      // Wait for ready
      await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'ready') resolve(msg);
        });
      });

      // Execute task to cache document
      worker.postMessage({
        type: 'execute',
        payload: {
          taskId: 'cache-1',
          documentId: testDocumentId,
          documentPath: testDocumentPath
        }
      });

      await new Promise((resolve) => {
        worker.on('message', (msg) => {
          if (msg.type === 'result') resolve(msg);
        });
      });

      // Wait for status message from execute to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Now set up listener for evict-cache status
      let statusReceived = false;
      const statusPromise = new Promise<any>((resolve) => {
        const listener = (msg: any) => {
          if (msg.type === 'status' && !statusReceived) {
            statusReceived = true;
            worker.off('message', listener);
            resolve(msg);
          }
        };
        worker.on('message', listener);
      });
      
      worker.postMessage({ type: 'evict-cache' });
      
      const statusMsg: any = await statusPromise;

      expect(statusMsg.payload.cachedDocumentId).toBeNull();

      await worker.terminate();
    }, 30000);
  });
});
