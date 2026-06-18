# Error Handling and Status Tracking in Spectify

**Date**: December 22, 2024  
**Status**: ✅ Implemented (Phase 1 & 3)  
**Related**: [EXECUTION_SESSION_TRACKING.md](EXECUTION_SESSION_TRACKING.md), [LINT_ORCHESTRATOR_DESIGN.md](LINT_ORCHESTRATOR_DESIGN.md)

---

## Executive Summary

This document analyzes the error handling and status tracking mechanisms in Spectify, identifies gaps, and documents the implemented solution for timeout handling and metrics tracking.

**Implementation Status:**
- ✅ **Phase 1 Complete**: TIMEOUT status added (distinguished from generic failures)
- ✅ **Phase 3 Complete**: Metrics tracking implemented (failure statistics in memory)
- ⏸️ **Phase 2 Deferred**: Configurable timeouts (keeping 30s default for now)
- ❌ **Phase 4 Not Implemented**: No retry logic (as per requirements)

**Key Changes:**
- ✅ Added `'timeout'` to `JobStatus` type
- ✅ Added `timeoutTasks` counter to `JobProgress`
- ✅ Worker marks timeout errors with `code: 'TIMEOUT'`
- ✅ Orchestrator detects and handles timeouts separately
- ✅ Storage tracks failure statistics (completed/failed/timeout counts)
- ✅ New `/stats` endpoint exposes metrics

---

## Implementation Summary

### Changes Made (December 22, 2024)

**1. Enhanced JobStatus Type**
```typescript
export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'timeout'           // ✅ NEW: Explicit timeout status
  | 'cancelled';
```

**2. Enhanced JobProgress Tracking**
```typescript
export interface JobProgress {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  timeoutTasks: number;  // ✅ NEW: Separate timeout counter
  runningTasks: number;
  queuedTasks: number;
}
```

**3. Worker Timeout Detection**
```typescript
// Worker marks timeout errors with special code
const timer = setTimeout(() => {
  timedOut = true;
  const error = new Error(`Execution timeout after ${timeoutMs}ms`);
  (error as any).code = 'TIMEOUT';  // ✅ NEW: Explicit marker
  reject(error);
}, timeoutMs);
```

**4. Orchestrator Timeout Handling**
```typescript
// Orchestrator detects and handles timeouts
const isTimeout = error instanceof Error && (error as any).code === 'TIMEOUT';

task.status = isTimeout ? 'timeout' : 'failed';
if (isTimeout) {
  job.progress.timeoutTasks++;
  console.error(`⏱️  Task ${task.taskId} timed out`);
} else {
  job.progress.failedTasks++;
}

// Set job status
if (job.progress.timeoutTasks > 0) {
  job.status = 'timeout';
} else if (errors.length > 0) {
  job.status = 'completed_with_errors';
} else {
  job.status = 'completed';
}
```

**5. Failure Statistics Tracking**
```typescript
// Storage tracks failure metrics
export interface StorageStats {
  totalJobs: number;
  totalResults: number;
  failureStats?: {
    totalFailed: number;
    totalTimeout: number;
    totalCompleted: number;
    failureRate: number;
  };
}
```

**6. New /stats Endpoint**
```bash
GET /stats
Returns:
{
  "storage": {
    "totalJobs": 100,
    "failureStats": {
      "totalFailed": 5,
      "totalTimeout": 2,
      "totalCompleted": 93,
      "failureRate": 0.07
    }
  },
  "orchestrator": { ... }
}
```

### Testing

Run the test script to verify:
```bash
# Start server
npm start

# In another terminal
node test-timeout-status.js
```

The test verifies:
- ✅ Timeout status is tracked in job progress
- ✅ Job status set to 'timeout' when appropriate
- ✅ Statistics endpoint returns failure metrics
- ✅ Timeout count tracked separately from failures

---

## Current Implementation (Before Changes)

### 1. Job Status Types (src/types.ts)

