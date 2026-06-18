# Client Integration Guide

**ReportServiceClient** — TypeScript library for integrating with the
linting reporting service (`spectifyr`).
Reports Service (`spectifyr`).

---

## Quick Start

### Installation

If using as a library from this repo:

```typescript
import { ReportServiceClient } from './path/to/linting-reports/src/client/index.js';
```

Or if published as npm package:

```bash
npm install @cisco-open/linting-reports
```

```typescript
import { ReportServiceClient } from '@cisco-open/linting-reports';
```

### Basic Usage

```typescript
import { ReportServiceClient } from '@cisco-open/linting-reports';

// Create client
const client = new ReportServiceClient({
  url: 'http://localhost:3010',
  apiKey: process.env.SPECTIFYR_API_KEY!,
});

// Initialize (creates pending directory)
await client.initialize();

// Send notification (fire-and-forget)
const result = await client.notify({
  jobId: 'job-123',
  documentId: 'doc-456',
  status: 'completed',
  results: [...],
  summary: {...},
  metadata: {...},
  timestamp: new Date().toISOString(),
});

if (result.success) {
  console.log('Notification sent successfully');
} else if (result.storedLocally) {
  console.log('Notification stored for retry');
}
```

---

## Configuration

### Required Options

```typescript
interface ReportServiceClientConfig {
  url: string;        // Report Service URL
  apiKey: string;     // API key for authentication
}
```

### Optional Options

```typescript
interface ReportServiceClientConfig {
  // ... required options ...
  
  timeout?: number;              // Request timeout (default: 5000ms)
  maxRetries?: number;           // Retry attempts (default: 3)
  baseRetryDelay?: number;       // Base delay for backoff (default: 1000ms)
  pendingDir?: string;           // Pending storage dir (default: './pending-reports')
  enableRetryJob?: boolean;      // Enable background retry (default: false)
  retryJobInterval?: number;     // Retry interval (default: 300000ms = 5min)
  logger?: ClientLogger;         // Custom logger (optional)
}
```

### Configuration Examples

**Minimal (for testing)**:
```typescript
const client = new ReportServiceClient({
  url: 'http://localhost:3010',
  apiKey: 'test-key',
});
```

**Production (with retry job)**:
```typescript
const client = new ReportServiceClient({
  url: process.env.SPECTIFYR_URL!,
  apiKey: process.env.SPECTIFYR_API_KEY!,
  timeout: 10000,           // 10 second timeout
  maxRetries: 5,            // 5 retry attempts
  enableRetryJob: true,     // Background retry enabled
  retryJobInterval: 300000, // Retry every 5 minutes
  logger: customLogger,     // Use your logger
});
```

**Custom logger**:
```typescript
import pino from 'pino';

const logger = pino();

const client = new ReportServiceClient({
  url: 'http://localhost:3010',
  apiKey: 'api-key',
  logger: {
    debug: (msg, meta) => logger.debug(meta, msg),
    info: (msg, meta) => logger.info(meta, msg),
    warn: (msg, meta) => logger.warn(meta, msg),
    error: (msg, meta) => logger.error(meta, msg),
  },
});
```

---

## Usage Patterns

### Pattern 1: Fire-and-Forget (Recommended)

**Use case**: Don't block on notification delivery

```typescript
// In job completion handler
async function onJobComplete(jobResult: LintJobResult) {
  // ... existing logic ...
  
  // Fire notification asynchronously (don't await)
  client.notify(toJobNotification(jobResult))
    .catch(err => logger.error('Notification failed', err));
  
  return jobResult;
}
```

### Pattern 2: Wait for Confirmation

**Use case**: Ensure notification sent before proceeding

```typescript
async function onJobComplete(jobResult: LintJobResult) {
  // ... existing logic ...
  
  const result = await client.notify(toJobNotification(jobResult));
  
  if (!result.success) {
    logger.warn('Notification not sent immediately', {
      storedLocally: result.storedLocally,
      attempts: result.attempts,
    });
  }
  
  return jobResult;
}
```

