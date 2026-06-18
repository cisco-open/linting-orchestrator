# Job and Document Listing API Design

**Version:** 1.0.0  
**Date:** February 4, 2026  
**Status:** Design Proposal  
**Target:** Server v0.8.0

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Related Documentation](#related-documentation)
4. [User Stories](#user-stories)
5. [API Design](#api-design)
6. [Data Model](#data-model)
7. [Implementation Plan](#implementation-plan)
8. [Performance Considerations](#performance-considerations)
9. [Security & Privacy](#security--privacy)
10. [Testing Strategy](#testing-strategy)

---

## Executive Summary

### Purpose

Add listing and querying capabilities for lint jobs and documents, enabling users to:
- Browse all lint jobs with filtering and pagination
- View documents with rich metadata
- Discover job results by document properties (organization, name, tags)
- Track linting activity and patterns

### Key Features

1. **Job Listing API** (`GET /lint/jobs`)
   - List all jobs with pagination
   - Filter by status, documentId, rulesetName, dateRange
   - Enrich with document metadata (name, version, organization)
   - Session-aware (auto-filter stale jobs)

2. **Document Listing API** (`GET /documents`)
   - List all documents with pagination
   - Filter by tags, organization, name
   - Show document statistics (operationCount, size, uploadedAt)
   - Search by name/description

3. **Cross-Reference Capability**
   - Jobs enriched with document info
   - Documents show lint job count/status
   - "Show me all failed lints for SBG APIs"

### Design Principles

- **Leverage Existing Infrastructure**: Document store already has listing/search
- **Session Awareness**: Use runtime session ID to filter stale data
- **Pagination by Default**: Prevent overwhelming responses
- **Rich Metadata**: Surface useful information without extra queries
- **Consistent Patterns**: Match existing API conventions

---

## Problem Statement

### Current Limitations

**1. No Way to Browse Jobs**

```bash
# User has to remember job IDs
$ curl http://localhost:3003/lint/job-123
# What if I forgot the ID? No way to list all jobs!
```

**2. No Document Discovery**

```bash
# User uploaded documents but can't list them
$ curl http://localhost:3003/documents
# 404 - endpoint doesn't exist
```

**3. No Cross-Referencing**

```bash
# User sees job result but doesn't know which API it was
$ curl http://localhost:3003/lint/job-123/results
{
  "documentId": "abc-123",  # What API is this?
  "summary": { "totalIssues": 42 }
}

# Need separate call to get document info
$ curl http://localhost:3003/documents/abc-123
```

**4. No Filtering/Search**

- Can't find "all failed jobs"
- Can't find "all jobs for SBG organization"
- Can't find "recent lints for high-priority APIs"

### User Pain Points

**From CLI Users:**
> "I ran spectify lint yesterday on several APIs. How do I see which ones failed without remembering all the job IDs?"

**From API Users:**
> "I want to build a dashboard showing linting trends by organization. Currently I'd have to store job IDs myself."

**From Integration Partners:**
> "We upload documents to Spectify but have no way to list what we've uploaded. We're maintaining our own registry!"

---

## Related Documentation

### Core Architecture Documents

1. **[LINT_ORCHESTRATOR_DESIGN.md](LINT_ORCHESTRATOR_DESIGN.md)** ⭐⭐⭐
   - Current API specifications (`GET /lint/:jobId`, results)
   - Storage adapter interface
   - Job lifecycle and type system
   - **Gap**: No listing/querying endpoints

2. **[MCP_OPENAPI_ANALYZER_INTEGRATION.md](MCP_OPENAPI_ANALYZER_INTEGRATION.md)** ⭐⭐
   - Document vs Job ID distinction
   - Filesystem-based document access
   - MCP document store capabilities
   - **Insight**: MCP has `documents://list` resource (not exposed in Spectify)

3. **[pluggable-document-store.md](../pluggable-document-store.md)** ⭐⭐⭐
   - `DocumentStoreAdapter.listDocuments()` already exists!
   - `DocumentStoreAdapter.searchDocuments()` already exists!
   - Document metadata structure (name, version, tags, organization)
   - Pagination support (`ListOptions` interface)
   - **Key**: Infrastructure already exists, just needs HTTP endpoint

### Session & History

4. **[runtime-session-id.md](runtime-session-id.md)** ⭐
   - Session ID generation on server startup
   - `X-Spectify-Session-Id` header in responses
   - Detecting stale data
   - **Relevance**: Filter jobs by current session

5. **EXECUTION_SESSION_TRACKING** ❌
   - **Status**: REJECTED (over-engineering)
   - Use minimal runtime session ID instead

### Status & Metrics

6. **[error-handling-and-status-tracking.md](error-handling-and-status-tracking.md)** ⭐
   - Job status types (queued, running, completed, failed, timeout)
   - Failure statistics
   - `GET /stats` endpoint
   - **Relevance**: Filter jobs by status

### API Documentation

7. **[quick-start-api.md](../../quick-start-api.md)**
   - Current endpoints
   - **Gap**: No listing capabilities

8. **CLI Standalone Mode**
   - Document upload endpoint (`POST /documents`)
   - Mentions `GET /documents` but not implemented

---

## User Stories

### US-1: Browse All Jobs

**As a** developer  
**I want to** list all lint jobs I've submitted  
**So that** I can review results without remembering job IDs

**Acceptance Criteria:**
- GET /lint/jobs returns paginated list of jobs
- Includes job status, timestamp, documentId, rulesetName
- Defaults to recent-first sorting
- Shows job summary (issue counts)

### US-2: Filter Jobs by Status

**As a** QA engineer  
**I want to** see only failed lint jobs  
**So that** I can focus on fixing problems

**Acceptance Criteria:**
- Filter by status: `?status=failed`
- Multiple statuses: `?status=failed,timeout`
- Combined with other filters

### US-3: Find Jobs by Document

**As a** API owner  
**I want to** see all lint jobs for my API  
**So that** I can track quality over time

**Acceptance Criteria:**
- Filter by documentId: `?documentId=abc-123`
- Shows all lint runs (different rulesets)
- Sorted by most recent

### US-4: Discover Documents

**As a** developer  
**I want to** list all OpenAPI documents in Spectify  
**So that** I know what's available to lint

**Acceptance Criteria:**
- GET /documents returns document list
- Shows name, version, organization, uploadedAt
- Includes metadata (operationCount, size)
- Paginated results

### US-5: Search Documents by Organization

**As a** team lead  
**I want to** find all APIs from my organization  
**So that** I can audit our API quality

**Acceptance Criteria:**
- Filter by organization: `?organization=SBG`
- Filter by tags: `?tags=networking`
- Combined filters supported

### US-6: Enriched Job Results

**As a** dashboard builder  
**I want to** see document metadata in job listings  
**So that** I don't need to make separate API calls

**Acceptance Criteria:**
- Job listing includes document name, version
- Includes organization and operationCount
- Single API call for complete context

### US-7: Session-Aware Listings

**As a** CLI user  
**I want to** see only current session jobs  
**So that** I don't get confused by stale data after server restart

**Acceptance Criteria:**
- Jobs filtered to current session by default
- Option to see all: `?includeStale=true`
- Clear indication when results are filtered

---

## API Design

### Endpoint 1: List Jobs (Lightweight)

```http
GET /lint/jobs
```

**Purpose**: Fast listing with minimal payload. Returns job info with `documentId` only (no metadata).

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 20 | Max results (1-100) |
| `offset` | integer | 0 | Pagination offset |
| `status` | string[] | all | Filter by status (queued, running, completed, failed, timeout) |
| `documentId` | string | - | Filter by document UUID |
| `rulesetName` | string | - | Filter by ruleset |
| `rulesetVersion` | string | - | Filter by ruleset version |
| `startDate` | ISO 8601 | - | Jobs after this date |
| `endDate` | ISO 8601 | - | Jobs before this date |
| `sortBy` | enum | timestamp | Sort field (timestamp, status, documentId) |
| `sortOrder` | enum | desc | Sort order (asc, desc) |
| `includeStale` | boolean | false | Include jobs from previous sessions |

**Response Schema:**

```typescript
interface ListJobsResponse {
  jobs: JobSummary[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  session: {
    currentSessionId: string;
    staleJobsFiltered: number;  // How many excluded
  };
  filters: {
    status?: string[];
    documentId?: string;
    rulesetName?: string;
    // ... applied filters
  };
}

interface JobSummary {
  // Job info
  jobId: string;
  status: JobStatus;
  timestamp: string;
  startTime: string;
  endTime?: string;
  executionTime?: number;  // milliseconds
  
  // Lint context
  documentId: string;        // ⚡ ID only - no metadata
  rulesetName: string;
  rulesetVersion: string;
  
  // Summary
  summary: {
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    hintCount: number;
  };
  
  // Progress (for running jobs)
  progress?: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    timeoutTasks: number;
  };
}
```

**Example Request (Lightweight - Default):**

```bash
# List recent failed jobs (documentId only)
curl "http://localhost:3003/lint/jobs?status=failed&limit=10"
```

**Example Response (Lightweight):**

```json
{
  "jobs": [
    {
      "jobId": "job-789",
      "status": "failed",
      "timestamp": "2026-02-04T14:30:00Z",
      "startTime": "2026-02-04T14:30:00Z",
      "endTime": "2026-02-04T14:30:15Z",
      "executionTime": 15000,
      "documentId": "abc-123",
      "rulesetName": "pubhub",
      "rulesetVersion": "1.1.0",
      "summary": {
        "totalIssues": 42,
        "errorCount": 12,
        "warningCount": 20,
        "infoCount": 8,
        "hintCount": 2
      }
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 3,
    "hasMore": false
  },
  "session": {
    "currentSessionId": "session-xyz",
    "staleJobsFiltered": 15
  },
  "filters": {
    "status": ["failed"]
  }
}
```

**Status Codes:**

- `200 OK` - Success
- `400 Bad Request` - Invalid parameters (limit > 100, invalid status, etc.)
- `500 Internal Server Error` - Server error

---

### Endpoint 2: List Jobs with Details (Enriched)

```http
GET /lint/jobs/details
```

**Purpose**: Complete listing with document metadata enrichment. Same filters as `/lint/jobs` but includes full document info.

**Query Parameters:**

Same as `GET /lint/jobs` (all filters supported).

**Response Schema:**

```typescript
interface ListJobsDetailedResponse {
  jobs: JobDetailed[];
  pagination: PaginationInfo;
  session: SessionInfo;
  filters: AppliedFilters;
}

interface JobDetailed {
  // Job info (same as JobSummary)
  jobId: string;
  status: JobStatus;
  timestamp: string;
  startTime: string;
  endTime?: string;
  executionTime?: number;
  
  // Lint context
  documentId: string;
  rulesetName: string;
  rulesetVersion: string;
  
  // Summary
  summary: IssueSummary;
  
  // Progress
  progress?: JobProgress;
  
  // 🌟 Enriched document metadata (always present)
  document: {
    name?: string;
    version?: string;
    title?: string;
    organization?: string;
    tags?: string[];
    uploadedAt?: string;
    operationCount?: number;
    size?: number;
    format?: 'json' | 'yaml';
    openApiVersion?: string;
  };
}
```

**Example Request:**

```bash
# List with full document metadata
curl "http://localhost:3003/lint/jobs/details?status=failed&limit=10"
```

**Example Response:**

```json
{
  "jobs": [
    {
      "jobId": "job-789",
      "status": "failed",
      "timestamp": "2026-02-04T14:30:00Z",
      "startTime": "2026-02-04T14:30:00Z",
      "endTime": "2026-02-04T14:30:15Z",
      "executionTime": 15000,
      "documentId": "abc-123",
      "rulesetName": "pubhub",
      "rulesetVersion": "1.1.0",
      "summary": {
        "totalIssues": 42,
        "errorCount": 12,
        "warningCount": 20,
        "infoCount": 8,
        "hintCount": 2
      },
      "document": {
        "name": "Nexus Dashboard API",
        "version": "2.3.0",
        "title": "Nexus Dashboard API",
        "organization": "SBG",
        "tags": ["networking", "dashboard"],
        "uploadedAt": "2026-02-01T10:00:00Z",
        "operationCount": 47,
        "size": 245678,
        "format": "json",
        "openApiVersion": "3.0.0"
      }
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 3,
    "hasMore": false
  },
  "session": {
    "currentSessionId": "session-xyz",
    "staleJobsFiltered": 15
  },
  "filters": {
    "status": ["failed"]
  }
}
```

**Status Codes:**

- `200 OK` - Success
- `400 Bad Request` - Invalid parameters
- `500 Internal Server Error` - Server error

**Performance Note:** Slower than `/lint/jobs` due to document metadata enrichment (~30-50ms vs ~15-20ms).

---

### Endpoint 3: List Documents

```http
GET /documents
```

**Purpose**: List and search documents with rich metadata. Supports both listing and text search via filters.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 20 | Max results (1-100) |
| `offset` | integer | 0 | Pagination offset |
| `organization` | string | - | Filter by organization code (exact match) |
| `tags` | string[] | - | Filter by tags (any match) |
| `name` | string | - | Filter by name (partial match, case-insensitive) |
| `search` | string | - | Full-text search across name, title, description |
| `sortBy` | enum | uploadedAt | Sort field (uploadedAt, updatedAt, name, size) |
| `sortOrder` | enum | desc | Sort order (asc, desc) |
| `includeLintActivity` | boolean | false | Include lint job statistics per document |

**Response Schema:**

```typescript
interface ListDocumentsResponse {
  documents: DocumentSummary[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  filters: {
    organization?: string;
    tags?: string[];
    name?: string;
    // ... applied filters
  };
}

interface DocumentSummary {
  // Identity
  id: string;
  name?: string;
  version?: string;
  title?: string;
  
  // Classification
  organization?: string;
  tags?: string[];
  description?: string;
  
  // Upload info
  filename: string;
  format: 'json' | 'yaml';
  size: number;
  uploadedAt: string;
  updatedAt?: string;
  uploadedBy?: string;
  source?: string;
  
  // OpenAPI info
  openApiVersion?: string;
  
  // Statistics
  stats?: {
    operationCount: number;
    schemaCount: number;
    securitySchemeCount: number;
    tagCount: number;
  };
  
  // Lint activity (optional)
  lintActivity?: {
    totalLints: number;
    lastLintAt?: string;
    lastLintStatus?: JobStatus;
  };
}
```

**Example Requests:**

```bash
# List SBG organization APIs
curl "http://localhost:3003/documents?organization=SBG&sortBy=uploadedAt&limit=20"

# Search for "nexus" in name/title/description
curl "http://localhost:3003/documents?search=nexus&limit=10"

# Filter by tags
curl "http://localhost:3003/documents?tags=networking,dashboard"

# Combined filters
curl "http://localhost:3003/documents?organization=SBG&tags=networking&sortBy=name"
```

**Example Response:**

```json
{
  "documents": [
    {
      "id": "abc-123",
      "name": "Nexus Dashboard API",
      "version": "2.3.0",
      "title": "Nexus Dashboard API",
      "organization": "SBG",
      "tags": ["networking", "dashboard"],
      "description": "Management API for Nexus Dashboard",
      "filename": "nexus-dashboard-api.yaml",
      "format": "json",
      "size": 245678,
      "uploadedAt": "2026-02-01T10:00:00Z",
      "updatedAt": "2026-02-01T10:00:00Z",
      "uploadedBy": "john.doe@cisco.com",
      "source": "API Registry",
      "openApiVersion": "3.0.0",
      "stats": {
        "operationCount": 47,
        "schemaCount": 23,
        "securitySchemeCount": 2,
        "tagCount": 8
      },
      "lintActivity": {
        "totalLints": 3,
        "lastLintAt": "2026-02-04T14:30:00Z",
        "lastLintStatus": "completed"
      }
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 15,
    "hasMore": false
  },
  "filters": {
    "organization": "SBG"
  }
}
```

**Search Implementation Note:**

When `search` parameter is provided, the document store's `searchDocuments()` method is used, which returns ranked results with relevance scores. Without `search`, the standard `listDocuments()` method is used for filtering.

```typescript
// Implementation
if (request.query.search) {
  // Use search (returns ranked results)
  documents = await documentStore.searchDocuments(
    request.query.search, 
    { limit, offset, organization, tags }
  );
} else {
  // Use list (faster, no scoring)
  documents = await documentStore.listDocuments({
    limit, offset, organization, tags, name
  });
}
```

---

## Data Model

### Storage Layer Extensions

**Extend MemoryLintStorage:**

```typescript
class MemoryLintStorage implements LintResultStorage {
  // Existing
  private jobResults = new Map<string, StorageEntry>();
  private documentIndex = new Map<string, Set<string>>();
  
  // NEW: Additional indexes for efficient querying
  private statusIndex = new Map<JobStatus, Set<string>>();
  private rulesetIndex = new Map<string, Set<string>>();
  private timestampIndex: Array<{ jobId: string; timestamp: Date }> = [];
  
  /**
   * List jobs with filtering and pagination
   */
  async listJobs(options: ListJobsOptions): Promise<ListJobsResult> {
    // Filter by session (if includeStale=false)
    // Filter by status, documentId, ruleset
    // Sort by timestamp/status
    // Paginate
    // Return results
  }
  
  /**
   * Get lint activity for a document
   */
  async getDocumentLintActivity(documentId: string): Promise<LintActivity> {
    const jobIds = this.documentIndex.get(documentId) || new Set();
    const jobs = Array.from(jobIds)
      .map(id => this.jobResults.get(id)?.result)
      .filter(Boolean);
    
    return {
      totalLints: jobs.length,
      lastLintAt: jobs[0]?.timestamp,
      lastLintStatus: jobs[0]?.status
    };
  }
}
```

**Orchestrator Extensions:**

```typescript
class Orchestrator {
  /**
   * List jobs (lightweight - documentId only)
   */
  async listJobs(options: ListJobsOptions): Promise<ListJobsResponse> {
    const jobs = await this.storage.listJobs(options);
    
    return {
      jobs,
      pagination: { ... },
      session: { ... },
      filters: options
    };
  }
  
  /**
   * List jobs with document metadata enrichment
   */
  async listJobsDetailed(options: ListJobsOptions): Promise<ListJobsDetailedResponse> {
    const jobs = await this.storage.listJobs(options);
    
    // Enrich ALL jobs with document metadata
    for (const job of jobs) {
      const doc = await this.documentStore.getDocument(job.documentId);
      if (doc) {
        job.document = this.extractDocumentMetadata(doc);
      }
    }
    
    return {
      jobs,
      pagination: { ... },
      session: { ... },
      filters: options
    };
  }
  
  private extractDocumentMetadata(doc: StoredDocument): DocumentMetadata {
    return {
      name: doc.metadata.name,
      version: doc.metadata.version,
      title: doc.metadata.title,
      organization: doc.metadata.organization,
      tags: doc.metadata.tags,
      uploadedAt: doc.metadata.uploadedAt,
      operationCount: doc.metadata.stats?.operationCount,
      size: doc.metadata.size,
      format: doc.metadata.format,
      openApiVersion: doc.metadata.openApiVersion
    };
  }
}
```

---

## Implementation Plan

### Phase 1: Storage Layer (Week 1)

**Tasks:**
1. Add indexes to MemoryLintStorage
   - statusIndex: Map<JobStatus, Set<string>>
   - rulesetIndex: Map<string, Set<string>>
   - timestampIndex: sorted array
2. Implement `listJobs(options)` method
3. Implement `getDocumentLintActivity(documentId)` method
4. Add unit tests for storage queries

**Files:**
- `src/storage/memory-storage.ts`
- `src/storage/storage-adapter.ts` (interface updates)
- `tests/unit/storage/memory-storage.test.ts`

**Acceptance:**
- Can list jobs with filtering (status, documentId, ruleset)
- Pagination works correctly
- Sorting by timestamp/status works
- Performance: <10ms for 1000 jobs

---

### Phase 2: Document Listing (Week 1)

**Tasks:**
1. Add `GET /documents` HTTP endpoint
2. Wire to documentStore.listDocuments() and searchDocuments()
3. Add query parameter validation
4. Implement search vs list logic (based on `search` param)
5. Add optional lint activity enrichment
6. Integration tests

**Files:**
- `src/server.ts` (new endpoint)
- `src/validation.ts` (query schemas)

**Acceptance:**
- List all documents with pagination
- Filter by organization, tags, name
- Full-text search via `?search=` parameter
- Sort by uploadedAt, name, size
- Returns rich metadata
- Optional lint activity stats

---

### Phase 3: Job Listing Endpoints (Week 2)

**Tasks:**
1. Add `GET /lint/jobs` HTTP endpoint (lightweight)
2. Add `GET /lint/jobs/details` HTTP endpoint (enriched)
3. Wire to orchestrator.listJobs() and listJobsDetailed()
4. Implement session filtering logic
5. Add query parameter validation
6. Share filter logic between both endpoints
7. Integration tests for both endpoints

**Files:**
- `src/server.ts` (two new endpoints)
- `src/orchestrator.ts` (listJobs + listJobsDetailed methods)
- `src/validation.ts` (shared query schemas)
- `tests/integration/list-jobs.test.ts`

**Acceptance:**
- `/lint/jobs` returns lightweight response (<20ms)
- `/lint/jobs/details` returns enriched response (<50ms)
- Both endpoints support same filters
- Session filtering (exclude stale jobs)
- Performance targets met

---

### Phase 4: Testing & Polish (Week 2)

**Tasks:**
1. Performance testing (lightweight vs detailed endpoints)
2. Load testing (1000+ jobs)
3. Edge case handling (empty results, invalid filters)
4. Error message improvements
5. Add comprehensive integration tests

**Files:**
- `tests/integration/list-jobs-performance.test.ts`
- `tests/integration/list-documents.test.ts`

**Acceptance:**
- Performance SLAs met
- Proper error handling
- Edge cases covered

---

### Phase 5: Documentation & CLI (Week 3)

**Tasks:**
1. Update API documentation
2. Update CHANGELOG.md
3. Add CLI commands (optional):
   - `spectify jobs list`
   - `spectify documents list`
4. Update quick start guides

**Files:**
- `docs/QUICK_START_API.md`
- `docs/design/LINT_ORCHESTRATOR_DESIGN.md`
- `CHANGELOG.md`
- `src/cli/commands/` (optional)

---

## Performance Considerations

### Query Performance

**Target SLAs:**
- List 20 jobs (lightweight): <20ms ⚡
- List 20 jobs (with expand=document): <50ms
- List 20 documents: <30ms
- Metadata enrichment cost: ~10ms per job (amortized with document cache)
- Search documents: <100ms

**Performance Impact by Expansion:**

| Request Type | Response Time | Notes |
|--------------|---------------|-------|
| Default (documentId only) | <20ms | Fast - no extra queries |
| expand=document (cached) | <30ms | Document in cache, minimal overhead |
| expand=document (cold) | <50ms | Need to load document from store |
| expand=document,progress | <25ms | Progress already in memory |

**Optimization Strategies:**

1. **Indexing**:
   - Pre-built indexes for status, ruleset, timestamp
   - Updated on job completion (O(1) insert)
   - Query time: O(log n) for sorted access

2. **Pagination**:
   - Default limit: 20 (prevent large responses)
   - Max limit: 100 (prevent abuse)
   - Offset-based (simple, works for <10k jobs)

3. **Metadata Enrichment**:
   - **Opt-in via `?expand=document`** (default: OFF)
   - Prevents N+1 query problem on document store
   - Document store has LRU caching (hit rate >80%)
   - Future: Batch fetch for multiple jobs

4. **Session Filtering**:
   - Session ID stored with each job
   - Indexed for fast filtering
   - Option to bypass for historical analysis

### Memory Usage

**Estimates:**
- 1000 jobs in memory: ~1MB
- Additional indexes: +500KB
- Document cache: 100 docs × 50KB = 5MB
- **Total**: ~7MB for typical usage

**Growth:**
- Linear with job count
- Bounded by TTL (results expire)
- Can move to Redis for >10k jobs

---

## Security & Privacy

### Input Validation

```typescript
// Validate query parameters
const schema = {
  limit: { type: 'integer', min: 1, max: 100 },
  offset: { type: 'integer', min: 0 },
  status: { type: 'array', items: { enum: JobStatusEnum } },
  documentId: { type: 'string', format: 'uuid' },
  // ...
};
```

### Access Control (Future)

- **Phase 1**: No authentication (same as current API)
- **Future**: Filter jobs by user/organization
- **Future**: Document-level permissions

### Data Exposure

**What's exposed:**
- Job IDs (UUIDs - no sensitive data)
- Document IDs (UUIDs)
- Document metadata (name, org, tags)
- Issue counts (not issue details)

**What's NOT exposed:**
- Full document content (use GET /documents/:id)
- Full lint results (use GET /lint/:jobId/results)

---

## Testing Strategy

### Unit Tests

**Storage Layer:**
```typescript
describe('MemoryLintStorage.listJobs', () => {
  it('filters by status', async () => {
    await storage.storeJob(failedJob);
    await storage.storeJob(completedJob);
    
    const result = await storage.listJobs({ status: ['failed'] });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].status).toBe('failed');
  });
  
  it('paginates correctly', async () => {
    // Store 50 jobs
    const page1 = await storage.listJobs({ limit: 20, offset: 0 });
    const page2 = await storage.listJobs({ limit: 20, offset: 20 });
    
    expect(page1.jobs).toHaveLength(20);
    expect(page2.jobs).toHaveLength(20);
    expect(page1.pagination.hasMore).toBe(true);
  });
  
  it('filters by session', async () => {
    await storage.storeJob({ ...job, sessionId: 'session-1' });
    await storage.storeJob({ ...job, sessionId: 'session-2' });
    
    const result = await storage.listJobs({ 
      currentSessionId: 'session-1',
      includeStale: false 
    });
    
    expect(result.jobs).toHaveLength(1);
    expect(result.session.staleJobsFiltered).toBe(1);
  });
});
```

### Integration Tests

**HTTP API:**
```typescript
describe('GET /lint/jobs', () => {
  it('returns paginated job list', async () => {
    const response = await request(app)
      .get('/lint/jobs?limit=10')
      .expect(200);
    
    expect(response.body.jobs).toBeDefined();
    expect(response.body.pagination).toMatchObject({
      limit: 10,
      offset: 0,
      total: expect.any(Number),
      hasMore: expect.any(Boolean)
    });
  }); when expand=document', async () => {
    const response = await request(app)
      .get('/lint/jobs?expand=document')
      .expect(200);
    
    expect(response.body.jobs[0].document).toBeDefined();
    expect(response.body.jobs[0].document.name).toBeDefined();
  });
  
  it('does NOT enrich by default (performance)', async () => {
    const response = await request(app)
      .get('/lint/jobs')
      .expect(200);
    
    expect(response.body.jobs[0].documentId).toBeDefined();
    expect(response.body.jobs[0].document).toBeUnd
    expect(response.body.jobs[0].document).toBeDefined();
    expect(response.body.jobs[0].document.name).toBeDefined();
  });
  
  it('filters by multiple statuses', async () => {
    const response = await request(app)
      .get('/lint/jobs?status=failed,timeout')
      .expect(200);
    
    response.body.jobs.forEach(job => {
      expect(['failed', 'timeout']).toContain(job.status);
    });
  });
});
```

### Performance Tests

```typescript
describe('Performance', () => {
  it('lists 100 jobs in <50ms', async () => {
    // Store 100 jobs
    const start = Date.now();
    await storage.listJobs({ limit: 100 });
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(50);
  });
  
  it('lists 20 jobs (lightweight) in <20ms', async () => {
    const start = Date.now();
    await orchestrator.listJobs({ limit: 20 });
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(20);
  });
  
  it('details endpoint enriches in <50ms (with document cache)', async () => {
    // Pre-warm cache
    await Promise.all(
      jobs.map(j => documentStore.getDocument(j.documentId))
    );
    
    const start = Date.now();
    await orchestrator.listJobsDetailed({ limit: 20 });
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(50);
  });
});

describe('GET /documents', () => {
  it('lists documents with filters', async () => {
    const response = await request(app)
      .get('/documents?organization=SBG&limit=10')
      .expect(200);
    
    response.body.documents.forEach(doc => {
      expect(doc.organization).toBe('SBG');
    });
  });
  
  it('searches documents with search parameter', async () => {
    const response = await request(app)
      .get('/documents?search=nexus&limit=10')
      .expect(200);
    
    expect(response.body.documents).toBeDefined();
    // Documents should have relevance to "nexus"
  });
});
```

---

## Future Enhancements

### Phase 2 Features (v0.9.0)

1. **Aggregations**:
   - `GET /lint/jobs/stats` - Aggregate statistics
   - Group by status, ruleset, organization
   - Time-series data (jobs per day)

2. **Cursor-Based Pagination**:
   - Replace offset with cursor for >10k jobs
   - Better performance, consistent results

3. **Advanced Filters**:
   - Date range queries
   - Issue count thresholds (>10 errors)
   - Execution time ranges

### Phase 3 Features (v1.0.0)

1. **WebSocket Updates**:
   - Real-time job list updates
   - Live status changes

2. **Export Capabilities**:
   - Export job list as CSV
   - Export document inventory

3. **Saved Queries**:
   - Save filter combinations
   - Named views (e.g., "SBG Failed Lints")

---

## Design Decisions

### ✅ DECIDED: Separate Endpoints for Lightweight vs Enriched

**Decision**: Use `/lint/jobs` (lightweight) and `/lint/jobs/details` (enriched) as separate endpoints

**Rationale**:
- ⚡ **Performance**: Clear performance expectations - users know what they're getting
- 📊 **Scalability**: Avoids N+1 query problem by making enrichment explicit
- 🎯 **API Clarity**: Fixed response schemas, easier to document
- 💾 **Bandwidth**: Smaller payloads by default
- 🔧 **Type Safety**: Concrete TypeScript types (no union types or conditionals)
- 📖 **Documentation**: Simpler OpenAPI spec - no conditional fields
- 🔗 **Caching**: Different URLs = different cache keys

**Usage Pattern**:
```bash
# Fast: Lightweight list (documentId only)
GET /lint/jobs?status=failed&limit=20
# Response time: ~15ms, minimal payload

# Complete: Enriched with document metadata
GET /lint/jobs/details?status=failed&limit=20
# Response time: ~40ms (with cache), complete info

# Both support same filters
GET /lint/jobs?documentId=abc-123
GET /lint/jobs/details?documentId=abc-123
```

**Comparison with Alternatives**:
- ❌ Query parameter (`?expand=document`): Complex response schemas, conditional fields
- ❌ Different base paths (`/jobs-detailed`): Awkward naming
- ❌ Nested resources (`/jobs/summary`): Breaks REST conventions
- ✅ **Path suffix** (`/jobs/details`): Clear, conventional, predictable

### ✅ DECIDED: Session Filtering = Exclude Stale by Default

**Decision**: `includeStale=false` by default

**Rationale**: Users typically want current session only

### ✅ DECIDED: Search as Filter Parameter (Not Separate Endpoint)

**Decision**: Use `?search=` parameter on `/documents` instead of `/documents/search` endpoint

**Rationale**:
- 🎯 **Simplicity**: One endpoint, multiple use cases
- 🔧 **Flexibility**: Combine search with filters (`?search=nexus&organization=SBG`)
- 📖 **Consistency**: Same pattern as other filters
- 💡 **Best Practice**: Many REST APIs use this pattern (GitHub, Stripe)

**Implementation**: When `search` param is present, use `searchDocuments()` method; otherwise use `listDocuments()`

### ✅ DECIDED: Document Lint Activity = Optional

**Decision**: Make it optional `?includeLintActivity=true` in document listing

**Rationale**: Adds extra query per document (performance cost)

### ✅ DECIDED: Maximum Limit = 100 (Hard Cap)

**Decision**: Hard cap at 100, suggest pagination for larger datasets

**Rationale**: Prevents abuse, encourages proper pagination

---

## Success Metrics

**Adoption:**
- 50% of API users call `/lint/jobs` within 1 month
- CLI users use `spectify jobs list` command
- >80% of requests use default (no expand) - validates performance focus

**Performance:**
- P95 latency < 20ms for default (lightweight) listings
- P95 latency < 50ms for enriched listings
- Document cache hit rate > 80%
- No performance degradation with 1000+ jobs

**User Satisfaction:**
- Reduced "how do I find my jobs?" support requests
- Positive feedback on enriched metadata

---

## Appendix

### Example Use Cases

**Use Case 1: Dashboard - Failed Lints by Organization**

```bash
# Step 1: Get all failed lints (fast, lightweight)
curl "http://localhost:3003/lint/jobs?status=failed&limit=100"
# Response time: ~15ms
# Returns: documentIds only

# Step 2: Enrich only the unique documents (efficient)
unique_docs=$(jq -r '.jobs[].documentId | unique' | xargs)
curl "http://localhost:3003/documents?id=${unique_docs}"

# Alternative: Get everything in one call (slower)
curl "http://localhost:3003/lint/jobs?status=failed&limit=100&expand=document"
# Response time: ~80ms
# Display: "SBG: 12 failed, CN: 5 failed"
```

**Use Case 2: API Owner - Track My API Quality**

```bash
# Find my document
curl "http://localhost:3003/documents?name=Nexus%20Dashboard"
# documentId: abc-123

# Get all lints
curl "http://localhost:3003/lint/jobs?documentId=abc-123&sortBy=timestamp"

# Track quality trend over time
```

**Use Case 3: CLI User - Resume Work**

```bash
# See what I worked on yesterday
spectify jobs list --status=failed --since=yesterday

# Pick up where I left off
spectify results job-123
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-02-04 | Initial design proposal |

---

**Status**: Ready for Review  
**Next Steps**: Implementation Phase 1 (Storage Layer)