```typescript
export type JobStatus =
  | 'queued'           // ✅ Job submitted, waiting to start
  | 'running'          // ✅ Job is executing
  | 'completed'        // ✅ Job finished successfully (no issues or all rules passed)
  | 'completed_with_errors'  // ✅ Job finished but found lint issues
  | 'failed'           // ✅ Job failed due to errors (crash, invalid doc, etc.)
  | 'cancelled';       // ✅ Job was cancelled by user
```

**What's tracked:**
- ✅ Job lifecycle states (queued → running → completed/failed)
- ✅ Success with lint issues vs. execution failure
- ✅ Individual task status within a job

**What's missing:**
- ❌ **TIMEOUT status** - No explicit timeout state (grouped with 'failed')
- ❌ **Failure reasons** - No categorization (crash vs. timeout vs. invalid input)
- ❌ **Retry exhaustion** - No status for "failed after max retries"

### 2. Task Status Tracking (src/types.ts)

```typescript
export interface RuleTask {
  taskId: string;
  jobId: string;
  documentId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'retry';
  attempt: number;
  maxAttempts: number;
  error?: string;  // ✅ Error message stored
  // ...
}
```

**Task-level tracking:**
- ✅ Tracks individual task failures
- ✅ Records retry attempts
- ✅ Stores error messages
- ❌ No timeout-specific tracking
- ❌ Error message is free-form text (not categorized)

### 3. Worker Timeout Mechanism (src/worker.ts)

```typescript
async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Execution timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    fn()
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
```

**Current implementation:**
- ✅ Timeout wrapper exists
- ✅ Used in worker task execution
- ⚠️ Default: **30,000ms (30 seconds)** - Too long?
- ❌ Timeout errors not distinguished from other errors
- ❌ No graceful cleanup on timeout (worker thread keeps running)

**Usage in worker:**
```typescript
const executionTimeout = timeout || initData.config.taskTimeout;
const results = await executeWithTimeout(
  () => spectral!.run(document),
  executionTimeout
);
```

### 4. Error Handling in Orchestrator (src/orchestrator.ts)

```typescript
catch (error) {
  // Task failed after all retries
  task.status = 'failed';
  task.endTime = new Date();
  task.error = error instanceof Error ? error.message : String(error);

  job.progress.runningTasks--;
  job.progress.failedTasks++;

  errors.push(task.error);
  console.error(`❌ Task ${task.taskId} failed:`, task.error);
}
```

**Current behavior:**
- ✅ Catches all errors (including timeouts)
- ✅ Marks task as 'failed'
- ✅ Stores error message
- ❌ No distinction between error types
- ❌ Timeout looks like any other failure

### 5. Current Timeout Configuration (src/config.ts)

```typescript
workerPool: {
  taskTimeout: 30000,  // 30 seconds
  maxRetries: 3,
  // ...
}
```

**Configuration hierarchy:**
1. Environment variable: `SPECTIFYD_WORKER_TIMEOUT`
2. Config file: `workerPool.taskTimeout`
3. Default: 30,000ms (30 seconds)

---

## Problem Analysis

### Problem 1: No TIMEOUT Status

**Current behavior:**
```typescript
// Worker throws generic error
reject(new Error(`Execution timeout after ${timeoutMs}ms`));

// Orchestrator catches as generic failure
task.status = 'failed';
task.error = "Execution timeout after 30000ms";
```

**Impact:**
- Users can't distinguish timeout from crash
- No metrics on how often timeouts occur
- Can't adjust retry strategy based on timeout vs. crash
- No visibility into whether timeout is ruleset-specific

**Example user confusion:**
```
Job failed with error: "Execution timeout after 30000ms"
→ Was the document too large?
→ Is the ruleset slow?
→ Did Spectral hang?
→ Is 30s not enough time?
```

### Problem 2: Timeout Too Long (30s)

**Current default**: 30 seconds  
**User suggestion**: 5 seconds

**Considerations:**