### Pattern 3: With Background Retry

**Use case**: Ensure delivery even if service temporarily down

```typescript
// Startup
const client = new ReportServiceClient({
  url: 'http://localhost:3010',
  apiKey: process.env.SPECTIFYR_API_KEY!,
  enableRetryJob: true,     // Background job enabled
  retryJobInterval: 300000, // Every 5 minutes
});

await client.initialize();

// In job handler - fire and forget
client.notify(notification).catch(/* ignore */);

// Shutdown cleanup
process.on('SIGTERM', async () => {
  await client.shutdown();
  process.exit(0);
});
```

### Pattern 4: Manual Retry Control

**Use case**: Custom retry logic or timing

```typescript
// Don't enable automatic retry job
const client = new ReportServiceClient({
  url: 'http://localhost:3010',
  apiKey: 'api-key',
  enableRetryJob: false,
});

// Manually trigger retries when you want
async function retryFailedNotifications() {
  const stats = await client.retryNow();
  console.log(`Retried ${stats.totalPending} notifications`);
  console.log(`Success: ${stats.successfulRetries}, Failed: ${stats.failedRetries}`);
}

// Call on your schedule
setInterval(retryFailedNotifications, 600000); // Every 10 minutes
```

---

## Integration Examples

### Example 1: linting orchestrator integration

```typescript
// spectify/src/orchestrator.ts
import { ReportServiceClient } from '@cisco-open/linting-reports';

class LintOrchestrator {
  private reportClient?: ReportServiceClient;

  async initialize(config: Config) {
    // ... existing init ...

    if (config.reportService?.enabled) {
      this.reportClient = new ReportServiceClient({
        url: config.reportService.url,
        apiKey: config.reportService.apiKey,
        maxRetries: config.reportService.retries || 3,
        enableRetryJob: true,
        logger: this.logger, // Reuse the orchestrator's logger

      await this.reportClient.initialize();
    }
  }

  async completeJob(jobId: string, result: LintJobResult) {
    // ... store in memory, update state, etc. ...

    // Send to reports service (fire-and-forget)
    if (this.reportClient) {
      this.reportClient.notify(this.toNotification(result))
        .catch(err => this.logger.error('Report notification failed', err));
    }

    return result;
  }

  private toNotification(result: LintJobResult): JobNotification {
    return {
      jobId: result.jobId,
      documentId: result.documentId,
      status: result.status,
      results: result.results,
      summary: result.summary,
      metadata: result.metadata,
      timestamp: result.timestamp,
      createdAt: result.createdAt,
      spectifySessionId: this.sessionId,
    };
  }

  async shutdown() {
    if (this.reportClient) {
      await this.reportClient.shutdown();
    }
  }
}
```

### Example 2: Standalone Service

```typescript
// my-service/src/index.ts
import { ReportServiceClient } from '@cisco-open/linting-reports';

const client = new ReportServiceClient({
  url: process.env.SPECTIFYR_URL || 'http://localhost:3010',
  apiKey: process.env.SPECTIFYR_API_KEY!,
  enableRetryJob: true,
});

await client.initialize();

// Use in your application
async function processLintJob(job: Job) {
  const result = await runLinter(job);
  
  // Send to Report Service
  await client.notify({
    jobId: job.id,
    documentId: job.documentId,
    status: 'completed',
    results: result.results,
    summary: result.summary,
    metadata: job.metadata,
    timestamp: new Date().toISOString(),
  });

  return result;
}
```

---

## API Reference

### ReportServiceClient

#### Methods

**`initialize(): Promise<void>`**
- Initializes client (creates pending directory, starts retry job)
- Call once at startup

**`notify(notification: JobNotification): Promise<NotificationResult>`**
- Send job notification to Report Service
- Retries automatically with exponential backoff
- Stores locally if all retries fail
- Returns result with success status

**`retryNow(): Promise<RetryStats>`**
- Manually trigger retry of pending notifications
- Returns statistics (total, success, failed)

**`getPendingCount(): Promise<number>`**
- Get count of pending notifications awaiting retry

