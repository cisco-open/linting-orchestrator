# Report Service Architecture

**Status**: Design Phase  
**Author**: System Design  
**Date**: 2026-02-04

## Executive Summary

This document proposes a **standalone Report Service** that acts as a companion to Spectify, providing persistent storage and web-based visualization of lint job results. By decoupling report management from the core Spectify orchestrator, we gain flexibility, persistence across restarts, and simpler deployment options.

---

## Table of Contents

- [Motivation](#motivation)
- [Design Goals](#design-goals)
- [Architecture Overview](#architecture-overview)
- [Service Communication](#service-communication)
- [Data Model](#data-model)
- [Web UI Features](#web-ui-features)
- [Deployment Modes](#deployment-modes)
- [API Design](#api-design)
- [Implementation Plan](#implementation-plan)
- [Alternatives Considered](#alternatives-considered)
- [Open Questions](#open-questions)

---

## Motivation

### Current State (v0.8.0)

Spectify provides:
- **API endpoints**: `GET /lint/jobs`, `GET /lint/jobs/details` for querying jobs
- **In-memory storage**: Jobs stored in `MemoryLintStorage`, lost on restart
- **Session-based filtering**: Only shows jobs from current server session
- **CLI access**: `spectify jobs` command for terminal-based browsing

### Problems

1. **No persistence**: Job results disappear when Spectify restarts
2. **No web UI**: Users must use CLI or direct API calls
3. **Session isolation**: Historical data lost across restarts
4. **Coupling**: Adding HTML rendering to Spectify complicates the core service

### Proposed Solution

**Separate Report Service** that:
- ✅ Persists job results across Spectify restarts
- ✅ Provides web UI for browsing job history
- ✅ Runs independently (can be stopped/started separately)
- ✅ Optional in test/embedded mode, recommended for production
- ✅ Receives notifications from Spectify when jobs complete
- ✅ Stores results in database (SQLite, PostgreSQL, etc.)

---

## Design Goals

### Must Have

1. **Independence**: Report service runs as separate process
2. **Persistence**: Job results survive Spectify restarts
3. **Event-driven**: Spectify notifies Report service when jobs complete
4. **Web UI**: Browse jobs, view details, explore results
5. **Backward compatible**: Spectify works without Report service (test mode)

### Should Have

1. **Lightweight**: SQLite for simple deployments, PostgreSQL for production
2. **Fast**: Sub-100ms response times for job listing
3. **Searchable**: Filter by document, ruleset, status, date range
4. **Paginated**: Handle thousands of historical jobs

### Could Have

1. **Trends**: Charts showing error rates over time
2. **Comparisons**: Compare results across document versions
3. **Exports**: Download reports as PDF, CSV, JSON
4. **Webhooks**: Forward job completion events to external systems

---

## Architecture Overview

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Spectify Server                       │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Orchestrator │───▶│ Worker Pool  │───▶│ Memory Store │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                                                    │
│         │ (on job complete)                                 │
│         ▼                                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │          Report Notification Client                   │   │
│  │  - POST /reports/jobs (if enabled)                   │   │
│  │  - Async, non-blocking                               │   │
│  │  - Retry with exponential backoff                    │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬─────────────────────────────────────┘
                         │ HTTP POST
                         │ (job completion event)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                     Report Service (Port 3010)              │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              HTTP API (Fastify)                       │   │
│  │  - POST /reports/jobs (receive notifications)        │   │
│  │  - GET  /reports/jobs (API access)                   │   │
│  │  - GET  /reports/jobs/:id (API access)               │   │
│  │  - GET  /        (Web UI - job listing)              │   │
│  │  - GET  /jobs/:id (Web UI - job details)             │   │
│  └──────────────────────────────────────────────────────┘   │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Report Storage                           │   │
│  │  - SQLite (default, file-based)                      │   │
│  │  - PostgreSQL (production, optional)                 │   │
│  │  - Stores: jobs, results, documents, metadata        │   │
│  └──────────────────────────────────────────────────────┘   │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Web UI (Server-Rendered)                 │   │
│  │  - Job listing table (paginated)                     │   │
│  │  - Job details page (results + metadata)             │   │
│  │  - Minimal JavaScript, works without JS              │   │
│  │  - Responsive design                                 │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Loose Coupling**: Spectify and Report service communicate via HTTP
2. **Fire-and-Forget**: Spectify doesn't block on Report service responses
3. **Graceful Degradation**: Spectify works fine if Report service unavailable
4. **Single Source of Truth**: Report service stores persistent data, Spectify has in-memory cache

---

## Service Communication

### Notification Flow

**Decision**: Fire-and-forget with exponential backoff retries + temporary local storage to prevent data loss.

```typescript
// In Spectify Orchestrator (after job completes)
async function completeJob(jobId: string, result: LintJobResult) {
  // 1. Store in memory (existing behavior)
  await this.storage.storeJob(result);
  
  // 2. Notify Report service (new, optional)
  if (this.config.reportService?.enabled) {
    // Fire async - don't block job completion
    this.notifyReportService(result).catch(err => {
      logger.error('Failed to queue report notification', { jobId, error: err });
    });
  }
  
  return result;
}

async function notifyReportService(result: LintJobResult) {
  const maxRetries = 3;
  const baseDelay = 1000; // 1s, 2s, 4s
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const url = `${this.config.reportService.url}/reports/jobs`;
      const apiKey = this.config.reportService.apiKey;
      
      await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          jobId: result.jobId,
          documentId: result.documentId,
          status: result.status,
          results: result.results,
          summary: result.summary,
          metadata: result.documentMetadata,
          timestamp: result.timestamp,
        }),
        signal: AbortSignal.timeout(5000), // 5s timeout
      });
      
      logger.debug('Notified Report service', { jobId: result.jobId, attempt });
      return; // Success - exit
      
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      
      if (isLastAttempt) {
        // CRITICAL: Store locally to prevent data loss
        await this.storeFailedNotification(result);
        logger.error('Failed to notify Report service after retries - stored locally', { 
          jobId: result.jobId,
          error: error.message 
        });
      } else {
        // Exponential backoff
        const delay = baseDelay * Math.pow(2, attempt);
        logger.warn(`Retry ${attempt + 1}/${maxRetries} in ${delay}ms`, { 
          jobId: result.jobId 
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

// Temporary local storage for failed notifications
async function storeFailedNotification(result: LintJobResult) {
  const pendingDir = path.join(this.config.dataDir, 'pending-reports');
  await fs.mkdir(pendingDir, { recursive: true });
  
  const filePath = path.join(pendingDir, `${result.jobId}.json`);
  await fs.writeFile(filePath, JSON.stringify(result, null, 2));
  
  logger.info('Stored pending report notification', { 
    jobId: result.jobId, 
    path: filePath 
  });
}

// Background job to retry failed notifications (runs every 5 minutes)
async function retryFailedNotifications() {
  const pendingDir = path.join(this.config.dataDir, 'pending-reports');
  
  try {
    const files = await fs.readdir(pendingDir);
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const filePath = path.join(pendingDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const result = JSON.parse(content) as LintJobResult;
      
      try {
        // Attempt to send
        await this.notifyReportService(result);
        // Success - delete local file
        await fs.unlink(filePath);
        logger.info('Retried pending notification successfully', { 
          jobId: result.jobId 
        });
      } catch (error) {
        // Keep file for next retry
        logger.debug('Pending notification still failing', { 
          jobId: result.jobId 
        });
      }
    }
  } catch (error) {
    logger.error('Failed to retry pending notifications', { error });
  }
}
```

### Configuration

```yaml
# config.yaml (Spectify)
reportService:
  enabled: true                          # Enable report notifications
  url: 'http://localhost:3010'          # Report service URL
  apiKey: ${SPECTIFYR_API_KEY}      # Bearer token (from env var)
  timeout: 5000                          # Timeout in ms
  retries: 3                             # Retry attempts (1s, 2s, 4s)
  pendingDir: './pending-reports'        # Local storage for failed notifications
  retryInterval: 300000                  # Retry pending notifications every 5 minutes
```

---

## Data Model

> **Note**: The schema supports multiple rulesets per job (array structure), but **Spectify currently sends only ONE ruleset per job**. The Web UI assumes `results[0]` for display. This design provides future flexibility if Spectify adds multi-ruleset support.

### Report Service Database Schema

```sql
-- Jobs table (main records)
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,                   -- Job ID (UUID)
  document_id TEXT NOT NULL,             -- Document ID
  document_name TEXT,                    -- Document name (for display)
  document_version TEXT,                 -- Document version
  status TEXT NOT NULL,                  -- completed, failed, timeout
  created_at TIMESTAMP NOT NULL,         -- Job start time
  completed_at TIMESTAMP NOT NULL,       -- Job completion time
  duration_ms INTEGER,                   -- Execution time
  spectify_session_id TEXT,              -- Spectify session (for filtering)
  
  -- Indexes for fast queries
  INDEX idx_jobs_document_id (document_id),
  INDEX idx_jobs_status (status),
  INDEX idx_jobs_completed_at (completed_at DESC),
  INDEX idx_jobs_session (spectify_session_id)
);

-- Ruleset results (one row per ruleset executed)
CREATE TABLE ruleset_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,                  -- Foreign key to jobs.id
  ruleset_name TEXT NOT NULL,            -- Ruleset name (pubhub, contract, etc.)
  status TEXT NOT NULL,                  -- completed, failed, timeout
  issue_count INTEGER DEFAULT 0,         -- Total issues found
  error_count INTEGER DEFAULT 0,         -- Errors
  warning_count INTEGER DEFAULT 0,       -- Warnings
  info_count INTEGER DEFAULT 0,          -- Info
  hint_count INTEGER DEFAULT 0,          -- Hints
  duration_ms INTEGER,                   -- Ruleset execution time
  results_json TEXT,                     -- Full results (JSON blob)
  
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  INDEX idx_ruleset_job (job_id),
  INDEX idx_ruleset_name (ruleset_name)
);

-- Document metadata cache (avoid re-fetching)
CREATE TABLE documents (
  id TEXT PRIMARY KEY,                   -- Document ID
  name TEXT NOT NULL,                    -- Document name
  version TEXT,                          -- Document version
  organization TEXT,                     -- Organization
  format TEXT,                           -- openapi, swagger
  last_linted_at TIMESTAMP,              -- Last lint timestamp
  total_lints INTEGER DEFAULT 0,         -- Total times linted
  
  INDEX idx_documents_name (name),
  INDEX idx_documents_org (organization)
);
```

### Database

**Decision**: SQLite for initial implementation, PostgreSQL support added later.

**SQLite Schema** (`report-service/schema.sql`) - see Data Model section above.

**SQLite Benefits:**
- Zero configuration (file-based)
- No separate database process
- Perfect for development and small deployments
- Easy backup (single file)
- Sufficient for 10k+ reports

**PostgreSQL Migration Path** (future enhancement):
- Add `pg` dependency
- Create adapter interface: `DatabaseAdapter`
- Implement `SQLiteAdapter` and `PostgresAdapter`
- Configuration: `database.type: 'sqlite' | 'postgres'`

### Data Retention

**Decision**: Full retention by default with manual cleanup script.

- **Default**: No automatic deletion (keeps all reports)
- **Manual Cleanup**: CLI tool to delete reports older than N days
  ```bash
  # Delete reports older than 90 days
  spectify-report-service cleanup --days 90
  
  # Dry run (show what would be deleted)
  spectify-report-service cleanup --days 90 --dry-run
  ```
- **Cleanup Script**: 
  - Accepts `--days N` parameter
  - Deletes jobs where `completed_at < NOW() - N days`
  - Cascade deletes ruleset_results via foreign key
  - Updates documents table (last_linted_at, total_lints)
  - Logs deleted count and freed disk space

**Rationale**: Production environments need control over when data is deleted. Manual cleanup allows operators to:
- Review retention needs before deletion
- Run cleanup during maintenance windows
- Archive data before deletion if needed
- Adjust retention based on disk usage

---

## Web UI Features

**Decision**: Simple server-side HTML templates (Handlebars or EJS).

### 1. Job Listing Page (`/`)

**URL**: `http://localhost:3010/`

**Features**:
- Table showing recent jobs (most recent first)
- Columns: Timestamp, Document Name, Status, Issues, Duration, Actions
- Pagination (50 jobs per page)
- Filters: Status, Document, Ruleset, Date Range
- Search bar (document name)
- Color-coded status badges

**Example Layout**:
```
╔══════════════════════════════════════════════════════════════════╗
║                    Spectify Lint Reports                         ║
╠══════════════════════════════════════════════════════════════════╣
║  Search: [____________________]  Status: [All ▾]  Date: [Last 7d]║
╠══════════════════════════════════════════════════════════════════╣
║ Timestamp          Document Name        Status     Issues  Time  ║
╠══════════════════════════════════════════════════════════════════╣
║ 2026-02-04 10:23  Meraki Dashboard API  ✓ Done    3E 2W   1.2s  ║
║ 2026-02-04 09:15  Webex Teams API       ✓ Done    0       0.8s  ║
║ 2026-02-04 08:45  DNA Center API        ✗ Failed  -       -     ║
║ 2026-02-03 16:30  ThousandEyes API      ⏱ Timeout -       30s   ║
╠══════════════════════════════════════════════════════════════════╣
║                      ◀ 1 2 3 ... 10 ▶                            ║
╚══════════════════════════════════════════════════════════════════╝
```

### 2. Job Details Page (`/jobs/:id`)

**URL**: `http://localhost:3010/jobs/abc123`

**Features**:
- Job metadata (ID, timestamp, duration)
- Document information (name, version, organization)
- Ruleset results (expandable sections)
- Issue breakdown by severity
- Individual issues with file location, rule, message
- Download options (JSON, SARIF)

**Example Layout**:
```
╔══════════════════════════════════════════════════════════════════╗
║  Job: abc123                        Status: ✓ Completed          ║
╠══════════════════════════════════════════════════════════════════╣
║  Document: Meraki Dashboard API v1.2.0                           ║
║  Started:  2026-02-04 10:23:15                                   ║
║  Duration: 1.2s                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  Ruleset Results                                                 ║
╠══════════════════════════════════════════════════════════════════╣
║  ▼ PubHub Readiness (v1.1.0)                    3 errors, 2 warns║
║     - [E] Missing description (line 45)                          ║
║     - [E] Invalid version format (line 12)                       ║
║     - [E] Missing contact email (line 8)                         ║
║     - [W] Missing examples (line 120)                            ║
║     - [W] Long path segment (line 67)                            ║
║                                                                   ║
║  ▼ Contract Documentation (v2.0.0)                         ✓ Pass║
║     No issues found.                                             ║
╠══════════════════════════════════════════════════════════════════╣
║  [Download JSON] [Download SARIF] [View Raw Results]             ║
╚══════════════════════════════════════════════════════════════════╝
```

### 3. Technology Stack

**Backend**:
- **Fastify**: HTTP server (same as Spectify)
- **SQLite**: Default database (single file, no setup)
- **PostgreSQL**: Optional (production deployments)

**Frontend**:
- **Server-Side Rendering**: HTML generated on server
- **Minimal JavaScript**: Progressive enhancement only
- **Tailwind CSS**: Utility-first styling
- **No build step**: Keep it simple

**Why server-side?**
- ✅ Works without JavaScript
- ✅ Faster initial load
- ✅ SEO-friendly
- ✅ Simpler deployment (no frontend build)

---

## Deployment Modes

### Test/Embedded Mode (Default)

```bash
# Spectify runs standalone, no Report service
spectify lint document.yaml
# Results shown in CLI, not persisted
```

**Configuration**:
```yaml
reportService:
  enabled: false  # Default for embedded mode
```

### Standalone Mode (Production)

```bash
# Terminal 1: Start Report service
report-service --port 3010 --db ./reports.db

# Terminal 2: Start Spectify with Report service enabled
spectify-server --port 3003 --report-service http://localhost:3010
```

**Configuration**:
```yaml
# spectify config
reportService:
  enabled: true
  url: 'http://localhost:3010'
  
# report-service config
database:
  type: 'sqlite'
  path: './reports.db'
server:
  port: 3010
  host: '0.0.0.0'
```

### Docker Compose

```yaml
version: '3.8'
services:
  spectify:
    image: spectify:latest
    ports:
      - "3003:3003"
    environment:
      - SPECTIFYR_URL=http://report-service:3010
      - SPECTIFYR_ENABLED=true
    depends_on:
      - report-service
  
  report-service:
    image: spectify-reports:latest
    ports:
      - "3010:3010"
    volumes:
      - ./reports.db:/data/reports.db
    environment:
      - DATABASE_PATH=/data/reports.db
```

---

## API Design

### Report Service API

#### POST /reports/jobs
**Purpose**: Receive job completion notifications from Spectify

**Authentication**: Bearer token (API key)

**Request**:
```json
{
  "jobId": "abc123",
  "documentId": "doc456",
  "status": "completed",
  "results": [
    {
      "rulesetName": "pubhub",
      "status": "completed",
      "issues": [...],
      "summary": { "errorCount": 3, "warningCount": 2 }
    }
  ],
  "summary": { "totalIssues": 5, "duration": 1200 },
  "metadata": {
    "name": "Meraki Dashboard API",
    "version": "1.2.0"
  },
  "timestamp": "2026-02-04T10:23:15Z"
}
```

**Headers**:
```
Authorization: Bearer <SPECTIFYR_API_KEY>
Content-Type: application/json
```

**Response**:
```json
{
  "success": true,
  "jobId": "abc123"
}
```

#### GET /reports/jobs
**Purpose**: List jobs (API endpoint)

**Query Parameters**:
- `status`: Filter by status
- `documentId`: Filter by document
- `rulesetName`: Filter by ruleset
- `limit`: Page size (default: 50)
- `offset`: Pagination offset

**Response**:
```json
{
  "jobs": [...],
  "total": 1234,
  "limit": 50,
  "offset": 0
}
```

#### GET /reports/jobs/:id
**Purpose**: Get job details (API endpoint)

**Response**:
```json
{
  "jobId": "abc123",
  "documentId": "doc456",
  "status": "completed",
  "results": [...],
  "metadata": {...},
  "timestamp": "2026-02-04T10:23:15Z"
}
```

### Web UI Routes

- `GET /` - Job listing (HTML)
- `GET /jobs/:id` - Job details (HTML)
- `GET /health` - Health check

---

## Implementation Plan

### Phase 1: Report Service Foundation (3-4 days)

**Goal**: Basic service that receives and stores job results

**Tasks**:
1. Create `report-service/` directory structure
2. Set up Fastify HTTP server
3. Implement SQLite database schema
4. Add `POST /reports/jobs` endpoint
5. Add `GET /reports/jobs` API endpoint
6. Add `GET /reports/jobs/:id` API endpoint
7. Write unit tests

**Deliverables**:
- Report service runs standalone
- Receives notifications from Spectify
- Stores jobs in SQLite
- API endpoints work

### Phase 2: Client Library (2 days)

**Goal**: Create reusable TypeScript connector library

**Tasks**:
1. Create `ReportServiceClient` class in `src/client/`
2. Implement retry logic with exponential backoff
3. Local pending storage for failed notifications
4. Background retry scheduler (optional)
5. Client library tests
6. Integration guide and examples

**Deliverables**:
- Reusable client library that any service can import
- `import { ReportServiceClient } from 'spectify-reports'`
- Complete with retry, local backup, and scheduler
- Tests validate client behavior
- Documentation for integration (used by Spectify, etc.)

### Phase 3: Web UI (4-5 days)

**Goal**: Web interface for browsing job history

**Tasks**:
1. Set up HTML templating (Handlebars or similar)
2. Implement job listing page with pagination
3. Implement job details page
4. Add search and filter controls
5. Add responsive CSS styling
6. Test without JavaScript

**Deliverables**:
- Web UI accessible at `http://localhost:3010`
- Job listing works with pagination
- Job details show full results
- Works on mobile

### Phase 4: Polish & Production (2-3 days)

**Goal**: Production-ready deployment

**Tasks**:
1. Add PostgreSQL support (optional)
2. Implement data retention/cleanup
3. Add Docker images
4. Add deployment documentation
5. Performance testing (1000+ jobs)
6. Security review

**Deliverables**:
- Docker Compose setup
- Production deployment guide
- Performance benchmarks
- Security hardening

**Total Estimate**: 11-14 days

---

## Alternatives Considered

### Alternative 1: Embed Web UI in Spectify

**Pros**:
- Single service to deploy
- No separate process management
- Simpler architecture

**Cons**:
- ❌ Tight coupling (UI changes require Spectify rebuild)
- ❌ No persistence (results lost on restart)
- ❌ Memory bloat (storing HTML in Spectify)
- ❌ Harder to scale (web traffic impacts linting)

**Verdict**: Rejected for flexibility and persistence reasons

### Alternative 2: Use MCP as Report Store

**Pros**:
- Leverage existing MCP infrastructure
- MCP already has document store

**Cons**:
- ❌ Couples Spectify to MCP (not standalone)
- ❌ MCP doesn't store lint results (only documents)
- ❌ Violates separation of concerns

**Verdict**: Rejected to maintain Spectify independence

### Alternative 3: Event Queue (Kafka, RabbitMQ)

**Pros**:
- Decoupled communication
- Scalable event processing
- Retries built-in

**Cons**:
- ❌ Too complex for simple use case
- ❌ Requires additional infrastructure
- ❌ Overkill for single-producer, single-consumer

**Verdict**: Deferred for future if scaling needed

---

## Open Questions → Design Decisions

All architectural questions have been resolved:

### 1. Data Retention Policy

**✅ DECISION**: Full retention by default with manual cleanup script.

- No automatic deletion (keeps all reports)
- Manual cleanup tool: `spectify-report-service cleanup --days 90`
- Operator controls when and how much data to delete
- See [Data Retention](#data-retention) section above for details

### 2. Authentication

**✅ DECISION**: API key authentication for Spectify notifications.

- API key passed via `SPECTIFYR_API_KEY` environment variable
- Spectify includes key in `Authorization: Bearer <token>` header
- Same pattern as Spectify uses for its own API authentication
- Web UI can be added in Phase 2 if needed (browser-based auth)

### 3. Database Choice

**✅ DECISION**: SQLite for initial implementation, PostgreSQL later.

- SQLite default (zero-config, file-based)
- PostgreSQL support added in future enhancement
- Adapter pattern to support both
- See [Database](#database) section above for schema details

### 4. Notification Delivery Guarantees

**✅ DECISION**: Fire-and-forget with exponential retries + temporary local storage.

- 3 retry attempts with exponential backoff (1s, 2s, 4s)
- If all retries fail, store notification locally in `pending-reports/` directory
- Background job retries pending notifications every 5 minutes
- **Never lose production reports** - local storage ensures persistence
- See [Notification Flow](#notification-flow) section above for implementation details

### 5. Web UI Framework

**✅ DECISION**: Simple server-side HTML templates (Handlebars or EJS).

- No build step required
- Easy to maintain
- Works without JavaScript
- Sufficient for browsing and viewing reports

---

## Success Criteria

### Must Have (MVP)

- ✅ Report service runs standalone
- ✅ Receives job completion notifications from Spectify
- ✅ Stores jobs in SQLite
- ✅ Web UI shows job listing
- ✅ Web UI shows job details
- ✅ Survives Spectify restarts
- ✅ Works in Docker Compose

### Should Have (Production)

- ✅ PostgreSQL support
- ✅ Data retention/cleanup
- ✅ Pagination for large datasets
- ✅ Search and filtering
- ✅ Responsive design

### Could Have (Future)

- 📊 Charts and trends
- 📥 Export to PDF/CSV
- 🔔 Webhook notifications
- 🔍 Full-text search on issues

---

## Next Steps

**All architectural decisions finalized. Ready for implementation.**

1. ✅ **Design Review**: Complete - all 5 questions resolved
2. **Create Project Structure**: Set up `report-service/` directory
3. **Phase 1 Implementation**: Foundation (3-4 days)
   - Fastify server with API key auth
   - SQLite database setup
   - POST /reports/jobs endpoint
   - Notification retry + local storage
   - Background retry job
4. **Phase 2 Implementation**: Spectify Integration (2 days)
   - Add reportService config
   - Implement notification client
   - Add pending notification storage
   - Integration tests
5. **Phase 3 Implementation**: Web UI (4-5 days)
   - HTML templates (Handlebars/EJS)
   - Job listing page
   - Job details page
   - Search/filter controls
6. **Phase 4 Implementation**: Production Polish (2-3 days)
   - Manual cleanup CLI tool
   - Docker images
   - Deployment docs
   - Performance testing

**Estimated Start**: Immediately (design approved)  
**Estimated Completion**: 2-3 weeks (11-14 days)

---

## References

- [Spectify MCP Integration](../../../orchestrator/docs/internal/integrations/spectify-mcp.md) - Companion service patterns
- [Deployment Modes](../../../orchestrator/docs/deployment-modes.md) - Port allocation and service architecture