| Timeout | Pros | Cons |
|---------|------|------|
| **5s** | ✅ Fast feedback<br>✅ Prevents long hangs<br>✅ Good for CI/CD | ❌ May timeout on large docs<br>❌ May timeout on complex rules<br>❌ May timeout on slow systems |
| **30s** | ✅ Handles large documents<br>✅ Handles complex rulesets<br>✅ Fewer false positives | ❌ Long wait for hangs<br>❌ Bad user experience<br>❌ Ties up workers |

**Real-world data needed:**
- What's the 95th percentile execution time for typical documents?
- How long do large (500KB+) documents take?
- Do any rulesets consistently take >5s?

**Recommendation**: Make timeout **configurable per-request** with smart defaults:
- **Default**: 30s (safe for all cases)
- **Fast mode**: 5s (CI/CD, quick checks)
- **Slow mode**: 60s (large documents, complex rules)

### Problem 3: No Persistent Failure Tracking

**Current storage** (src/storage/memory-storage.ts):
```typescript
private jobs: Map<string, LintJobResult> = new Map();
```

**Impact:**
- ❌ Server restart = lose all job history
- ❌ Can't analyze failure patterns over time
- ❌ Can't debug intermittent failures
- ❌ No audit trail for compliance

**What should be persisted:**
- Job ID, document ID, ruleset name/version
- Status (completed, failed, timeout)
- Error message and stack trace
- Execution time
- Timestamp
- Retry attempts

### Problem 4: No Failure Categorization

**Current**: Single `error` string field  
**Need**: Structured error types

**Missing categories:**
- **TIMEOUT** - Execution exceeded time limit
- **CRASH** - Spectral threw unhandled exception
- **INVALID_DOCUMENT** - Document malformed or invalid OpenAPI
- **INVALID_RULESET** - Ruleset failed to load
- **WORKER_DIED** - Worker thread crashed
- **OUT_OF_MEMORY** - Worker ran out of memory
- **RETRY_EXHAUSTED** - Failed after max retry attempts

---

## Recommended Solution

### Phase 1: Add TIMEOUT Status (Immediate - 2 hours)

**1. Add new status type:**
```typescript
export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'timeout'           // NEW: Execution exceeded timeout
  | 'cancelled';
```

**2. Update worker to distinguish timeout errors:**
```typescript
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
```

**3. Update orchestrator to detect timeout:**
```typescript
catch (error) {
  const isTimeout = error instanceof Error && (error as any).code === 'TIMEOUT';
  
  task.status = isTimeout ? 'timeout' : 'failed';
  task.error = error instanceof Error ? error.message : String(error);
  
  if (isTimeout) {
    job.progress.timeoutTasks++;
    console.error(`⏱️ Task ${task.taskId} timed out`);
  } else {
    job.progress.failedTasks++;
    console.error(`❌ Task ${task.taskId} failed:`, task.error);
  }
}
```

**4. Update JobProgress type:**
```typescript
export interface JobProgress {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  timeoutTasks: number;  // NEW
  runningTasks: number;
  queuedTasks: number;
}
```

### Phase 2: Make Timeout Configurable (2 hours)

**1. Add timeout to request:**
```typescript
export interface LintJobRequest {
  documentId: string;
  rulesetName: string;
  rulesetVersion?: string;
  options?: {
    forceRun?: boolean;
    priority?: 'low' | 'normal' | 'high';
    timeout?: number;  // NEW: Override default timeout (ms)
  };
}
```

**2. Update API endpoint:**
```typescript
// POST /lint
app.post('/lint', async (request, reply) => {
  const { documentId, rulesetName, rulesetVersion, options } = request.body;
  
  // Validate timeout (5s min, 300s max)
  if (options?.timeout) {
    if (options.timeout < 5000) {
      return reply.code(400).send({ 
        error: 'Timeout must be at least 5000ms (5 seconds)' 
      });
    }
    if (options.timeout > 300000) {
      return reply.code(400).send({ 
        error: 'Timeout cannot exceed 300000ms (5 minutes)' 
      });
    }
  }
  
  const jobId = await orchestrator.submitJob({
    documentId,
    rulesetName,
    rulesetVersion,
    options
  });
  
  return { jobId };
});
```

