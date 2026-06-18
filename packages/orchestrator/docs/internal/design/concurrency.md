# Concurrency & Backpressure Analysis

**Date:** 2026-03-03  
**Trigger:** 116 simultaneous lint submissions (3 rulesets each = 348 jobs), 3 jobs silently failed  

## Table of Contents

- [Incident Summary](#incident-summary)
- [Full Request Flow](#full-request-flow)
- [Root Cause Analysis](#root-cause-analysis)
  - [Gap 1: maxConcurrentJobs configured but never enforced](#gap-1-maxconcurrentjobs-configured-but-never-enforced)
  - [Gap 2: Worker pool has no task queue — immediate null return](#gap-2-worker-pool-has-no-task-queue--immediate-null-return)
  - [Gap 3: No HTTP backpressure — always 202](#gap-3-no-http-backpressure--always-202)
- [Why Exactly ~3 Jobs Failed](#why-exactly-3-jobs-failed)
- [Proposed Fix: Layered Backpressure](#proposed-fix-layered-backpressure)
  - [Layer 1: Spectify Orchestrator — enforce capacity limit](#layer-1-spectify-orchestrator--enforce-capacity-limit)
  - [Layer 2: Spectify HTTP Server — 429 + Retry-After](#layer-2-spectify-http-server--429--retry-after)
  - [Layer 3: MCP SpectifyClient — detect and propagate 429](#layer-3-mcp-spectifyclient--detect-and-propagate-429)
  - [Layer 4: MCP lint_document tool — surface overload to client](#layer-4-mcp-lint_document-tool--surface-overload-to-client)
- [Alternative: Worker Pool Task Queue](#alternative-worker-pool-task-queue)
- [Testing Checklist](#testing-checklist)

---

## Incident Summary

An MCP client submitted 116 `lint_document` requests near-simultaneously, each requesting 3 rulesets. This generated 348 concurrent job submissions to Spectify. All 348 jobs received a `jobId` and HTTP 202 response, but 3 jobs never completed — their status remained stuck or they failed silently. The MCP client's poll window expired before those jobs produced results.

The sequential workaround (one job at a time, wait for completion) succeeds at `<100ms` per job, confirming the issue is contention under concurrency, not a per-job bug.

---

## Full Request Flow

Understanding the complete chain is essential. Each numbered step references the exact file and line:

```
MCP Client
  │
  ▼  calls lint_document tool
MCP Server (mcp-streamable-server.ts:667)
  │  spectifyClient.submitLintJob({documentId, rulesetName, ...})
  ▼
SpectifyClient (spectify-client.ts:190)
  │  POST http://localhost:3003/lint  (10s timeout)
  ▼
Spectify HTTP Server (spectify/src/server.ts:289)
  │  orchestrator.submitJob(sanitizedRequest)
  │  → always returns HTTP 202 { jobId, status: 'queued' }
  ▼
Orchestrator.submitJob() (spectify/src/orchestrator.ts:171)
  │  1. Check cache (may return cached jobId immediately)
  │  2. Verify document exists
  │  3. Create jobId = randomUUID()
  │  4. Store job in this.jobs Map (status: 'queued')
  │  5. Fire-and-forget: this.executeJob(job)
  │  6. Return jobId to HTTP layer
  ▼
Orchestrator.executeJob() (spectify/src/orchestrator.ts:254)
  │  For each task (1 per job):
  │    → executeTaskWithRetry(task)
  ▼
Orchestrator.executeTaskWithRetry() (spectify/src/orchestrator.ts:370)
  │  maxAttempts = config.workerPool.maxRetries || 3 (default: 2)
  │  Exponential backoff: 1s → 2s (with multiplier 2)
  │  For each attempt:
  │    → workerPool.executeTask(request)
  ▼
WorkerPoolManager.executeTask() (spectify/src/worker-pool.ts:173)
  │  1. Resolve ruleset version
  │  2. Get document path
  │  3. selectWorker(rulesetName, version, documentId)
  │  4. If worker found → executeOnWorker()
  │  5. If null → throw Error("No available worker for ruleset: ...")
  ▼
WorkerPoolManager.selectWorker() (spectify/src/worker-pool.ts:205)
  │  Priority 1: Ready worker with cached document
  │  Priority 2: Any ready worker for the ruleset
  │  Priority 3: return null  ← "For MVP, return null and let caller retry"
  ▼
WorkerPoolManager.executeOnWorker() (spectify/src/worker-pool.ts:264)
  │  Posts message to Worker thread
  │  Worker executes Spectral linting
  │  Returns TaskResult
```

---

## Root Cause Analysis

### Gap 1: `maxConcurrentJobs` configured but never enforced

**File:** `spectify/src/orchestrator.ts`

The orchestrator constructor sets `maxConcurrentJobs: 100`:

```typescript
// orchestrator.ts:78
this.config = {
  maxConcurrentJobs: 100,
  enableCache: true,
  ...config
};
```

But `submitJob()` (line 171) **never checks this value**. Every call proceeds to create a job, store it, and fire off `executeJob()`. With 348 simultaneous submissions, all 348 are accepted.

### Gap 2: Worker pool has no task queue — immediate null return

**File:** `spectify/src/worker-pool.ts`

The `selectWorker()` method (line 205) checks for ready workers and returns `null` if all are busy:

```typescript
// worker-pool.ts:255-257
// Priority 3: Wait for busy worker to become ready
// For MVP, return null and let caller retry
return null;
```

When `selectWorker()` returns `null`, `executeTask()` (line 173) throws immediately:

```typescript
if (!worker) {
  throw new Error(`No available worker for ruleset: ${rulesetName}@${version}`);
}
```

This error is caught by `executeTaskWithRetry()`. With default config:

| Config key | Default value |
|---|---|
| `maxRetries` | `2` |
| `exponentialBackoff.initialDelay` | `1000ms` |
| `exponentialBackoff.multiplier` | `2` |
| `exponentialBackoff.maxDelay` | `30000ms` |

So each failed task gets **2 attempts** with delays of **1s** and **2s**. Under a flood of 348 jobs all starting at time 0:

- Attempt 1 (t=0): ~6 workers serve 6 jobs. 342 get `null` and wait 1s.
- Attempt 2 (t=1s): Workers may have freed up, but 342 jobs all retry at the same instant → **thundering herd**. Many get `null` again. Wait 2s.
- After attempt 2: Any remaining jobs with `null` throw and the job transitions to `failed`.

The worker pool has no internal task queue. It's a synchronous "get a worker or fail" model.

### Gap 3: No HTTP backpressure — always 202

**File:** `spectify/src/server.ts`

The `POST /lint` handler (line 285) unconditionally calls `orchestrator.submitJob()` and returns 202:

```typescript
// server.ts:289-302
fastify.post<{ Body: LintJobRequest }>('/lint', {
  schema: { body: lintJobRequestSchema }
}, async (request, reply) => {
  const jobRequest = request.body;
  const sanitizedRequest = { ... };
  const jobId = await orchestrator.submitJob(sanitizedRequest);
  return reply.code(202).send({
    jobId,
    status: 'queued',
    message: 'Job submitted successfully'
  });
});
```

There is no error handling for capacity-related failures. The `submitJob()` call currently cannot signal "I'm overloaded" — it always accepts. Even if we add a capacity check to the orchestrator, the HTTP layer would need to catch it and return 429.

On the MCP side, `SpectifyClient.submitLintJob()` uses `fetchWithRetry()` (up to 3 retries with exponential backoff) but treats all non-ok responses as generic `SpectifyError`. It does not distinguish 429 from 500.

---

## Why Exactly ~3 Jobs Failed

With 348 fire-and-forget `executeJob()` calls and the default worker pool config:

| Resource | Count |
|---|---|
| Workers per ruleset | 1-2 (min 1, max 2) |
| Rulesets | ~3 (e.g., `pubhub`, `spectral-oas`, `spectral-owasp`) |
| Total workers | ~6 |
| Max retry attempts | 2 |
| Retry delays | 1s, 2s |

Individual lint jobs complete in **<100ms** when uncontested. Under full load, 348 jobs compete for ~6 workers. Most eventually succeed through the retry jitter — each job's retry fires at a slightly different wall-clock time due to Node.js event loop scheduling. But a small number (in this case 3) exhaust both retry attempts at moments when all workers are busy, and the job fails permanently.

These failed jobs were stored in the `this.jobs` Map with status `failed`, but the MCP client polled `get_lint_status` with a finite timeout and gave up before it noticed the failure, or the error was swallowed in the fire-and-forget catch handler:

```typescript
// orchestrator.ts:244
this.executeJob(job).catch(error => {
  console.error(`❌ Job ${jobId} failed:`, error);
  job.status = 'failed';
  job.endTime = new Date();
});
```

---

## Proposed Fix: Layered Backpressure

The fix should be implemented in order: Spectify first (Layers 1-2), then MCP server (Layers 3-4).

### Layer 1: Spectify Orchestrator — enforce capacity limit

**File to edit:** `spectify/src/orchestrator.ts`

Add a capacity check at the top of `submitJob()`, before any work is done:

```typescript
// NEW: Custom error class (add at bottom of file or in types.ts)
export class CapacityExceededError extends Error {
  public readonly activeJobs: number;
  public readonly maxJobs: number;

  constructor(message: string, activeJobs: number, maxJobs: number) {
    super(message);
    this.name = 'CapacityExceededError';
    this.activeJobs = activeJobs;
    this.maxJobs = maxJobs;
  }
}
```

Add to `submitJob()`, right after the initialization check:

```typescript
async submitJob(request: LintJobRequest): Promise<string> {
  if (!this.initialized) {
    throw new Error('Orchestrator not initialized');
  }

  // NEW: Enforce concurrent job limit (backpressure)
  const activeJobCount = this.getActiveJobCount();
  const maxConcurrent = this.config.maxConcurrentJobs ?? 100;
  if (activeJobCount >= maxConcurrent) {
    const stats = this.getQuickStats();
    console.warn(`⚠️  Job rejected: capacity exceeded (${activeJobCount}/${maxConcurrent} active: ${stats.queued} queued, ${stats.running} running)`);
    throw new CapacityExceededError(
      `Server at capacity: ${activeJobCount}/${maxConcurrent} concurrent jobs. Retry after a short delay.`,
      activeJobCount,
      maxConcurrent
    );
  }

  // ... rest of existing submitJob logic ...
```

Add helper method to count active (queued + running) jobs:

```typescript
private getActiveJobCount(): number {
  let count = 0;
  for (const job of this.jobs.values()) {
    if (job.status === 'queued' || job.status === 'running') {
      count++;
    }
  }
  return count;
}

private getQuickStats(): { queued: number; running: number } {
  let queued = 0, running = 0;
  for (const job of this.jobs.values()) {
    if (job.status === 'queued') queued++;
    else if (job.status === 'running') running++;
  }
  return { queued, running };
}
```

> **Note:** `maxConcurrentJobs` default is 100 which may be appropriate, but consider lowering it to align with actual worker throughput. With ~6 workers completing jobs in <100ms, a queue of 50-100 drains in <2s, so 100 is reasonable.

### Layer 2: Spectify HTTP Server — 429 + Retry-After

**File to edit:** `spectify/src/server.ts`

The `POST /lint` handler needs to catch `CapacityExceededError` and return HTTP 429:

```typescript
import { CapacityExceededError } from './orchestrator.js';  // add to imports

// Replace the POST /lint handler:
fastify.post<{ Body: LintJobRequest }>('/lint', {
  schema: {
    body: lintJobRequestSchema
  }
}, async (request, reply) => {
  const jobRequest = request.body;

  const sanitizedRequest = {
    ...jobRequest,
    documentId: sanitizeDocumentId(jobRequest.documentId),
    rulesetName: sanitizeRulesetName(jobRequest.rulesetName)
  };

  try {
    const jobId = await orchestrator.submitJob(sanitizedRequest);
    return reply.code(202).send({
      jobId,
      status: 'queued',
      message: 'Job submitted successfully'
    });
  } catch (error) {
    // NEW: Backpressure — reject with 429 when at capacity
    if (error instanceof CapacityExceededError) {
      const retryAfter = Math.ceil(error.activeJobs / 10); // ~1s per 10 active jobs
      reply.header('Retry-After', String(retryAfter));
      return reply.code(429).send({
        error: 'Too Many Requests',
        message: error.message,
        activeJobs: error.activeJobs,
        maxJobs: error.maxJobs,
        retryAfter
      });
    }

    // Existing error handling for other errors
    console.error('Job submission failed:', error);
    return reply.code(500).send(
      createErrorResponse('Internal Server Error', 'Failed to submit lint job')
    );
  }
});
```

The `Retry-After` header is a standard HTTP mechanism. Clients that understand it will back off automatically. The value is computed as a rough estimate: 1 second per 10 active jobs, giving the worker pool time to drain.

### Layer 3: MCP SpectifyClient — detect and propagate 429

**File to edit:** `mcp-openapi-analysis/src/spectify-client.ts`

The `submitLintJob()` method (line 190) currently treats all non-ok responses the same. It should distinguish 429:

```typescript
// Add new error subclass (near SpectifyError class):
export class SpectifyCapacityError extends SpectifyError {
  public readonly retryAfter: number;
  public readonly activeJobs: number;
  public readonly maxJobs: number;

  constructor(message: string, retryAfter: number, activeJobs: number, maxJobs: number) {
    super(message, 429, { retryAfter, activeJobs, maxJobs });
    this.name = 'SpectifyCapacityError';
    this.retryAfter = retryAfter;
    this.activeJobs = activeJobs;
    this.maxJobs = maxJobs;
  }
}
```

Update `submitLintJob()` to detect 429 before the generic error path:

```typescript
async submitLintJob(request: LintJobRequest): Promise<LintJobResponse> {
  this.ensureEnabled();
  // ... existing logging ...

  try {
    const response = await this.fetchWithRetry(`${this.baseUrl}/lint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      timeout: 10000
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      // NEW: Detect 429 and throw typed error for caller to handle
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
        throw new SpectifyCapacityError(
          errorData.message || 'Spectify server at capacity',
          retryAfter,
          errorData.activeJobs || 0,
          errorData.maxJobs || 0
        );
      }

      throw new SpectifyError(
        `Failed to submit lint job: ${response.statusText}`,
        response.status,
        errorData
      );
    }

    const result = await response.json();
    logger.info('Lint job submitted', { jobId: result.jobId });
    return result;
  } catch (error) {
    // NEW: Don't wrap capacity errors — let them propagate with type intact
    if (error instanceof SpectifyCapacityError) {
      throw error;
    }
    logger.error('Failed to submit lint job', { error, request });
    throw this.wrapError(error, 'Failed to submit lint job');
  }
}
```

**Important:** The `fetchWithRetry()` method should **not** retry on 429. The retry is the caller's responsibility since 429 is an intentional signal, not a transient network failure. Currently `fetchWithRetry()` only retries on caught exceptions (network errors, timeouts), not on HTTP responses — so 429 responses will naturally flow through without retry. This is correct behavior.

### Layer 4: MCP lint_document tool — surface overload to client

**File to edit:** `mcp-openapi-analysis/src/mcp-streamable-server.ts`

The `lint_document` tool handler (line 640) needs to catch `SpectifyCapacityError` specifically and return a structured, actionable error to the MCP client:

```typescript
import { SpectifyCapacityError } from './spectify-client.js';  // add to imports

// In the lint_document tool handler, replace the catch block:
} catch (error: any) {
  // NEW: Specific handling for capacity/overload errors
  if (error instanceof SpectifyCapacityError) {
    logger.warn('Spectify at capacity, rejecting lint job', {
      documentId,
      activeJobs: error.activeJobs,
      maxJobs: error.maxJobs,
      retryAfter: error.retryAfter
    });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'ServerAtCapacity',
          message: `Spectify linting service is at capacity (${error.activeJobs}/${error.maxJobs} concurrent jobs). Please retry after ${error.retryAfter} seconds.`,
          retryAfter: error.retryAfter,
          activeJobs: error.activeJobs,
          maxJobs: error.maxJobs,
          guidance: 'The server is processing too many simultaneous lint requests. Wait for the suggested retryAfter period, then resubmit. For batch workloads, use the create_batch tool which manages concurrency internally.'
        }, null, 2)
      }],
      isError: true,
    };
  }

  // Existing generic error handling
  logger.error('Failed to submit lint job', { error, documentId });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: 'Failed to submit lint job',
        message: error.message || 'Unknown error',
        troubleshooting: [
          'Check if Spectify is running: curl http://localhost:3003/health',
          'Start Spectify: cd spectify && npm start',
          'Check configuration: config.spectify.baseUrl'
        ]
      }, null, 2)
    }],
    isError: true,
  };
}
```

The `ServerAtCapacity` error code and `retryAfter` field give the MCP client (or the LLM agent using it) a clear, machine-readable signal to wait and retry, rather than the opaque "Failed to submit lint job" error that gives no guidance.

---

## Alternative: Worker Pool Task Queue

An alternative (or complement) to the orchestrator-level rejection is adding an actual task queue inside the worker pool, so that when all workers are busy, tasks wait rather than return `null`:

**File:** `spectify/src/worker-pool.ts`, `selectWorker()` method (line 255)

```typescript
// Instead of:
// Priority 3: Wait for busy worker to become ready
// For MVP, return null and let caller retry
return null;