**`clearPending(): Promise<number>`**
- Clear all pending notifications (returns count deleted)

**`getStatus(): Promise<ClientStatus>`**
- Get client status (enabled, URL, pending count, retry job status)

**`shutdown(): Promise<void>`**
- Stop retry job and cleanup
- Call before process exit

**`stopRetryJob(): void`**
- Stop background retry job (manual control)

---

## Error Handling

### Automatic Retry

Client automatically retries failed notifications:

1. **Attempt 1**: Immediate
2. **Attempt 2**: After 1 second
3. **Attempt 3**: After 2 seconds  
4. **Attempt 4**: After 4 seconds

If all attempts fail, notification is stored locally.

### Local Storage

Failed notifications stored in `pending-reports/` directory:

```
pending-reports/
├── job-123.json
├── job-456.json
└── job-789.json
```

Each file contains:
```json
{
  "notification": { /* full job notification */ },
  "attempts": 0,
  "lastAttempt": "2026-02-04T15:00:00Z",
  "createdAt": "2026-02-04T14:55:00Z"
}
```

### Background Retry

If `enableRetryJob: true`, client retries pending notifications every 5 minutes (configurable).

Successful retries automatically delete the pending file.

---

## Monitoring

### Check Status

```typescript
const status = await client.getStatus();
console.log(`Service URL: ${status.serviceUrl}`);
console.log(`Pending: ${status.pendingNotifications}`);
console.log(`Retry job running: ${status.retryJobRunning}`);
```

### Monitor Retry Stats

```typescript
const stats = await client.retryNow();
console.log(`Total pending: ${stats.totalPending}`);
console.log(`Successful: ${stats.successfulRetries}`);
console.log(`Failed: ${stats.failedRetries}`);
```

### Custom Logging

```typescript
const client = new ReportServiceClient({
  url: 'http://localhost:3010',
  apiKey: 'api-key',
  logger: {
    debug: (msg, meta) => /* your debug logger */,
    info: (msg, meta) => /* your info logger */,
    warn: (msg, meta) => /* your warn logger */,
    error: (msg, meta) => /* your error logger */,
  },
});
```

---

## Troubleshooting

### Notifications not sending

1. Check Report Service is running:
   ```bash
   curl http://localhost:3010/health
   ```

2. Verify API key matches:
   ```bash
   echo $SPECTIFYR_API_KEY
   ```

3. Check pending notifications:
   ```bash
   ls pending-reports/
   ```

4. Check client logs for errors

### Pending notifications not retrying

1. Verify retry job is enabled:
   ```typescript
   const status = await client.getStatus();
   console.log(status.retryJobRunning); // should be true
   ```

2. Manually trigger retry:
   ```typescript
   const stats = await client.retryNow();
   console.log(stats);
   ```

3. Check pending directory permissions

### High memory usage

If retry job is accumulating too many pending notifications:

1. Check Report Service availability
2. Increase retry interval
3. Clear old pending notifications:
   ```typescript
   await client.clearPending();
   ```

---

## Production Checklist

- [ ] Set `SPECTIFYR_API_KEY` environment variable
- [ ] Configure `SPECTIFYR_URL` for your environment
- [ ] Enable retry job (`enableRetryJob: true`)
- [ ] Set appropriate retry interval (default: 5 minutes)
- [ ] Configure timeout based on network latency
- [ ] Add custom logger integration
- [ ] Monitor pending notification count
- [ ] Set up alerts for high pending count
- [ ] Test graceful shutdown (call `client.shutdown()`)
- [ ] Ensure `pending-reports/` directory has write permissions

---

## TypeScript Types

All types are exported from the client library:

```typescript
import type {
  ReportServiceClientConfig,
  JobNotification,
  NotificationResult,
  RetryStats,
  ClientStatus,
  ClientLogger,
  PendingNotification,
} from '@cisco-open/linting-reports';
```

See [src/client/types.ts](../src/client/types.ts) for complete type definitions.

---

## License

MIT