**3. Pass timeout to worker:**
```typescript
// In orchestrator.ts
const result = await this.workerPool.executeTask({
  taskId: task.taskId,
  documentId: task.documentId,
  documentPath: task.documentPath,
  rulesetName: task.rulesetName,
  rulesetVersion: task.rulesetVersion,
  timeout: request.options?.timeout  // NEW: Pass through
});
```

**4. Add smart defaults based on document size:**
```typescript
function calculateTimeout(documentSizeBytes: number, baseTimeout: number): number {
  const MB = documentSizeBytes / (1024 * 1024);
  
  if (MB < 0.1) return Math.min(baseTimeout, 5000);   // Small: 5s max
  if (MB < 1) return Math.min(baseTimeout, 15000);    // Medium: 15s max
  if (MB < 10) return Math.min(baseTimeout, 30000);   // Large: 30s max
  return Math.min(baseTimeout, 60000);                // Huge: 60s max
}
```

### Phase 3: Add Failure Categorization (4 hours)

**1. Define error types:**
```typescript
export type TaskErrorType =
  | 'timeout'              // Execution exceeded timeout
  | 'spectral_error'       // Spectral threw exception
  | 'document_error'       // Invalid or malformed document
  | 'ruleset_error'        // Ruleset failed to load
  | 'worker_crash'         // Worker thread died
  | 'out_of_memory'        // Worker OOM
  | 'validation_error'     // Document validation failed
  | 'unknown';             // Unclassified error

export interface TaskError {
  type: TaskErrorType;
  message: string;
  code?: string;
  stack?: string;
  metadata?: Record<string, any>;
}
```

**2. Update RuleTask:**
```typescript
export interface RuleTask {
  taskId: string;
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'retry' | 'timeout';
  attempt: number;
  error?: TaskError;  // Structured error instead of string
  // ...
}
```

**3. Categorize errors in worker:**
```typescript
catch (error) {
  let errorType: TaskErrorType = 'unknown';
  let errorCode: string | undefined;
  
  if (error instanceof Error) {
    // Categorize based on error message/code
    if ((error as any).code === 'TIMEOUT') {
      errorType = 'timeout';
    } else if (error.message.includes('out of memory')) {
      errorType = 'out_of_memory';
    } else if (error.message.includes('parse error') || error.message.includes('invalid JSON')) {
      errorType = 'document_error';
    } else if (error.name === 'SpectralError') {
      errorType = 'spectral_error';
    }
    
    errorCode = (error as any).code;
  }
  
  sendMessage({
    type: 'result',
    payload: {
      taskId,
      success: false,
      error: {
        type: errorType,
        message: error instanceof Error ? error.message : String(error),
        code: errorCode,
        stack: error instanceof Error ? error.stack : undefined
      },
      executionTime,
      timestamp: new Date().toISOString()
    }
  });
}
```

### Phase 4: Persistent Failure Tracking (4 hours)

**1. Add to storage interface:**
```typescript
export interface LintResultStorage {
  // Existing methods...
  
  // NEW: Store execution metrics
  storeExecutionMetrics(metrics: ExecutionMetrics): Promise<void>;
  
  // NEW: Query failures
  getRecentFailures(limit: number): Promise<LintJobResult[]>;
  getFailuresByType(errorType: TaskErrorType, limit: number): Promise<LintJobResult[]>;
  getFailuresByRuleset(rulesetName: string, limit: number): Promise<LintJobResult[]>;
  
  // NEW: Analytics
  getFailureStats(since: Date): Promise<FailureStats>;
}

export interface ExecutionMetrics {
  jobId: string;
  documentId: string;
  rulesetName: string;
  rulesetVersion: string;
  status: JobStatus;
  errorType?: TaskErrorType;
  errorMessage?: string;
  executionTime: number;
  timestamp: Date;
  retryCount: number;
}

export interface FailureStats {
  totalJobs: number;
  failedJobs: number;
  timeoutJobs: number;
  failureRate: number;
  averageExecutionTime: number;
  errorsByType: Record<TaskErrorType, number>;
  errorsByRuleset: Record<string, number>;
}
```