// Could become:
// Priority 3: Wait for a busy worker to become ready (bounded wait)
return new Promise<WorkerInfo | null>((resolve) => {
  const timeout = setTimeout(() => resolve(null), 5000); // 5s max wait
  this.workerReadyQueue.push((worker) => {
    clearTimeout(timeout);
    resolve(worker);
  });
});
```

This would require a `workerReadyQueue` that gets drained whenever a worker finishes a task and transitions back to `ready`.

**Trade-offs:**

| Approach | Pros | Cons |
|---|---|---|
| **Orchestrator rejection (recommended)** | Simple, explicit, client gets clear signal | Clients must implement retry |
| **Worker pool task queue** | Transparent to callers, jobs "just work" | Memory growth under sustained load, harder to reason about backpressure, job may timeout waiting in queue |
| **Both** | Defense in depth | More complexity |

**Recommendation:** Start with orchestrator-level rejection (Layers 1-4 above). The worker pool queue is a good follow-up if the "retry externally" pattern proves too burdensome for MCP clients.

---

## Implementation Record (2026-03-03)

This section documents the final design decisions and implementation details for Layers 1-2 plus complementary enhancements implemented in Spectify server v0.10.0.

### What Was Implemented

#### Layer 1: Orchestrator Capacity Enforcement

**File:** `src/orchestrator.ts`

1. **`CapacityExceededError` class** (exported) — Custom error with `activeJobs` and `maxJobs` fields. Allows the HTTP layer to distinguish capacity rejection from other errors and construct a proper 429 response.

2. **O(1) atomic counter** (`this.activeJobCount`) — Instead of iterating the `this.jobs` Map on every `submitJob()` call, we maintain a dedicated counter:
   - Incremented immediately after `this.jobs.set(jobId, job)` in `submitJob()`
   - Decremented in the `.finally()` handler of the fire-and-forget `executeJob()` call, guaranteeing it decrements on both success and failure paths
   - This avoids O(n) iteration of all jobs (including completed/failed) which would grow in long-running standalone sessions

3. **Capacity check** at the top of `submitJob()`, after initialization check but *before* cache check:
   ```typescript
   const maxConcurrent = this.config.maxConcurrentJobs ?? 100;
   if (this.activeJobCount >= maxConcurrent) {
     throw new CapacityExceededError(...);
   }
   ```
   Cache hits bypass this check because they return immediately without creating a new active job.

4. **`getStats()` expanded** with a `capacity` block:
   ```typescript
   capacity: {
     activeJobs: this.activeJobCount,        // O(1) counter
     maxConcurrentJobs: maxConcurrent,
     utilizationPercent: Math.round((this.activeJobCount / maxConcurrent) * 100)
   }
   ```
   This is exposed in the `/health` endpoint automatically since it already returns `orchestrator.getStats()`.

#### Layer 2: HTTP 429 + Full Error Handling

**File:** `src/server.ts`

The `POST /lint` handler was wrapped in a try/catch with differentiated error responses:

| Error Condition | HTTP Status | Response |
|---|---|---|
| `CapacityExceededError` | **429** | `Retry-After` header + `{ error, message, activeJobs, maxJobs, retryAfter }` |
| Document not found | **404** | Standard error response |
| Orchestrator not initialized | **503** | "Server is starting up, please retry shortly" |
| Unknown errors | **500** | Generic error response |

The `Retry-After` value is calculated as `Math.ceil(activeJobs / 10)` — approximately 1 second per 10 active jobs.

**429 Response Example:**
```json
{
  "error": "Too Many Requests",
  "message": "Server at capacity: 100/100 concurrent jobs. Retry after a short delay.",
  "activeJobs": 100,
  "maxJobs": 100,
  "retryAfter": 10
}
```

**Headers:**
```
HTTP/1.1 429 Too Many Requests
Retry-After: 10
```

#### Complementary Enhancement: Worker Pool Bounded Wait Queue

**File:** `src/worker-pool.ts`

Replaced the immediate `return null` in `selectWorker()` Priority 3 with a bounded wait pattern. This eliminates the thundering herd problem described in the root cause analysis.

**Before (MVP):**
```
selectWorker() → null → throw → 1s backoff → retry → selectWorker() → maybe null again
```

**After:**
```
selectWorker() → wait up to 5s for a worker → resolve when worker freed → execute immediately
```

Implementation details:
- Added `workerReadyCallbacks` queue: `Array<{ rulesetKey, resolve, timer }>`
- `selectWorker()` Priority 3 now returns a `Promise` that waits up to 5 seconds
- `notifyWorkerReady()` is called whenever a worker transitions to `ready` state (task completion, timeout)
- Callbacks are matched by `rulesetKey` and resolved FIFO — ensuring fair ordering
- On timeout (5s), resolves with `null` → falls through to the existing retry logic
- On shutdown, all pending waiters are resolved with `null` and timers cleared

**Why this matters:** With 348 jobs competing for ~6 workers:
- **Before:** 342 get `null`, all wait 1s, all retry simultaneously (thundering herd) — some exhaust retries and fail
- **After:** 342 queue up, each gets served within milliseconds of a worker becoming free — FIFO ordering, no wasted retries

**`PoolStats` expanded** with `pendingWaiters` field to expose queue depth in metrics.

#### Complementary Enhancement: Health/Metrics Capacity Reporting

The `/health` endpoint now includes capacity information automatically via `getStats()`:
```json
{
  "status": "ok",
  "stats": {
    "jobs": { "total": 150, "queued": 5, "running": 12, "completed": 130, "failed": 3 },
    "capacity": {
      "activeJobs": 17,
      "maxConcurrentJobs": 100,
      "utilizationPercent": 17
    },
    "workers": { "total": 6, "active": 4, "idle": 2 }
  }
}
```

The CLI `spectify health` command also displays this capacity information.

### What Was NOT Implemented (Deferred to MCP Server)

Layers 3-4 are implemented in the MCP OpenAPI Analyzer repository (separate codebase). The Spectify-side contract is:

**For Layer 3 (MCP SpectifyClient):**
- On `POST /lint` response with status 429:
  - Parse `Retry-After` header (integer, seconds)
  - Parse response body: `{ activeJobs, maxJobs, retryAfter }`
  - Throw a typed `SpectifyCapacityError` (see proposed class in Layer 3 section above)
  - Do **not** retry 429 inside `fetchWithRetry()` — let the caller decide

**For Layer 4 (MCP lint_document tool):**
- Catch `SpectifyCapacityError` specifically
- Return structured error with `isError: true`:
  ```json
  {
    "error": "ServerAtCapacity",
    "retryAfter": 10,
    "activeJobs": 100,
    "maxJobs": 100,
    "guidance": "Wait for retryAfter period, then resubmit. For batch workloads, use create_batch."
  }
  ```

### Design Decisions

| Decision | Rationale |
|---|---|
| O(1) counter instead of Map iteration | Long-running standalone sessions accumulate thousands of completed jobs in the Map; iterating on every `submitJob()` would degrade |
| Capacity check before cache check | Cache hits don't create active jobs, so they should bypass capacity limits (fast path) |
| Counter in `.finally()` not in `executeJob()` | `.finally()` guarantees decrement even if the catch handler in the fire-and-forget call throws |
| 5s bounded wait in worker pool | Most jobs complete in <100ms; 5s allows ~50 jobs to drain through a single worker. Generous enough to avoid false timeouts, short enough to detect real stalls |
| FIFO callback queue by rulesetKey | Ensures fairness across rulesets; tasks for the same ruleset are served in order |
| `Retry-After = ceil(activeJobs / 10)` | With ~6 workers completing jobs in <100ms, 10 jobs drain in ~170ms. Rounding up to 1s+ gives comfortable margin |
| Both orchestrator rejection AND worker pool queue | Defense in depth — the queue handles normal contention transparently; the orchestrator rejects only when truly overloaded |

### Files Changed

| File | Changes |
|---|---|
| `src/orchestrator.ts` | `CapacityExceededError` class, `activeJobCount` counter, capacity check in `submitJob()`, `.finally()` decrement, expanded `getStats()` |
| `src/server.ts` | Import `CapacityExceededError`, wrap `POST /lint` in try/catch with 429/404/503/500 handling |
| `src/worker-pool.ts` | `workerReadyCallbacks` queue, bounded wait in `selectWorker()`, `notifyWorkerReady()`, `pendingWaiters` in `PoolStats`, queue cleanup in `shutdown()` |
| `src/cli/formatters.ts` | Display capacity and worker stats in `spectify health` output |
| `tests/unit/orchestrator.test.ts` | Updated mock worker pool stats with `pendingWaiters` |
| `tests/integration/api-client.ts` | Updated `OrchestratorStats` type with `capacity` block |

---

## Testing Checklist

### Spectify (Layers 1-2)

- [ ] Unit test: `submitJob()` rejects with `CapacityExceededError` when active jobs >= maxConcurrentJobs
- [ ] Unit test: Cache hits bypass the capacity check (they return immediately)
- [ ] Integration test: `POST /lint` returns 429 with `Retry-After` header when orchestrator is at capacity
- [ ] Integration test: `POST /lint` still returns 202 when under capacity
- [ ] Load test: Submit 200 concurrent jobs, verify some get 429 and all eventually complete with client-side retry
- [ ] Verify `maxConcurrentJobs` is configurable in `config.yaml`

### MCP Server (Layers 3-4)

- [ ] Unit test: `SpectifyClient.submitLintJob()` throws `SpectifyCapacityError` on 429 response
- [ ] Unit test: `SpectifyCapacityError` is not wrapped by `wrapError()`
- [ ] Unit test: `fetchWithRetry()` does NOT retry 429 responses (only retries network errors)
- [ ] Integration test: `lint_document` tool returns `ServerAtCapacity` error with `retryAfter`
- [ ] Integration test: `create_batch` batch manager handles 429 from individual job submissions (it already has retry logic in `lintDocument()` — verify it catches and retries on capacity errors)

### End-to-End

- [ ] Reproduce the 116-document scenario: all jobs eventually succeed (some via retry)
- [ ] Sequential submission still works at <100ms per job
- [ ] Batch tool (`create_batch`) with concurrency=5 does not trigger 429 under normal load
