# Spectify - Design Document

**Spectify - Quality Assurance for OpenAPI**

**Version:** 1.0.0  
**Date:** November 18, 2025  
**Status:** Design Phase

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Worker-Per-Ruleset Design](#worker-per-ruleset-design)
4. [Document Affinity & Caching](#document-affinity--caching)
5. [API Specifications](#api-specifications)
6. [Type System](#type-system)
7. [Ruleset Management](#ruleset-management)
8. [Storage Adapter Interface](#storage-adapter-interface)
9. [Mock Implementation Strategy](#mock-implementation-strategy)
10. [Implementation Plan](#implementation-plan)
11. [Testing Strategy](#testing-strategy)

---

## Executive Summary

### Purpose
Independent microservice for linting OpenAPI documents using Spectral and custom rule engines. Designed to operate asynchronously from the MCP server to maintain MCP responsiveness.

### Key Design Decisions

1. **Independent Process**: Separate service from MCP server, communicates via HTTP
2. **Worker-Per-Ruleset Architecture**: Each worker pre-loaded with entire ruleset for optimal Spectral performance
3. **Document Affinity Caching**: Workers cache documents and orchestrator routes jobs to workers with cached documents
4. **Zero-Copy File References**: Pass file paths (not content) to workers via shared filesystem
5. **Versioned Rulesets**: Support multiple versions, configurable default
6. **Pluggable Storage**: Abstract storage interface for result caching
7. **Resilient Design**: Exponential backoff, retries, continue on failure

### Performance Goals

- **Ruleset Load Time**: <500ms (rulesets pre-loaded at worker initialization)
- **Document Load Time**: 10-200ms (first load), <1ms (cache hit)
- **Job Throughput**: 100+ documents/minute with 30 workers
- **First Result**: <2 seconds for typical OpenAPI document
- **Cache Hit Performance**: 60% faster for large documents

---

## Architecture Overview

### System Context

```
┌─────────────────────────────────────────────────────────────┐
│                MCP Server (port 3001)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Document Store (Upload Service)              │  │
│  │  - Stores OpenAPI docs at ./uploads/{uuid}.json     │  │
│  │  - Returns documentId to clients                     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTP (documentId reference)
                            ↓
┌─────────────────────────────────────────────────────────────┐
│            Lint Orchestrator Service (port 3003)            │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                  HTTP API Server                      │ │
│  │  - Receives lint requests with documentId            │ │
│  │  - Returns job ID immediately (async)                │ │
│  └───────────────────────────────────────────────────────┘ │
│                            ↓                                │
│  ┌───────────────────────────────────────────────────────┐ │
│  │            Document Accessor (NEW)                    │ │
│  │  - Direct filesystem access to MCP uploads/          │ │
│  │  - Path: ../mcp-openapi-analysis/uploads/            │ │
│  │  - Returns file paths (not content)                  │ │
│  └───────────────────────────────────────────────────────┘ │
│                            ↓                                │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              Job Queue & Orchestrator                 │ │
│  │  - Manages job lifecycle                              │ │
│  │  - Routes to workers with document affinity          │ │
│  │  - Aggregates results                                 │ │
│  └───────────────────────────────────────────────────────┘ │
│                            ↓                                │
│  ┌───────────────────────────────────────────────────────┐ │
│  │        Worker Pool Manager (Affinity Tracking)        │ │
│  │  - Manages 5-30 worker threads                        │ │
│  │  - One worker per ruleset (pubhub, oas, cisco, etc.) │ │
│  │  - Tracks which documents each worker has cached     │ │
│  │  - Routes jobs to workers with cached documents      │ │
│  └───────────────────────────────────────────────────────┘ │
│         ↓          ↓          ↓                    ↓        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       ┌─────────┐   │
│  │Worker 1 │ │Worker 2 │ │Worker 3 │  ...  │Worker N │   │
│  │pubhub   │ │oas      │ │cisco    │       │custom   │   │
│  │ruleset  │ │ruleset  │ │ruleset  │       │ruleset  │   │
│  │loaded   │ │loaded   │ │loaded   │       │loaded   │   │
│  │         │ │         │ │         │       │         │   │
│  │doc-123  │ │doc-456  │ │doc-123  │       │doc-789  │   │
│  │cached   │ │cached   │ │cached   │       │cached   │   │
│  └─────────┘ └─────────┘ └─────────┘       └─────────┘   │
│       ↓ (file path)                                         │
│  ┌───────────────────────────────────────────────────────┐ │
│  │         Shared Filesystem (MCP Document Store)        │ │
│  │  ../mcp-openapi-analysis/uploads/                     │ │
│  │    ├── doc-123.json  (50KB)                           │ │
│  │    ├── doc-456.json  (2MB)                            │ │
│  │    └── doc-789.json  (100KB)                          │ │
│  └───────────────────────────────────────────────────────┘ │
│                            ↓                                │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              Storage Adapter (Pluggable)              │ │
│  │  - Stores job results                                 │ │
│  │  - Caches for reuse                                   │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

#### 1. HTTP API Server
- RESTful endpoints for job submission and status
- Authentication/authorization (future)
- Request validation
- Response formatting

#### 2. Job Queue & Orchestrator
- Manages job lifecycle (queued → running → completed/failed)
- Breaks rulesets into individual rule tasks
- Dispatches tasks to appropriate workers
- Aggregates results from multiple workers
- Handles retries with exponential backoff

#### 3. Persistent Worker Pool Manager
- Maintains pool of 5-30 worker threads
- Each worker is dedicated to ONE specific ruleset (not individual rules)
- Pre-loads entire rulesets on worker initialization
- Dynamic scaling based on queue depth (per-ruleset)
- Worker health checks and auto-restart
- **Document affinity tracking**: Routes jobs to workers with cached documents

#### 4. Workers (Worker Threads)
- **Worker-Per-Ruleset Model**: Each worker loads ONE entire ruleset on startup
- **Document Caching**: Workers cache the last document processed (LRU, 1 doc per worker)
- Receives document file path (not content) via message passing
- Loads document from shared filesystem
- Executes entire ruleset in single pass against document
- Returns results immediately (ruleset already loaded, document possibly cached)
- No ruleset loading overhead per execution

#### 5. Document Accessor
- Direct filesystem access to MCP server's document store
- Path: `../mcp-openapi-analysis/uploads/{documentId}.json`
- Returns file paths for zero-copy worker communication
- Optional HTTP fallback if file not found

#### 6. Storage Adapter
- Abstract interface for result storage
- Pluggable implementations (memory, Redis, custom)
- Stores individual rule results separately
- Enables efficient retrieval and caching

---

## Worker-Per-Ruleset Design

### Concept

Each worker thread is permanently assigned to a **specific ruleset** (not individual rules), with the entire ruleset pre-loaded at worker initialization.

### Why Worker-Per-Ruleset?

1. **Spectral Optimization**: Spectral is designed to load an entire ruleset once and run all rules in a single document traversal
2. **Startup Performance**: Ruleset loaded once at worker initialization (200-500ms saved per execution)
3. **Memory Efficiency**: 5-6 rulesets = 5-6 workers (vs. 50+ workers for 50 individual rules)
4. **Ruleset Integrity**: Interdependent rules and shared state remain together
5. **Scalability**: Each ruleset can scale independently (1-5 workers per ruleset)
6. **Predictability**: Consistent performance per ruleset

### Worker Lifecycle

```
Worker Initialization:
  1. Worker thread starts
  2. Load assigned ruleset (Spectral YAML + custom functions)
  3. Pre-compile all rules in ruleset
  4. Signal "ready" to pool manager
  5. Enter "idle" state

Task Execution:
  1. Receive document file path from pool manager
  2. Load document from filesystem (or use cached)
  3. Execute entire pre-loaded ruleset against document (single pass)
  4. Return results
  5. Keep document cached, return to "idle" state

Worker Shutdown:
  1. Complete in-flight task
  2. Evict cached document
  3. Cleanup resources
  4. Exit gracefully
```

### Worker Pool Composition

**Initial Pool (5-6 workers, one per ruleset):**
- Worker 1: pubhub ruleset (v1.1.0)
- Worker 2: oas ruleset (v3.1)
- Worker 3: cisco-api-standards ruleset (v2.0)
- Worker 4: security-audit ruleset (v1.5)
- Worker 5: accessibility ruleset (v1.2)

**Scaling Logic (per-ruleset):**
```
Queue depth for ruleset > 10 jobs → Scale up (add worker for this ruleset)
Queue depth for ruleset < 1 job && idle > 5min → Scale down
Min Workers Per Ruleset: 1
Max Workers Per Ruleset: 2 (laptop: 2, server: 5)
Total Max Workers: 15 (laptop: 15, server: 30)
```

**Ruleset Assignment Strategy:**
```typescript
interface WorkerInfo {
  workerId: string;
  rulesetName: string;        // Primary identity: "pubhub"
  rulesetVersion: string;     // Version loaded: "1.1.0"
  status: 'initializing' | 'ready' | 'busy' | 'failed';
  
  // Document cache tracking (NEW)
  cachedDocumentId?: string;  // Document currently in memory
  cachedAt?: Date;
  
  // Performance tracking
  taskCount: number;
  averageExecutionTime: number;
  lastHeartbeat: Date;
}
```

### Dynamic Worker Creation

When a lint job arrives:
1. Identify required ruleset (e.g., "pubhub v1.1.0")
2. Check if workers exist for this ruleset
3. If no workers: Create first worker for ruleset
4. If workers exist but all busy: Scale up (create additional worker, up to max)
5. Workers persist for future jobs (until scale-down)

**Example:**
```
Job 1: documentId=doc-123, ruleset=pubhub v1.1.0
  → Worker-pubhub-1 created
  → Load pubhub ruleset (200ms, one-time cost)
  → Load document doc-123 from filesystem (20ms)
  → Execute all 50 rules in single pass (100ms)
  → Cache doc-123 in worker memory
  → Return results

Job 2: documentId=doc-123, ruleset=oas v3.1
  → Worker-oas-1 created
  → Load oas ruleset (300ms, one-time cost)
  → Load document doc-123 from filesystem (20ms)
  → Execute all 200 rules in single pass (150ms)
  → Cache doc-123 in worker memory
  → Return results

Job 3: documentId=doc-123, ruleset=cisco v2.0
  → Worker-cisco-1 created
  → Load cisco ruleset (150ms, one-time cost)
  → Document doc-123 NOT in this worker → Load from filesystem (20ms)
  → Execute all 35 rules (80ms)
  → Cache doc-123 in worker memory
  → Return results

Job 4: documentId=doc-123, ruleset=pubhub v1.1.0 (AGAIN!)
  → Worker-pubhub-1 already exists (ruleset loaded)
  → Document doc-123 already cached! (CACHE HIT ⚡)
  → Execute ruleset (100ms, no load overhead!)
  → Total time: 100ms vs. 320ms (68% faster!)
```

### Worker Pool Manager Responsibilities

```typescript
class WorkerPoolManager {
  // Worker lifecycle
  initializeWorkerForRuleset(
    rulesetName: string, 
    rulesetVersion: string
  ): Promise<WorkerId>;
  shutdownWorker(workerId: WorkerId): Promise<void>;
  restartWorker(workerId: WorkerId): Promise<void>;
  
  // Task dispatch with document affinity
  assignTask(task: RuleTask): Promise<WorkerId>;
  getWorkersForRuleset(
    rulesetName: string, 
    rulesetVersion: string
  ): WorkerInfo[];
  
  // Document affinity tracking (NEW)
  getWorkersWithDocument(documentId: string): WorkerInfo[];
  updateDocumentCache(workerId: string, documentId: string): void;
  
  // Scaling
  scaleRuleset(rulesetName: string, targetWorkers: number): Promise<void>;
  
  // Health
  checkWorkerHealth(workerId: WorkerId): Promise<boolean>;
  getPoolStatus(): PoolStatus;
}
```

### Retry Logic with Exponential Backoff

```typescript
interface RetryConfig {
  maxAttempts: 2;           // Total 2 attempts (1 retry)
  initialDelay: 1000;       // 1 second
  maxDelay: 30000;          // 30 seconds
  multiplier: 2;            // Double each time
}

// Retry flow:
// Attempt 1: Immediate execution
// Attempt 1 fails → Wait 1s
// Attempt 2: Second try
// Attempt 2 fails → Mark ruleset execution as failed, log error
```

### Worker State Machine

```
┌─────────────┐
│Initializing │
└──────┬──────┘
       │ Ruleset loaded successfully
       ↓
┌─────────────┐    Task assigned    ┌──────────┐
│    Ready    │ ──────────────────→ │  Busy    │
│ (no doc)    │                     │(running) │
└─────────────┘                     └─────┬────┘
       ↑                                  │
       │         Task completed           │
       └──────────────────────────────────┘
       
┌─────────────┐
│    Ready    │  ← Worker with document cached
│ (doc cached)│  ← Preferred for same documentId jobs
└─────────────┘

       Any state → Failed (health check fails)
       Failed → Initializing (auto-restart, lose cached doc)
```

---

## Document Affinity & Caching

### Concept

Workers cache the most recently processed document in memory. The orchestrator tracks which workers have which documents cached and routes subsequent jobs to workers with the target document already loaded.

### Why Document Affinity?

**Scenario:** Multiple rulesets run against the same document

```
Without affinity (cache miss every time):
  Worker-pubhub: Load doc-123 (20ms), run ruleset (100ms)
  Worker-oas: Load doc-123 (20ms), run ruleset (150ms)
  Worker-cisco: Load doc-123 (20ms), run ruleset (80ms)
  Total: 60ms loading + 330ms execution = 390ms

With affinity (cache hits after first load):
  Worker-pubhub: Load doc-123 (20ms), run ruleset (100ms), cache doc
  Worker-oas: Load doc-123 (20ms), run ruleset (150ms), cache doc
  Worker-cisco: CACHE HIT (0ms), run ruleset (80ms) ⚡
  Total: 40ms loading + 330ms execution = 370ms

For large documents (10MB+):
  Without: 5 rulesets × 200ms load = 1000ms loading overhead
  With: 200ms + (4 × 0ms cache hits) = 200ms loading overhead
  Improvement: 80% faster! 🚀
```

### Implementation

#### Orchestrator Tracking

```typescript
export class WorkerPoolManager {
  private workers = new Map<string, WorkerInfo>();
  
  // NEW: Reverse index for document affinity
  private documentWorkerIndex = new Map<string, Set<string>>();
  // documentId -> Set of workerIds that have this doc cached
  
  /**
   * Assign task with document affinity optimization
   */
  async assignTask(task: RuleTask): Promise<string> {
    const { documentId, rulesetName, rulesetVersion } = task;
    
    // Step 1: Find workers with matching ruleset
    const candidateWorkers = this.getWorkersForRuleset(
      rulesetName, 
      rulesetVersion
    );
    
    if (candidateWorkers.length === 0) {
      // Create new worker for this ruleset
      return await this.initializeWorkerForRuleset(
        rulesetName, 
        rulesetVersion
      );
    }
    
    // Step 2: Prioritize workers that already have this document cached
    const workersWithDocument = candidateWorkers.filter(
      w => w.cachedDocumentId === documentId
    );
    
    if (workersWithDocument.length > 0) {
      // FAST PATH: Document already in memory! ⚡
      const worker = this.selectLeastBusyWorker(workersWithDocument);
      logger.debug(
        `Document cache HIT: ${documentId} in ${worker.workerId}`
      );
      await this.sendTaskToWorker(worker.workerId, task);
      return worker.workerId;
    }
    
    // Step 3: No cache hit, select least-busy worker with this ruleset
    const worker = this.selectLeastBusyWorker(candidateWorkers);
    logger.debug(
      `Document cache MISS: ${documentId}, using ${worker.workerId}`
    );
    
    // Update tracking: this worker will now cache this document
    this.updateDocumentCache(worker.workerId, documentId);
    
    await this.sendTaskToWorker(worker.workerId, task);
    return worker.workerId;
  }
}
```

#### Worker Document Caching

```typescript
// src/worker.ts (Worker Thread)
import { parentPort } from 'worker_threads';
import { Spectral } from '@stoplight/spectral-core';
import { readFile } from 'fs/promises';

// Worker state (GLOBAL in worker context)
let spectral: Spectral;              // Pre-loaded ruleset (never changes)
let cachedDocument: any = null;      // Cached parsed document
let cachedDocumentId: string | null = null;
let lastDocumentUse: Date = new Date();

parentPort.on('message', async (msg) => {
  if (msg.type === 'init') {
    // Load ruleset ONCE at initialization
    spectral = new Spectral();
    await spectral.loadRuleset(msg.rulesetPath);
    parentPort.postMessage({ type: 'ready' });
  }
  
  if (msg.type === 'execute') {
    const { taskId, documentId, documentPath } = msg.payload;
    
    let document: any;
    let cacheHit = false;
    
    // Check if document already cached
    if (cachedDocumentId === documentId && cachedDocument) {
      // CACHE HIT! ⚡
      document = cachedDocument;
      cacheHit = true;
      lastDocumentUse = new Date();
    } else {
      // CACHE MISS - Load from filesystem
      const content = await readFile(documentPath, 'utf-8');
      document = JSON.parse(content);
      
      // Cache for next time (LRU: evict old, cache new)
      cachedDocument = document;
      cachedDocumentId = documentId;
      lastDocumentUse = new Date();
    }
    
    // Execute pre-loaded ruleset (always fast)
    const results = await spectral.run(document);
    
    parentPort.postMessage({
      type: 'result',
      taskId,
      success: true,
      results,
      cacheHit,  // Report cache performance
      executionTime: Date.now() - startTime
    });
  }
  
  if (msg.type === 'evict-cache') {
    // Optional: Clear document cache to free memory
    cachedDocument = null;
    cachedDocumentId = null;
    parentPort.postMessage({ type: 'cache-evicted' });
  }
});

// Background cache eviction (every 60s)
setInterval(() => {
  if (Date.now() - lastDocumentUse.getTime() > 5 * 60 * 1000) {
    // Evict if idle for 5 minutes
    cachedDocument = null;
    cachedDocumentId = null;
  }
}, 60000);
```

### Cache Eviction Strategy

**LRU with max=1 document per worker:**
- Each worker caches only the most recently used document
- New document automatically evicts old document
- Simple, predictable memory usage

**Time-based eviction:**
- Evict cached document after 5 minutes of inactivity
- Frees memory when worker is idle
- Background task runs every 60 seconds

**Configuration:**
```yaml
workerPool:
  documentCache:
    enabled: true
    maxDocumentsPerWorker: 1       # LRU limit
    maxCacheSizePerWorker: 52428800  # 50MB (safety limit)
    evictAfterMinutes: 5           # Time-based eviction
```

### Performance Impact

**Scenario: AI Agent runs 5 rulesets on same document**

**Without caching:**
```
Total: 5 × (20ms load + 100ms execute) = 600ms
```

**With document caching + affinity:**
```
First ruleset: 20ms load + 100ms execute = 120ms
Next 4 rulesets: 0ms load + 100ms execute = 100ms each
Total: 120ms + (4 × 100ms) = 520ms
Improvement: 13% faster
```

**For large documents (10MB+):**
```
Without: 5 × (200ms load + 100ms execute) = 1500ms
With: 200ms + (4 × 100ms) = 600ms
Improvement: 60% faster! 🚀
```

---

## API Specifications

### Base URL
```
http://localhost:3003
```

### Endpoints

#### 1. Submit Lint Job

**Endpoint:** `POST /lint`

**Request:**
```json
{
  "documentId": "doc-123",
  "rulesetName": "pubhub",
  "rulesetVersion": "1.1.0",  // Optional, defaults to configured default
  "options": {
    "forceRun": false,        // Optional, ignore cached results
    "priority": "normal"      // Optional: "low" | "normal" | "high"
  }
}
```

**Note:** Document must be pre-uploaded to MCP server's document store. The orchestrator will access the document via shared filesystem (`../mcp-openapi-analysis/uploads/{documentId}.json`).

**Response (202 Accepted):**
```json
{
  "jobId": "job-uuid-123",
  "status": "queued",
  "estimatedCompletion": "2025-11-18T10:05:30Z",
  "message": "Lint job queued successfully"
}
```

**Error Response (400 Bad Request):**
```json
{
  "error": "Invalid request",
  "details": {
    "documentContent": "Required field missing"
  }
}
```

---

#### 2. Get Job Status

**Endpoint:** `GET /lint/:jobId`

**Response (200 OK):**
```json
{
  "jobId": "job-uuid-123",
  "documentId": "doc-123",
  "rulesetName": "pubhub",
  "rulesetVersion": "1.1.0",
  "status": "running",
  "progress": {
    "totalRules": 50,
    "completedRules": 35,
    "failedRules": 2,
    "runningRules": 4,
    "queuedRules": 9
  },
  "startTime": "2025-11-18T10:05:00Z",
  "estimatedCompletion": "2025-11-18T10:05:30Z"
}
```

**Status Values:**
- `queued`: Job accepted, waiting for workers
- `running`: Rules are being executed
- `completed`: All rules finished successfully
- `completed_with_errors`: Some rules failed, but job completed
- `failed`: Job failed catastrophically

---

#### 3. Get Job Results

**Endpoint:** `GET /lint/:jobId/results`

**Query Parameters:**
- `severity`: Filter by severity (`error`, `warn`, `info`, `hint`)
- `ruleId`: Filter by specific rule ID
- `groupBy`: Group results (`severity`, `rule`, `path`)

**Response (200 OK):**
```json
{
  "jobId": "job-uuid-123",
  "documentId": "doc-123",
  "rulesetName": "pubhub",
  "rulesetVersion": "1.1.0",
  "status": "completed",
  "timestamp": "2025-11-18T10:05:30Z",
  "totalExecutionTime": 2500,
  "summary": {
    "totalRules": 50,
    "successfulRules": 48,
    "failedRules": 2,
    "totalIssues": 127,
    "errorCount": 15,
    "warningCount": 82,
    "infoCount": 25,
    "hintCount": 5
  },
  "results": [
    {
      "ruleId": "typed-enum",
      "code": "typed-enum",
      "message": "Enum values must be typed",
      "severity": 0,
      "path": ["paths", "/pets", "get", "responses", "200"],
      "range": {
        "start": { "line": 45, "character": 10 },
        "end": { "line": 45, "character": 30 }
      }
    }
    // ... more results
  ],
  "ruleExecutions": [
    {
      "ruleId": "typed-enum",
      "executionTime": 125,
      "success": true,
      "issueCount": 3,
      "metadata": {
        "ruleEngine": "spectral",
        "rulesetName": "pubhub",
        "ruleVersion": "1.1.0"
      }
    }
    // ... more rule executions
  ]
}
```

**Response (202 Accepted):** If job still running
```json
{
  "status": "running",
  "message": "Job still in progress",
  "progress": { /* ... */ }
}
```

---

#### 4. List Available Rulesets

**Endpoint:** `GET /rulesets`

**Response (200 OK):**
```json
{
  "rulesets": [
    {
      "name": "pubhub",
      "displayName": "PubHub Readiness Analyzer",
      "description": "Validates OpenAPI documents for PubHub publishing",
      "versions": ["1.0.0", "1.1.0"],
      "defaultVersion": "1.1.0",
      "ruleCount": 50,
      "tags": ["devnet", "pubhub", "publishing"]
    }
  ]
}
```

---

#### 5. Get Ruleset Details

**Endpoint:** `GET /rulesets/:name`

**Query Parameters:**
- `version`: Specific version (defaults to default version)

**Response (200 OK):**
```json
{
  "name": "pubhub",
  "version": "1.1.0",
  "displayName": "PubHub Readiness Analyzer",
  "description": "Validates OpenAPI documents for PubHub publishing",
  "releaseDate": "2024-06-15",
  "rules": [
    {
      "id": "typed-enum",
      "name": "Typed Enum Validator",
      "description": "Ensures enum values have explicit types",
      "severity": "error",
      "enabled": true,
      "engine": "spectral"
    }
    // ... more rules
  ],
  "extends": ["spectral:oas"],
  "metadata": {
    "author": "DevNet Team",
    "repository": "https://wwwin-github.cisco.com/DevNet/PubHub-Analyzer"
  }
}
```

---

#### 6. Health Check

**Endpoint:** `GET /health`

**Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-18T10:05:00Z",
  "version": "1.0.0",
  "workerPool": {
    "activeWorkers": 6,
    "maxWorkers": 10,
    "idleWorkers": 2,
    "busyWorkers": 4,
    "queueDepth": 15,
    "queueCapacity": 100
  },
  "storage": {
    "connected": true,
    "type": "memory"
  }
}
```

---

#### 7. Cancel Job (Optional, Future)

**Endpoint:** `DELETE /lint/:jobId`

**Response (200 OK):**
```json
{
  "jobId": "job-uuid-123",
  "status": "cancelled",
  "message": "Job cancelled successfully",
  "completedRules": 25,
  "cancelledRules": 25
}
```

---

## Type System

### Complete TypeScript Definitions

```typescript
// ============================================
// Core Configuration Types
// ============================================

export interface OrchestratorConfig {
  port: number;
  workerPool: WorkerPoolConfig;
  rulesets: RulesetConfig;
  storage: StorageConfig;
  logging: LoggingConfig;
}

export interface WorkerPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  taskTimeout: number;
  maxRetries: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  exponentialBackoff: {
    initialDelay: number;
    maxDelay: number;
    multiplier: number;
  };
}

export interface RulesetConfig {
  directory: string;
  defaultVersion: string;
  cacheEnabled: boolean;
}

export interface StorageConfig {
  type: 'memory' | 'redis' | 'custom';
  connectionString?: string;
  options?: Record<string, any>;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'json' | 'text';
  destination: 'console' | 'file' | 'both';
  filePath?: string;
}

// ============================================
// Ruleset Types
// ============================================

export interface RulesetMetadata {
  name: string;
  displayName: string;
  description: string;
  versions: RulesetVersion[];
  defaultVersion: string;
  ruleCount: number;
  tags?: string[];
}

export interface RulesetVersion {
  version: string;
  releaseDate: string;
  changelog?: string;
  entrypoint: string;
  path: string;
  deprecated?: boolean;
  rules: RuleDefinition[];
}

export interface RuleDefinition {
  id: string;
  name: string;
  description: string;
  severity: RuleSeverity;
  enabled: boolean;
  engine: RuleEngine;
  config?: Record<string, any>;
}

export type RuleEngine = 'spectral' | 'llm' | 'custom';
export type RuleSeverity = 'error' | 'warn' | 'info' | 'hint';

export interface SpectralRule extends RuleDefinition {
  engine: 'spectral';
  config: {
    given: string;
    then: {
      function: string;
      functionOptions?: any;
      field?: string;
    };
  };
}

// ============================================
// Job Types
// ============================================

export interface LintJobRequest {
  documentId: string;
  documentContent: any;
  rulesetName: string;
  rulesetVersion?: string;
  options?: {
    forceRun?: boolean;
    priority?: 'low' | 'normal' | 'high';
  };
}

export interface LintJob {
  jobId: string;
  documentId: string;
  rulesetName: string;
  rulesetVersion: string;
  status: JobStatus;
  progress: JobProgress;
  startTime: Date;
  endTime?: Date;
  estimatedCompletion?: Date;
  priority: 'low' | 'normal' | 'high';
  tasks: RuleTask[];
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

export interface JobProgress {
  totalRules: number;
  completedRules: number;
  failedRules: number;
  runningRules: number;
  queuedRules: number;
}

export interface RuleTask {
  taskId: string;
  jobId: string;
  ruleId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'retry';
  attempt: number;
  maxAttempts: number;
  assignedWorker?: string;
  startTime?: Date;
  endTime?: Date;
  result?: RuleExecutionResult;
}

// ============================================
// Worker Types
// ============================================

export interface WorkerInfo {
  workerId: string;
  ruleId: string;
  rulesetName: string;
  rulesetVersion: string;
  status: WorkerStatus;
  taskCount: number;
  averageExecutionTime: number;
  lastHeartbeat: Date;
  createdAt: Date;
}

export type WorkerStatus = 'initializing' | 'ready' | 'busy' | 'failed' | 'terminated';

export interface WorkerMessage {
  type: 'init' | 'execute' | 'shutdown' | 'heartbeat';
  payload: any;
}

export interface WorkerInitMessage extends WorkerMessage {
  type: 'init';
  payload: {
    workerId: string;
    rule: RuleDefinition;
    rulesetPath: string;
  };
}

export interface WorkerExecuteMessage extends WorkerMessage {
  type: 'execute';
  payload: {
    taskId: string;
    documentContent: any;
    timeout: number;
  };
}

export interface WorkerResponse {
  taskId: string;
  success: boolean;
  executionTime: number;
  error?: string;
  result?: RuleExecutionResult;
}

// ============================================
// Result Types
// ============================================

export interface RuleExecutionResult {
  ruleId: string;
  executionTime: number;
  success: boolean;
  error?: string;
  issueCount: number;
  issues: LintIssue[];
  metadata: {
    ruleEngine: string;
    rulesetName: string;
    ruleVersion: string;
  };
}

export interface LintIssue {
  ruleId: string;
  code: string;
  message: string;
  severity: 0 | 1 | 2 | 3; // 0=error, 1=warn, 2=info, 3=hint
  path: string[];
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  suggestions?: string[];
}

export interface LintJobResult {
  jobId: string;
  documentId: string;
  rulesetName: string;
  rulesetVersion: string;
  status: JobStatus;
  timestamp: Date;
  totalExecutionTime: number;
  summary: {
    totalRules: number;
    successfulRules: number;
    failedRules: number;
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    hintCount: number;
  };
  results: LintIssue[];
  ruleExecutions: RuleExecutionResult[];
}

// ============================================
// Storage Interface
// ============================================

export interface LintResultStorage {
  /**
   * Store complete job result
   */
  storeJob(result: LintJobResult): Promise<void>;

  /**
   * Retrieve job result by job ID
   */
  retrieveJobById(jobId: string): Promise<LintJobResult | null>;

  /**
   * Retrieve job result by document + ruleset
   */
  retrieveJob(
    documentId: string,
    rulesetName: string,
    rulesetVersion: string
  ): Promise<LintJobResult | null>;

  /**
   * Retrieve specific rule execution result
   */
  retrieveRuleResult(
    jobId: string,
    ruleId: string
  ): Promise<RuleExecutionResult | null>;

  /**
   * Check if cached results exist
   */
  exists(
    documentId: string,
    rulesetName: string,
    rulesetVersion: string
  ): Promise<boolean>;

  /**
   * Invalidate all results for a document
   */
  invalidate(documentId: string): Promise<void>;

  /**
   * Get storage statistics
   */
  getStats(): Promise<{
    totalJobs: number;
    totalResults: number;
    storageSize?: number;
  }>;
}

// ============================================
// Pool Manager Interface
// ============================================

export interface WorkerPoolManager {
  /**
   * Initialize the worker pool
   */
  initialize(config: WorkerPoolConfig): Promise<void>;

  /**
   * Get or create worker for specific rule
   */
  getWorkerForRule(rule: RuleDefinition, ruleset: RulesetVersion): Promise<string>;

  /**
   * Assign task to worker
   */
  assignTask(task: RuleTask, documentContent: any): Promise<void>;

  /**
   * Get pool status
   */
  getStatus(): {
    activeWorkers: number;
    idleWorkers: number;
    busyWorkers: number;
    queueDepth: number;
  };

  /**
   * Scale pool up/down
   */
  scale(targetSize: number): Promise<void>;

  /**
   * Shutdown all workers
   */
  shutdown(): Promise<void>;
}
```

---

## Ruleset Management

### Directory Structure

```
rulesets/
├── pubhub/
│   ├── ruleset.json                    # Metadata
│   ├── v1.0.0/                         # Version 1.0.0
│   │   ├── pubhub.yaml
│   │   ├── devxPublishingRequirements.js
│   │   ├── pubhubRendering.js
│   │   ├── functions/
│   │   │   ├── checkTagCapitalizationConsistency.js
│   │   │   ├── detectCircularReferences.js
│   │   │   └── ...
│   │   └── package.json
│   │
│   └── v1.1.0/                         # Version 1.1.0 (default)
│       ├── pubhub.yaml
│       ├── devxPublishingRequirements.js
│       ├── pubhubRendering.js
│       ├── functions/
│       │   ├── checkTagCapitalizationConsistency.js
│       │   ├── detectCircularReferences.js
│       │   └── ...
│       └── package.json
│
└── [future-ruleset]/
    └── ...
```

### Ruleset Metadata File (`ruleset.json`)

```json
{
  "name": "pubhub",
  "displayName": "PubHub Readiness Analyzer",
  "description": "Validates OpenAPI documents for PubHub publishing requirements",
  "versions": [
    {
      "version": "1.0.0",
      "releaseDate": "2024-01-15",
      "entrypoint": "pubhub.yaml",
      "deprecated": false,
      "changelog": "Initial release"
    },
    {
      "version": "1.1.0",
      "releaseDate": "2024-06-15",
      "entrypoint": "pubhub.yaml",
      "deprecated": false,
      "changelog": "Added new rules for enum typing and markdown validation"
    }
  ],
  "defaultVersion": "1.1.0",
  "tags": ["devnet", "pubhub", "publishing", "cisco"],
  "metadata": {
    "author": "DevNet Team",
    "repository": "https://wwwin-github.cisco.com/DevNet/PubHub-Analyzer",
    "license": "Apache-2.0"
  }
}
```

### Ruleset Loading Process

```typescript
class RulesetLoader {
  /**
   * Load ruleset metadata
   */
  async loadRuleset(name: string): Promise<RulesetMetadata> {
    const metadataPath = path.join(rulesetsDir, name, 'ruleset.json');
    const metadata = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(metadata);
  }

  /**
   * Load specific version of ruleset
   */
  async loadVersion(
    name: string,
    version?: string
  ): Promise<RulesetVersion> {
    const metadata = await this.loadRuleset(name);
    const versionToLoad = version || metadata.defaultVersion;
    
    const versionInfo = metadata.versions.find(v => v.version === versionToLoad);
    if (!versionInfo) {
      throw new Error(`Version ${versionToLoad} not found for ruleset ${name}`);
    }

    const versionPath = path.join(
      rulesetsDir,
      name,
      `v${versionInfo.version}`
    );

    // Parse Spectral ruleset to extract individual rules
    const rules = await this.parseSpectralRuleset(
      path.join(versionPath, versionInfo.entrypoint)
    );

    return {
      ...versionInfo,
      path: versionPath,
      rules
    };
  }

  /**
   * Parse Spectral YAML/JS ruleset and extract rules
   */
  async parseSpectralRuleset(entrypoint: string): Promise<RuleDefinition[]> {
    // Use Spectral's ruleset parser
    const { Spectral } = await import('@stoplight/spectral-core');
    const spectral = new Spectral();
    
    // Load ruleset (handles extends, imports, etc.)
    await spectral.loadRuleset(entrypoint);
    
    // Extract rule definitions
    const rules: RuleDefinition[] = [];
    for (const [ruleId, rule] of Object.entries(spectral.ruleset.rules)) {
      rules.push({
        id: ruleId,
        name: ruleId, // Can be enhanced with metadata
        description: (rule as any).description || '',
        severity: this.mapSpectralSeverity((rule as any).severity),
        enabled: !(rule as any).disabled,
        engine: 'spectral',
        config: rule
      });
    }
    
    return rules;
  }

  private mapSpectralSeverity(severity: number | string): RuleSeverity {
    if (typeof severity === 'string') {
      return severity as RuleSeverity;
    }
    const map: RuleSeverity[] = ['error', 'warn', 'info', 'hint'];
    return map[severity] || 'error';
  }
}
```

### Versioning Strategy

1. **Semantic Versioning**: Use semver (1.0.0, 1.1.0, 2.0.0)
2. **Default Version**: Configurable (usually "latest" or specific version)
3. **Version Selection**:
   - If version specified in request → use that version
   - If no version → use configured default
   - "latest" keyword → use highest version number
4. **Deprecation**: Mark old versions as deprecated, but keep available
5. **Migration**: Document breaking changes in changelog

---

## Storage Adapter Interface

### Design Principles

1. **Pluggable**: Easy to swap implementations
2. **Job-Centric**: Store complete job results
3. **Rule-Level**: Also store individual rule results for granular retrieval
4. **Versioned**: Account for ruleset versions in storage keys
5. **TTL Support**: Optional expiration for cache cleanup

### Implementation: In-Memory Storage (Placeholder)

```typescript
export class MemoryLintStorage implements LintResultStorage {
  private jobResults: Map<string, LintJobResult> = new Map();
  private documentIndex: Map<string, Set<string>> = new Map();

  async storeJob(result: LintJobResult): Promise<void> {
    // Store by job ID
    this.jobResults.set(result.jobId, result);

    // Index by document ID
    const key = this.makeKey(
      result.documentId,
      result.rulesetName,
      result.rulesetVersion
    );
    
    if (!this.documentIndex.has(result.documentId)) {
      this.documentIndex.set(result.documentId, new Set());
    }
    this.documentIndex.get(result.documentId)!.add(key);
  }

  async retrieveJobById(jobId: string): Promise<LintJobResult | null> {
    return this.jobResults.get(jobId) || null;
  }

  async retrieveJob(
    documentId: string,
    rulesetName: string,
    rulesetVersion: string
  ): Promise<LintJobResult | null> {
    const key = this.makeKey(documentId, rulesetName, rulesetVersion);
    
    for (const result of this.jobResults.values()) {
      const resultKey = this.makeKey(
        result.documentId,
        result.rulesetName,
        result.rulesetVersion
      );
      if (resultKey === key) {
        return result;
      }
    }
    
    return null;
  }

  async retrieveRuleResult(
    jobId: string,
    ruleId: string
  ): Promise<RuleExecutionResult | null> {
    const job = await this.retrieveJobById(jobId);
    if (!job) return null;

    return job.ruleExecutions.find(r => r.ruleId === ruleId) || null;
  }

  async exists(
    documentId: string,
    rulesetName: string,
    rulesetVersion: string
  ): Promise<boolean> {
    const result = await this.retrieveJob(documentId, rulesetName, rulesetVersion);
    return result !== null;
  }

  async invalidate(documentId: string): Promise<void> {
    const jobIds = this.documentIndex.get(documentId);
    if (!jobIds) return;

    for (const key of jobIds) {
      // Find and remove job
      for (const [jobId, result] of this.jobResults.entries()) {
        if (result.documentId === documentId) {
          this.jobResults.delete(jobId);
        }
      }
    }

    this.documentIndex.delete(documentId);
  }

  async getStats(): Promise<{ totalJobs: number; totalResults: number }> {
    let totalResults = 0;
    for (const result of this.jobResults.values()) {
      totalResults += result.results.length;
    }

    return {
      totalJobs: this.jobResults.size,
      totalResults
    };
  }

  private makeKey(documentId: string, ruleset: string, version: string): string {
    return `${documentId}:${ruleset}:${version}`;
  }
}
```

### Future: Redis Storage Example

```typescript
export class RedisLintStorage implements LintResultStorage {
  constructor(private redis: Redis) {}

  async storeJob(result: LintJobResult): Promise<void> {
    const key = `job:${result.jobId}`;
    const indexKey = `doc:${result.documentId}:${result.rulesetName}:${result.rulesetVersion}`;
    
    await this.redis.multi()
      .set(key, JSON.stringify(result))
      .set(indexKey, result.jobId)
      .expire(key, 86400) // 24h TTL
      .expire(indexKey, 86400)
      .exec();
  }

  // ... other methods
}
```

---

## Mock Implementation Strategy

### Purpose

Enable end-to-end testing before implementing real components.

### Mock Components

#### 1. Mock HTTP Server

Returns realistic responses with simulated delays:

```typescript
// mock-server.ts
import Fastify from 'fastify';

const mockServer = Fastify();

// Store mock jobs
const mockJobs = new Map<string, any>();

mockServer.post('/lint', async (request, reply) => {
  const jobId = `mock-job-${Date.now()}`;
  
  mockJobs.set(jobId, {
    jobId,
    status: 'queued',
    startTime: new Date(),
    // Simulate progression
  });

  // Simulate async processing
  setTimeout(() => {
    mockJobs.get(jobId)!.status = 'running';
  }, 500);

  setTimeout(() => {
    mockJobs.get(jobId)!.status = 'completed';
    mockJobs.get(jobId)!.endTime = new Date();
  }, 2000);

  return reply.code(202).send({
    jobId,
    status: 'queued',
    estimatedCompletion: new Date(Date.now() + 2000).toISOString()
  });
});

mockServer.get('/lint/:jobId', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const job = mockJobs.get(jobId);

  if (!job) {
    return reply.code(404).send({ error: 'Job not found' });
  }

  return {
    ...job,
    progress: {
      totalRules: 50,
      completedRules: job.status === 'completed' ? 50 : 25,
      failedRules: 0,
      runningRules: job.status === 'running' ? 4 : 0,
      queuedRules: job.status === 'queued' ? 50 : 0
    }
  };
});

mockServer.get('/lint/:jobId/results', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const job = mockJobs.get(jobId);

  if (!job) {
    return reply.code(404).send({ error: 'Job not found' });
  }

  if (job.status !== 'completed') {
    return reply.code(202).send({
      status: job.status,
      message: 'Job still in progress'
    });
  }

  // Return mock results
  return {
    jobId,
    documentId: 'mock-doc',
    rulesetName: 'pubhub',
    rulesetVersion: '1.1.0',
    status: 'completed',
    timestamp: new Date().toISOString(),
    totalExecutionTime: 2000,
    summary: {
      totalRules: 50,
      successfulRules: 50,
      failedRules: 0,
      totalIssues: 15,
      errorCount: 5,
      warningCount: 8,
      infoCount: 2,
      hintCount: 0
    },
    results: [
      {
        ruleId: 'typed-enum',
        code: 'typed-enum',
        message: 'Enum values must be typed',
        severity: 0,
        path: ['paths', '/pets', 'get', 'responses', '200']
      }
      // ... more mock results
    ],
    ruleExecutions: []
  };
});

mockServer.listen({ port: 3003 }, (err) => {
  if (err) throw err;
  console.log('Mock orchestrator running on port 3003');
});
```

#### 2. Mock Worker Pool

```typescript
// mock-worker-pool.ts
export class MockWorkerPool implements WorkerPoolManager {
  private workers: Map<string, WorkerInfo> = new Map();

  async initialize(config: WorkerPoolConfig): Promise<void> {
    console.log('Mock worker pool initialized');
  }

  async getWorkerForRule(rule: RuleDefinition): Promise<string> {
    // Simulate worker creation
    const workerId = `mock-worker-${rule.id}`;
    
    if (!this.workers.has(workerId)) {
      this.workers.set(workerId, {
        workerId,
        ruleId: rule.id,
        rulesetName: 'pubhub',
        rulesetVersion: '1.1.0',
        status: 'ready',
        taskCount: 0,
        averageExecutionTime: 100,
        lastHeartbeat: new Date(),
        createdAt: new Date()
      });
    }

    return workerId;
  }

  async assignTask(task: RuleTask, documentContent: any): Promise<void> {
    // Simulate task execution
    setTimeout(() => {
      console.log(`Mock worker executing task ${task.taskId}`);
    }, 100);
  }

  getStatus() {
    return {
      activeWorkers: this.workers.size,
      idleWorkers: this.workers.size,
      busyWorkers: 0,
      queueDepth: 0
    };
  }

  async scale(targetSize: number): Promise<void> {
    console.log(`Mock scaling to ${targetSize} workers`);
  }

  async shutdown(): Promise<void> {
    this.workers.clear();
    console.log('Mock worker pool shut down');
  }
}
```

### Testing with Mock

```bash
# Terminal 1: Start mock orchestrator
npm run mock

# Terminal 2: Test from MCP server or curl
curl -X POST http://localhost:3003/lint \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "test-doc",
    "documentContent": {},
    "rulesetName": "pubhub"
  }'

# Get status
curl http://localhost:3003/lint/mock-job-123

# Get results
curl http://localhost:3003/lint/mock-job-123/results
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1, Days 1-3)

**Goal**: Basic project structure, types, and mock server

**Tasks**:
1. Create new repository `openapi-lint-orchestrator`
2. Initialize Node.js/TypeScript project
3. Define all TypeScript types (`src/types.ts`)
4. Implement configuration loader (`src/config.ts`)
5. Create mock HTTP server (`src/mock-server.ts`)
6. Write basic integration tests using mock
7. Documentation: README, ARCHITECTURE.md

**Deliverables**:
- ✅ Working mock server on port 3003
- ✅ Complete type definitions
- ✅ Configuration system
- ✅ Basic test suite

**Validation**:
```bash
npm run mock          # Starts mock server
npm test              # Runs integration tests against mock
```

---

### Phase 2: Storage Layer (Week 1, Days 4-5)

**Goal**: Implement storage adapter interface and in-memory implementation

**Tasks**:
1. Define storage interface (`src/storage/storage-adapter.ts`)
2. Implement in-memory storage (`src/storage/memory-storage.ts`)
3. Add storage tests
4. Integrate with mock server
5. Document storage adapter pattern

**Deliverables**:
- ✅ Storage interface definition
- ✅ Working in-memory implementation
- ✅ Test coverage for storage operations
- ✅ Documentation for custom storage adapters

**Validation**:
```bash
npm test -- storage   # Storage-specific tests
```

---

### Phase 3: Ruleset Management (Week 2, Days 1-3)

**Goal**: Load and manage versioned rulesets

**Tasks**:
1. Copy PubHub-Analyzer ruleset (v1.1.0)
2. Create ruleset metadata structure
3. Implement ruleset loader (`src/ruleset-loader.ts`)
4. Parse Spectral rulesets to extract individual rules
5. Add version selection logic
6. Create ruleset tests

**Deliverables**:
- ✅ `rulesets/pubhub/` directory with v1.1.0
- ✅ Ruleset loader implementation
- ✅ Rule extraction from Spectral YAML/JS
- ✅ Version management

**Validation**:
```bash
npm run list-rulesets           # CLI tool to list rulesets
npm test -- ruleset-loader      # Ruleset loading tests
```

---

### Phase 4: Worker Pool (Week 2-3, Days 4-7)

**Goal**: Implement worker-per-rule architecture with worker threads

**Tasks**:
1. Implement worker thread template (`src/worker.ts`)
2. Implement worker pool manager (`src/worker-pool.ts`)
3. Add worker initialization (rule loading)
4. Implement task dispatch and result collection
5. Add health monitoring and auto-restart
6. Implement dynamic scaling
7. Add exponential backoff retry logic

**Deliverables**:
- ✅ Worker thread implementation
- ✅ Worker pool manager
- ✅ Dynamic scaling based on load
- ✅ Health monitoring
- ✅ Retry logic with exponential backoff

**Validation**:
```bash
npm run test-workers        # Worker pool tests
npm run benchmark-workers   # Load test with multiple workers
```

---

### Phase 5: Spectral Engine (Week 3, Days 1-3)

**Goal**: Integrate Spectral linting engine in workers

**Tasks**:
1. Implement Spectral engine (`src/engines/spectral-engine.ts`)
2. Load Spectral ruleset in worker context
3. Execute Spectral against documents
4. Transform Spectral results to our format
5. Handle Spectral errors gracefully
6. Add Spectral-specific tests

**Deliverables**:
- ✅ Spectral engine implementation
- ✅ Rule execution in worker threads
- ✅ Result transformation
- ✅ Error handling

**Validation**:
```bash
npm test -- spectral-engine         # Spectral integration tests
npm run lint-sample                 # Lint sample OpenAPI document
```

---

### Phase 6: Job Orchestrator (Week 3-4, Days 4-7)

**Goal**: Implement job queue and orchestration logic

**Tasks**:
1. Implement job queue (`src/job-queue.ts`)
2. Implement orchestrator (`src/orchestrator.ts`)
3. Break jobs into rule tasks
4. Dispatch tasks to worker pool
5. Aggregate results from workers
6. Update job status and progress
7. Store results via storage adapter

**Deliverables**:
- ✅ Job queue implementation
- ✅ Orchestrator logic
- ✅ Task distribution
- ✅ Result aggregation
- ✅ Progress tracking

**Validation**:
```bash
npm test -- orchestrator        # Orchestrator tests
npm run test-full-job           # End-to-end job test
```

---

### Phase 7: HTTP API (Week 4, Days 1-3)

**Goal**: Production HTTP API server

**Tasks**:
1. Replace mock server with real implementation
2. Implement all API endpoints
3. Add request validation
4. Add error handling
5. Add API documentation (OpenAPI spec)
6. Add rate limiting (future-proof)

**Deliverables**:
- ✅ Complete HTTP API
- ✅ Request validation
- ✅ Error responses
- ✅ OpenAPI specification for API

**Validation**:
```bash
npm start                       # Start production server
npm test -- api                 # API integration tests
npm run api-docs                # Generate API documentation
```

---

### Phase 8: Integration & Testing (Week 4, Days 4-5)

**Goal**: End-to-end testing and optimization

**Tasks**:
1. Integration tests with real OpenAPI documents
2. Load testing (concurrent jobs)
3. Performance optimization
4. Memory leak detection
5. Error scenario testing
6. Documentation updates

**Deliverables**:
- ✅ Complete test suite
- ✅ Performance benchmarks
- ✅ Production-ready service

**Validation**:
```bash
npm test                        # Full test suite
npm run load-test               # Stress test
npm run benchmark               # Performance metrics
```

---

### Phase 9: Documentation & Deployment (Week 5)

**Goal**: Production readiness

**Tasks**:
1. Complete documentation
   - README.md
   - ARCHITECTURE.md
   - API.md
   - DEPLOYMENT.md
2. Docker containerization
3. CI/CD pipeline setup
4. Logging and monitoring setup
5. Health check endpoints

**Deliverables**:
- ✅ Complete documentation
- ✅ Docker image
- ✅ CI/CD pipeline
- ✅ Deployment guide

**Validation**:
```bash
docker build -t lint-orchestrator .
docker run -p 3003:3003 lint-orchestrator
```

---

## Testing Strategy

### 1. Unit Tests

**Coverage**: Individual functions and classes

```typescript
// Example: Worker pool manager tests
describe('WorkerPoolManager', () => {
  test('should initialize with min workers', async () => {
    const pool = new WorkerPoolManager();
    await pool.initialize({ minWorkers: 4, maxWorkers: 10, ... });
    
    const status = pool.getStatus();
    expect(status.activeWorkers).toBe(4);
  });

  test('should scale up when queue is full', async () => {
    // ... test dynamic scaling
  });

  test('should assign task to available worker', async () => {
    // ... test task assignment
  });
});
```

### 2. Integration Tests

**Coverage**: Component interactions

```typescript
// Example: Orchestrator + Worker Pool + Storage
describe('Lint Orchestrator Integration', () => {
  test('should complete full lint job', async () => {
    const orchestrator = new Orchestrator(pool, storage, rulesetLoader);
    
    const jobId = await orchestrator.submitJob({
      documentId: 'test-doc',
      documentContent: testOpenAPIDoc,
      rulesetName: 'pubhub',
      rulesetVersion: '1.1.0'
    });

    // Wait for completion
    await waitForJobCompletion(jobId);

    const result = await storage.retrieveJobById(jobId);
    expect(result).toBeDefined();
    expect(result!.status).toBe('completed');
    expect(result!.results.length).toBeGreaterThan(0);
  });
});
```

### 3. API Tests

**Coverage**: HTTP endpoints

```typescript
// Example: API endpoint tests
describe('API Endpoints', () => {
  test('POST /lint should queue job', async () => {
    const response = await fetch('http://localhost:3003/lint', {
      method: 'POST',
      body: JSON.stringify({
        documentId: 'test',
        documentContent: {},
        rulesetName: 'pubhub'
      })
    });

    expect(response.status).toBe(202);
    const data = await response.json();
    expect(data.jobId).toBeDefined();
    expect(data.status).toBe('queued');
  });
});
```

### 4. Load Tests

**Coverage**: Performance under load

```bash
# Artillery load test
artillery quick \
  --count 100 \
  --num 10 \
  http://localhost:3003/lint
```

### 5. Sample OpenAPI Documents

**Test Cases**:
- Small document (Petstore - 300 lines)
- Medium document (5,000 lines)
- Large document (50,000 lines)
- Invalid OpenAPI (malformed)
- Edge cases (circular refs, deep nesting)

---

## Next Steps

1. **Review this design document** - Provide feedback on architecture decisions
2. **Create new repository** - Set up `openapi-lint-orchestrator` repo
3. **Start Phase 1** - Implement foundation and mock server
4. **Iterative development** - Build and test incrementally

**Questions?**
- Any architectural concerns?
- Should we adjust the implementation timeline?
- Any additional requirements not covered?

---

## Appendix: Technologies & Dependencies

### Core Dependencies
```json
{
  "dependencies": {
    "@stoplight/spectral-core": "^1.18.3",
    "@stoplight/spectral-cli": "^6.11.0",
    "@stoplight/spectral-functions": "^1.7.2",
    "@stoplight/spectral-rulesets": "^1.18.1",
    "fastify": "^4.x",
    "yaml": "^2.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/node": "^20.x",
    "vitest": "^1.x"
  }
}
```

### System Requirements
- Node.js ≥ 18
- 2GB RAM minimum (4GB recommended for 10 workers)
- Multi-core CPU (4+ cores recommended)