**2. Implement in memory storage (for now):**
```typescript
export class MemoryLintStorage implements LintResultStorage {
  private jobs: Map<string, LintJobResult> = new Map();
  private metrics: ExecutionMetrics[] = [];  // NEW: Keep last 10,000 metrics
  
  async storeExecutionMetrics(metrics: ExecutionMetrics): Promise<void> {
    this.metrics.push(metrics);
    
    // Keep only last 10,000 entries
    if (this.metrics.length > 10000) {
      this.metrics = this.metrics.slice(-10000);
    }
  }
  
  async getRecentFailures(limit: number): Promise<LintJobResult[]> {
    return Array.from(this.jobs.values())
      .filter(job => job.status === 'failed' || job.status === 'timeout')
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }
  
  async getFailureStats(since: Date): Promise<FailureStats> {
    const recentMetrics = this.metrics.filter(m => m.timestamp >= since);
    
    const failedJobs = recentMetrics.filter(m => 
      m.status === 'failed' || m.status === 'timeout'
    ).length;
    
    const timeoutJobs = recentMetrics.filter(m => 
      m.status === 'timeout'
    ).length;
    
    // ... calculate other stats
    
    return {
      totalJobs: recentMetrics.length,
      failedJobs,
      timeoutJobs,
      failureRate: failedJobs / recentMetrics.length,
      // ...
    };
  }
}
```

**3. Add stats endpoint:**
```typescript
// GET /stats/failures
app.get('/stats/failures', async (request, reply) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24h
  const stats = await storage.getFailureStats(since);
  return stats;
});

// GET /failures/recent
app.get('/failures/recent', async (request, reply) => {
  const { limit = 100 } = request.query as any;
  const failures = await storage.getRecentFailures(limit);
  return { failures };
});
```

---

## Implementation Priority

### 🔴 Critical (Do First)
1. **Add TIMEOUT status** - Distinguish timeout from failure (2 hours)
2. **Make timeout configurable** - Allow per-request override (2 hours)
3. **Update API documentation** - Document timeout behavior

### 🟡 Important (Do Soon)
4. **Add failure categorization** - Structured error types (4 hours)
5. **Add basic metrics tracking** - Track failures in memory (2 hours)
6. **Add stats endpoint** - Expose failure statistics (2 hours)

### 🟢 Nice to Have (Future)
7. **Persistent storage** - Redis/database for metrics (8 hours)
8. **Smart timeout calculation** - Based on document size (4 hours)
9. **Alerting** - Notify on high failure rates (8 hours)
10. **Retry strategies** - Different strategies for timeout vs. crash (8 hours)

---

## Recommendations Summary

### 1. Add TIMEOUT Status Immediately
✅ Users need to distinguish timeout from crash  
✅ Enables better monitoring and debugging  
✅ Low effort, high value  

### 2. Keep 30s Default, Add Configuration
✅ 30s is safe for most documents  
✅ Allow override for specific use cases  
✅ Add smart defaults based on document size  
⚠️ 5s may be too aggressive for large documents  

### 3. Categorize Failures
✅ Structured errors enable better analytics  
✅ Different error types need different handling  
✅ Helps identify systemic issues (ruleset bugs, OOM, etc.)  

### 4. Track Metrics Persistently
✅ Essential for debugging intermittent issues  
✅ Enables analytics and monitoring  
✅ Start with in-memory (10K entries), move to Redis/DB later  

### 5. Add Worker Health Monitoring
✅ Detect when workers hang or crash  
✅ Auto-restart failed workers  
✅ Track worker-specific failure rates  

---

## Testing Strategy

### Unit Tests
```typescript
describe('Timeout handling', () => {
  it('should mark job as timeout when execution exceeds limit', async () => {
    const job = await orchestrator.submitJob({
      documentId: 'doc-123',
      rulesetName: 'pubhub',
      options: { timeout: 100 } // Very short
    });
    
    await sleep(200);
    const result = await orchestrator.getJobStatus(job);
    expect(result.status).toBe('timeout');
  });
  
  it('should distinguish timeout from crash', async () => {
    // Test that timeout errors are marked differently than crashes
  });
});
```

### Integration Tests
```typescript
describe('Error categorization', () => {
  it('should categorize invalid document errors', async () => {
    const job = await submitJob({ documentId: 'invalid-doc' });
    const result = await getResult(job);
    expect(result.error?.type).toBe('document_error');
  });
  
  it('should categorize worker OOM errors', async () => {
    // Upload huge document that causes OOM
    // Verify error type is 'out_of_memory'
  });
});
```

### Performance Tests
```typescript
describe('Timeout behavior', () => {
  it('should timeout within configured time +/- 10%', async () => {
    const start = Date.now();
    const job = await submitJob({ timeout: 5000 });
    await waitForCompletion(job);
    const elapsed = Date.now() - start;
    
    expect(elapsed).toBeGreaterThan(4500);
    expect(elapsed).toBeLessThan(5500);
  });
});
```

---

## Migration Guide

### For API Users

**Before:**
```bash
# Only default 30s timeout
curl -X POST http://localhost:3003/lint \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "doc-123",
    "rulesetName": "pubhub"
  }'
```

**After:**
```bash
# Can specify custom timeout
curl -X POST http://localhost:3003/lint \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "doc-123",
    "rulesetName": "pubhub",
    "options": {
      "timeout": 10000
    }
  }'
```

**Status changes:**
```json
// Before: Generic failure
{
  "status": "failed",
  "error": "Execution timeout after 30000ms"
}

// After: Specific timeout status
{
  "status": "timeout",
  "error": {
    "type": "timeout",
    "message": "Execution timeout after 30000ms"
  }
}
```

### For Config Files

**Before:**
```yaml
workerPool:
  taskTimeout: 30000
```

**After (backward compatible):**
```yaml
workerPool:
  taskTimeout: 30000
  timeoutLimits:
    min: 5000
    max: 300000
    default: 30000
```

---

## Open Questions

1. **Timeout value**: Should default be 5s, 15s, or 30s?
   - Need real-world performance data
   - Suggest: Start with 30s, collect metrics, adjust

2. **Worker cleanup**: Should we kill worker thread on timeout?
   - Pro: Prevents resource leaks
   - Con: More expensive (re-initialize worker)
   - Suggest: Let worker finish, but don't wait for result

3. **Retry on timeout**: Should timeouts be retried?
   - Pro: May succeed with more time
   - Con: May just timeout again
   - Suggest: Retry with increased timeout (30s → 60s → 120s)

4. **Persistent storage**: Redis or SQLite?
   - Redis: Better for distributed, faster
   - SQLite: Simpler, no dependencies, good for single-node
   - Suggest: SQLite first, Redis as option

---

## Related Documents

- [EXECUTION_SESSION_TRACKING.md](EXECUTION_SESSION_TRACKING.md) - Session ID tracking
- [LINT_ORCHESTRATOR_DESIGN.md](LINT_ORCHESTRATOR_DESIGN.md) - Overall architecture
- [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) - Design decisions

---

## Conclusion

The current implementation has basic error handling but lacks:
1. ❌ Explicit TIMEOUT status
2. ❌ Configurable timeouts
3. ❌ Failure categorization
4. ❌ Persistent metrics tracking

**Recommended approach:**
- **Phase 1** (immediate): Add TIMEOUT status and configurability
- **Phase 2** (next sprint): Add failure categorization
- **Phase 3** (future): Add persistent metrics and analytics

**Impact:**
- Better user experience (understand why jobs fail)
- Better monitoring (track timeout rates)
- Better debugging (categorized errors)
- Better operations (persistent metrics)
