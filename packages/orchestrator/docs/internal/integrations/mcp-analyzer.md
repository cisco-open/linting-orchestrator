# MCP OpenAPI Analyzer Integration

**Integration Contract for Spectify → MCP OpenAPI Analyzer**

**Version:** 0.3.1  
**MCP Protocol:** 2025-06-18  
**Date:** November 20, 2025

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Integration Contract](#integration-contract)
4. [Document Lifecycle](#document-lifecycle)
5. [Configuration](#configuration)
6. [MCP Server Capabilities](#mcp-server-capabilities)
7. [Development Setup](#development-setup)
8. [Production Deployment](#production-deployment)
9. [Error Handling](#error-handling)
10. [Security Considerations](#security-considerations)
11. [API Contract Reference](#api-contract-reference)

---

## Overview

### What is the MCP OpenAPI Analyzer?

The **MCP OpenAPI Analyzer** is a Model Context Protocol (MCP) server that provides:
- **HTTP Upload API** for large OpenAPI documents (100K-1M lines)
- **Document Storage** with UUID-based identification
- **MCP Tools** for structured document analysis (9 tools)
- **Efficient caching** with TTL-based cleanup

**Repository:** `mcp-openapi-analysis/` (reference implementation)  
**Server Version:** 0.3.1  
**Ports:** Upload API (3002), MCP Server (3001)

### Why Spectify Integrates with MCP

**Spectify** is a **standalone linting orchestrator** that:
- Focuses on running Spectral rulesets efficiently
- Uses MCP's document storage for input documents
- Operates **independently** from MCP server
- Integrates via **filesystem access** (zero-copy architecture)

**Key Integration Principle:** 
> Spectify reads documents from MCP's upload directory via filesystem access. No HTTP calls during linting for optimal performance.

### Integration Model

```
┌─────────────────────────────────────────────────────────────┐
│                    User / Client                             │
└─────────────────────────────────────────────────────────────┘
              ↓                              ↓
       1. Upload Document            4. Request Lint Job
              ↓                              ↓
┌──────────────────────────┐      ┌──────────────────────────┐
│   MCP OpenAPI Analyzer   │      │  Spectify Orchestrator   │
│   (Port 3002 / 3001)     │      │      (Port 3003)         │
├──────────────────────────┤      ├──────────────────────────┤
│ • HTTP Upload API        │      │ • Job Orchestration      │
│ • Document Parsing       │      │ • Worker Pool Manager    │
│ • UUID Generation        │      │ • Spectral Execution     │
│ • MCP Tools (optional)   │      │ • Result Aggregation     │
└──────────────────────────┘      └──────────────────────────┘
              ↓                              ↓
       2. Store Document               3. Read Document
              ↓                              ↓
┌─────────────────────────────────────────────────────────────┐
│            Shared Filesystem (Document Store)                │
│                                                              │
│  ./mcp-openapi-analysis/uploads/                            │
│  ├── a1b2c3d4-e5f6-7890-abcd-ef1234567890.json             │
│  ├── b2c3d4e5-f6a7-8901-bcde-f12345678901.json             │
│  └── c3d4e5f6-a7b8-9012-cdef-123456789012.json             │
└─────────────────────────────────────────────────────────────┘
```

**Workflow:**
1. **User uploads** OpenAPI document to MCP server via HTTP
2. **MCP stores** parsed document at `./uploads/{uuid}.json`
3. **Spectify reads** document from filesystem (via DocumentAccessor)
4. **Workers cache** document in memory for fast re-execution
5. **Spectral lints** document against configured rulesets
6. **Spectify returns** results via HTTP API

---

## Architecture

### Components

#### MCP OpenAPI Analyzer (External Dependency)
- **HTTP Upload Server** (port 3002)
  - Accepts OpenAPI documents (JSON/YAML)
  - Parses and validates format
  - Generates UUID document ID
  - Stores as `./uploads/{uuid}.json`
  
- **MCP Server** (port 3001)
  - 9 MCP tools for document analysis
  - Resource templates for document access
  - Prompts for upload workflow
  - **Not used by Spectify** (Spectify only uses filesystem)

#### Spectify Orchestrator (This Project)
- **DocumentAccessor** (`src/document-accessor.ts`)
  - Reads documents from MCP upload directory
  - Validates document existence
  - Returns file paths (not content) to workers
  
- **Worker Pool**
  - Workers receive file paths
  - Load documents from filesystem
  - Cache documents in memory (LRU, 1 per worker)
  - Execute Spectral rulesets

- **HTTP API** (port 3003)
  - Submit lint jobs with `documentId`
  - Poll job status
  - Retrieve lint results

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Document Upload (One-time, via MCP)                      │
└─────────────────────────────────────────────────────────────┘
User → curl → MCP Upload API → Parse YAML/JSON
                                      ↓
                          Generate UUID: abc-123-def
                                      ↓
                          Store: uploads/abc-123-def.json
                                      ↓
                          Return: {"documentId": "abc-123-def"}

┌─────────────────────────────────────────────────────────────┐
│ 2. Lint Job Submission (Multiple times, via Spectify)       │
└─────────────────────────────────────────────────────────────┘
User → curl → Spectify API → Orchestrator.submitJob()
                                      ↓
                          DocumentAccessor.getDocumentPath()
                                      ↓
                          Check: uploads/abc-123-def.json exists?
                                      ↓
                          Create tasks for each ruleset
                                      ↓
                          WorkerPool.executeTask()
                                      ↓
                          Worker receives: {
                            taskId: "task-1",
                            documentPath: "./uploads/abc-123-def.json",
                            documentId: "abc-123-def",
                            rulesetName: "pubhub"
                          }
                                      ↓
                          Worker loads from filesystem (or cache)
                                      ↓
                          Spectral.run(document)
                                      ↓
                          Return results → Orchestrator
                                      ↓
                          Store in cache (MemoryStorage/Redis)
                                      ↓
                          Return jobId to user

┌─────────────────────────────────────────────────────────────┐
│ 3. Result Retrieval (via Spectify)                          │
└─────────────────────────────────────────────────────────────┘
User → curl → Spectify API → Storage.getJobResult()
                                      ↓
                          Return: {
                            summary: { errors: 5, warnings: 12 },
                            results: [ /* issues */ ]
                          }
```

---

## Integration Contract

### Filesystem Contract

**Document Storage Location:**
```
{SPECTIFYD_DOCUMENT_STORE_DIR}/{documentId}.json
```

**Default Path (Development):**
```
../mcp-openapi-analysis/uploads/  # If MCP cloned as sibling directory
```

**Default Path (Production):**
```
/var/lib/mcp-openapi-analysis/uploads/
```

**File Structure:**
```
uploads/
├── a1b2c3d4-e5f6-7890-abcd-ef1234567890.json
├── b2c3d4e5-f6a7-8901-bcde-f12345678901.json
├── c3d4e5f6-a7b8-9012-cdef-123456789012.json
└── ...
```

**Document ID Format:**
- **Type:** UUID v4 (RFC 4122)
- **Pattern:** `[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}`
- **Example:** `550e8400-e29b-41d4-a716-446655440000`
- **Validation:** Spectify validates format before accessing filesystem

**File Format:**
- **Content-Type:** `application/json`
- **Encoding:** UTF-8
- **Structure:** Parsed OpenAPI 3.x document (JSON object)
- **Size:** Typically 10KB - 10MB (can be larger)

**File Naming:**
```
{documentId}.json
```

**Permissions Required:**
- Spectify process must have **read access** to upload directory
- MCP server process must have **write access** to upload directory
- Recommendation: Use same user/group or shared group with `0664` permissions

### HTTP API (Optional)

Spectify can optionally use MCP's HTTP API as a fallback:

**Upload Document:**
```http
POST http://localhost:3002/upload
Content-Type: application/x-yaml
X-Filename: my-api.yaml

<OpenAPI document content>
```

**Response:**
```json
{
  "success": true,
  "documentId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Document uploaded successfully",
  "size": 524288,
  "format": "yaml"
}
```

**Get Document (Fallback):**
```http
GET http://localhost:3002/documents/{documentId}
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "my-api.yaml",
  "size": 524288,
  "format": "yaml",
  "uploadedAt": "2025-11-20T10:30:00Z"
}
```

**Health Check:**
```http
GET http://localhost:3002/health
```

**Response:**
```json
{
  "status": "ok",
  "documents": 42,
  "storage": {
    "used": "125MB",
    "limit": "1GB"
  }
}
```

### Environment Variables

**Spectify Configuration:**
```bash
# Primary: Filesystem access to MCP uploads
SPECTIFYD_DOCUMENT_STORE_DIR=../mcp-openapi-analysis/uploads

# Optional: HTTP fallback if file not found
SPECTIFYD_DOCUMENT_STORE_FALLBACK_HTTP=http://localhost:3002

# Optional: Enable HTTP fallback
DOCUMENT_STORE_FALLBACK_ENABLED=false
```

**MCP Server Configuration:**
```bash
# Upload API port
UPLOAD_PORT=3002

# MCP protocol port
MCP_PORT=3001

# Document storage directory
STORAGE_DIR=./uploads

# Document TTL (hours)
DOCUMENT_TTL_HOURS=24
```

---

## Document Lifecycle

### 1. Upload Phase (MCP Server)

**User Action:**
```bash
curl -X POST http://localhost:3002/upload \
  -H "Content-Type: application/x-yaml" \
  --data-binary @petstore.yaml
```

**MCP Server:**
1. Receives YAML content
2. Parses to JSON (validates OpenAPI structure)
3. Generates UUID: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
4. Stores at: `./uploads/a1b2c3d4-e5f6-7890-abcd-ef1234567890.json`
5. Returns `documentId` to user

**Result:**
```json
{
  "documentId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

### 2. Lint Phase (Spectify)

**User Action:**
```bash
curl -X POST http://localhost:3003/lint \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "rulesetName": "pubhub"
  }'
```

**Spectify Orchestrator:**
1. Validates `documentId` format (UUID)
2. Calls `DocumentAccessor.getDocumentPath(documentId)`
3. Checks file exists: `./uploads/a1b2c3d4-....json`
4. Creates lint job with tasks (one per ruleset)
5. Routes task to worker with document affinity
6. Returns `jobId` immediately (async)

**DocumentAccessor Logic:**
```typescript
async getDocumentPath(documentId: string): Promise<string> {
  // Validate UUID format
  if (!this.isValidDocumentId(documentId)) {
    throw new Error('Invalid document ID format');
  }
  
  // Construct path
  const path = join(this.uploadDir, `${documentId}.json`);
  
  // Check exists
  if (!await this.fileExists(path)) {
    throw new Error(`Document ${documentId} not found`);
  }
  
  return path;
}
```

**Worker Execution:**
1. Worker receives: `{ documentPath: "./uploads/abc.json", ... }`
2. Check cache: `if (cachedDocumentId === documentId) { use cache }`
3. Load from filesystem: `fs.readFile(documentPath, 'utf-8')`
4. Parse JSON: `JSON.parse(content)`
5. Cache in memory: `this.cachedDocument = document`
6. Execute Spectral: `spectral.run(document)`
7. Return results to orchestrator

### 3. Result Phase (Spectify)

**User Action:**
```bash
# Poll status
curl http://localhost:3003/lint/{jobId}

# Get results when complete
curl http://localhost:3003/lint/{jobId}/results
```

**Spectify Response:**
```json
{
  "jobId": "job-123",
  "documentId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "rulesetName": "pubhub",
  "status": "completed",
  "summary": {
    "totalIssues": 17,
    "errors": 5,
    "warnings": 12,
    "infos": 0,
    "hints": 0
  },
  "results": [
    {
      "code": "pubhub-no-trailing-slash",
      "message": "Server URL should not have trailing slash",
      "severity": 1,
      "path": ["servers", "0", "url"]
    }
  ]
}
```

### 4. Cleanup Phase (MCP Server)

**MCP Server (Automatic):**
- Documents older than TTL (default: 24 hours) are deleted
- Cleanup runs periodically (default: every hour)
- Can be manually triggered via API

**User Action (Manual Cleanup):**
```bash
curl -X DELETE http://localhost:3002/documents/a1b2c3d4-...
```

---

## Configuration

### Spectify Configuration (`config/default.yaml`)

```yaml
# Document store integration
documentStore:
  # Primary: Filesystem access
  directory: ../mcp-openapi-analysis/uploads
  
  # Optional: HTTP fallback
  fallbackHttp:
    enabled: false
    baseUrl: http://localhost:3002
    timeout: 5000
  
  # Validation
  validateDocumentId: true
  allowedFormats:
    - json

# Worker pool
workerPool:
  minWorkersPerRuleset: 1
  maxWorkersPerRuleset: 2
  totalMaxWorkers: 15
  
  # Document caching in workers
  documentCache:
    enabled: true
    maxDocumentsPerWorker: 1  # LRU cache
    maxCacheSizeBytes: 52428800  # 50MB
    evictAfterMinutes: 5

# HTTP API
server:
  port: 3003
  host: 0.0.0.0

# Storage (for lint results)
storage:
  type: memory  # or 'redis'
  ttlHours: 24
```

### Environment Variables

```bash
# Document store
export SPECTIFYD_DOCUMENT_STORE_DIR=/var/lib/mcp-openapi-analysis/uploads
export SPECTIFYD_DOCUMENT_STORE_FALLBACK_HTTP=http://mcp-server:3002
export DOCUMENT_STORE_FALLBACK_ENABLED=false

# Worker pool
export SPECTIFYD_MIN_WORKERS_PER_RULESET=1
export SPECTIFYD_MAX_WORKERS_PER_RULESET=2
export SPECTIFYD_TOTAL_MAX_WORKERS=15

# Server
export SPECTIFYD_PORT=3003
export NODE_ENV=production
export SPECTIFYD_LOG_LEVEL=info
```

### Production Recommendations

**Shared Filesystem:**
```yaml
documentStore:
  directory: /mnt/nfs/mcp-uploads  # Network filesystem
  fallbackHttp:
    enabled: true  # Fallback if NFS unavailable
    baseUrl: http://mcp-server.internal:3002
```

**Container Deployment (Docker/Kubernetes):**
```yaml
# Shared volume mount
volumes:
  - name: mcp-uploads
    persistentVolumeClaim:
      claimName: mcp-uploads-pvc

# Spectify container
containers:
  - name: spectify
    volumeMounts:
      - name: mcp-uploads
        mountPath: /var/lib/uploads
        readOnly: true
    env:
      - name: SPECTIFYD_DOCUMENT_STORE_DIR
        value: /var/lib/uploads
```

---

## MCP Server Capabilities

### MCP Tools (9 available)

From MCP contract dump v0.3.1:

| Tool | Description | Used by Spectify? |
|------|-------------|-------------------|
| `get_upload_instructions` | Workflow instructions | ❌ No (user-facing) |
| `get_document_info` | API metadata | ❌ No (could use for validation) |
| `list_operations` | List all operations | ❌ No (Spectral handles this) |
| `search_operations` | Search operations | ❌ No |
| `extract_operations` | Paginated operation details | ❌ No |
| `get_security_schemes` | Security definitions | ❌ No |
| `get_schemas` | Data models | ❌ No |
| `validate_structure` | Basic validation | ❌ No (Spectral validates) |
| `get_statistics` | API statistics | ❌ No |

**Note:** Spectify does NOT use MCP tools. It only uses MCP's document storage via filesystem access.

### MCP Resources

| Resource | URI | Description |
|----------|-----|-------------|
| `documents` | `documents://list` | List all documents |
| `document` | `openapi://{documentId}` | Get document details |

**Note:** Spectify does NOT use MCP resources.

### MCP Protocol Details

- **Protocol Version:** 2025-06-18
- **Transport:** streamable-http (stateless)
- **Session Support:** No
- **Server Name:** `openapi-analysis-mcp`
- **Server Version:** 0.3.1

---

## Development Setup

### Prerequisites

1. **Node.js** ≥ 18.0.0
2. **MCP OpenAPI Analyzer** repository cloned
3. **Port availability:** 3001 (MCP), 3002 (Upload), 3003 (Spectify)

### Setup Steps

#### 1. Clone MCP Server (if not available)

```bash
# Clone MCP server as sibling directory (recommended)
cd .. # Go to parent directory
git clone https://github.com/[org]/mcp-openapi-analysis
cd mcp-openapi-analysis
npm install
npm run build
cd ../spectify

# Or clone to a custom location
git clone https://github.com/[org]/mcp-openapi-analysis /opt/mcp-server
cd /opt/mcp-server
npm install
npm run build
```

#### 2. Configure Spectify

```bash
cd spectify

# Set document store path (relative or absolute)
export SPECTIFYD_DOCUMENT_STORE_DIR=../mcp-openapi-analysis/uploads

# Or edit config/default.yaml
vim config/default.yaml
```

#### 3. Start Services

**Terminal 1: MCP Server**
```bash
cd mcp-openapi-analysis
npm run dev  # Development mode with auto-reload
```

Wait for:
```
MCP Server listening on http://localhost:3001/mcp
Upload API listening on http://localhost:3002
```

**Terminal 2: Spectify**
```bash
cd spectify
npm run dev  # Development mode with auto-reload
```

Wait for:
```
Spectify Orchestrator listening on http://localhost:3003
Worker pool initialized: 6 workers
```

#### 4. Verify Integration

```bash
# Upload test document
curl -X POST http://localhost:3002/upload \
  -H "Content-Type: application/x-yaml" \
  --data-binary @tests/fixtures/openapi-docs/petstore.json

# Response: {"documentId": "abc-123-..."}

# Check file exists
ls -lh ../mcp-openapi-analysis/uploads/abc-123-*.json

# Submit lint job
curl -X POST http://localhost:3003/lint \
  -H "Content-Type: application/json" \
  -d '{"documentId": "abc-123-...", "rulesetName": "pubhub"}'

# Response: {"jobId": "job-456-..."}

# Get results
curl http://localhost:3003/lint/job-456-.../results
```

### Mock Document Store (Offline Development)

For testing without MCP server:

```bash
# Create mock uploads directory
mkdir -p tests/fixtures/mock-uploads

# Copy test documents
cp tests/fixtures/openapi-docs/*.json tests/fixtures/mock-uploads/

# Rename with UUID format
mv tests/fixtures/mock-uploads/petstore.json \
   tests/fixtures/mock-uploads/550e8400-e29b-41d4-a716-446655440000.json

# Configure Spectify to use mock directory
export SPECTIFYD_DOCUMENT_STORE_DIR=./tests/fixtures/mock-uploads

# Start Spectify (no MCP server needed)
npm run dev
```

### Integration Testing

Integration tests check if MCP server is running:

```bash
# Start MCP server first
cd mcp-openapi-analysis && npm start

# In separate terminal, run integration tests
cd spectify
npm run test:integration
```

If MCP server not running:
```
Error: MCP server not running on http://localhost:3002

Start the MCP server with:
  cd mcp-openapi-analysis && npm start

Or configure a mock document store:
  export SPECTIFYD_DOCUMENT_STORE_DIR=./tests/fixtures/mock-uploads
```

---

## Production Deployment

### Deployment Topologies

#### Option 1: Co-located (Same Host)

```
┌─────────────────────────────────────────┐
│           Application Server            │
│                                          │
│  ┌──────────────┐   ┌──────────────┐   │
│  │ MCP Server   │   │  Spectify    │   │
│  │ Port 3001/2  │   │  Port 3003   │   │
│  └──────────────┘   └──────────────┘   │
│         │                   │            │
│         └───────┬───────────┘            │
│                 ↓                        │
│    /var/lib/uploads/ (local disk)       │
└─────────────────────────────────────────┘
```

**Pros:**
- Simple deployment
- Low latency (local filesystem)
- No network dependencies

**Cons:**
- Single point of failure
- Scaling requires vertical scaling

**Configuration:**
```yaml
documentStore:
  directory: /var/lib/uploads
  fallbackHttp:
    enabled: false
```

#### Option 2: Separate Hosts with NFS

```
┌────────────────┐         ┌────────────────┐
│  MCP Server    │         │   Spectify     │
│  Port 3001/2   │         │   Port 3003    │
└────────────────┘         └────────────────┘
        │                          │
        └──────────┬───────────────┘
                   ↓
        ┌─────────────────────┐
        │   NFS Server        │
        │  /mnt/nfs/uploads   │
        └─────────────────────┘
```

**Pros:**
- Horizontal scaling
- High availability
- Independent deployments

**Cons:**
- Network latency
- NFS single point of failure
- Requires shared filesystem

**Configuration:**
```yaml
documentStore:
  directory: /mnt/nfs/uploads
  fallbackHttp:
    enabled: true
    baseUrl: http://mcp-server.internal:3002
```

**NFS Mount (Spectify):**
```bash
# /etc/fstab
mcp-server.internal:/var/lib/uploads  /mnt/nfs/uploads  nfs  defaults,ro  0  0
```

#### Option 3: Kubernetes with Shared PVC

```yaml
# persistent-volume-claim.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mcp-uploads-pvc
spec:
  accessModes:
    - ReadWriteMany  # Multiple pods can mount
  resources:
    requests:
      storage: 10Gi
  storageClassName: efs  # AWS EFS or similar

---
# mcp-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-server
spec:
  containers:
    - name: mcp
      volumeMounts:
        - name: uploads
          mountPath: /var/lib/uploads
  volumes:
    - name: uploads
      persistentVolumeClaim:
        claimName: mcp-uploads-pvc

---
# spectify-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: spectify
spec:
  replicas: 3  # Horizontal scaling
  containers:
    - name: spectify
      env:
        - name: SPECTIFYD_DOCUMENT_STORE_DIR
          value: /var/lib/uploads
      volumeMounts:
        - name: uploads
          mountPath: /var/lib/uploads
          readOnly: true  # Spectify only reads
  volumes:
    - name: uploads
      persistentVolumeClaim:
        claimName: mcp-uploads-pvc
```

**Pros:**
- Cloud-native
- Horizontal scaling
- High availability
- Automatic failover

**Cons:**
- Complexity
- Cost (managed storage)
- Potential latency (EFS)

#### Option 4: Object Storage (S3/MinIO) - Future

**Not yet implemented**, but design supports it:

```typescript
// src/storage/s3-document-accessor.ts
export class S3DocumentAccessor implements DocumentAccessor {
  async getDocumentPath(documentId: string): Promise<string> {
    // Download from S3 to temp file
    const tempPath = `/tmp/${documentId}.json`;
    await this.s3.downloadFile(`uploads/${documentId}.json`, tempPath);
    return tempPath;
  }
}
```

**Configuration (Future):**
```yaml
documentStore:
  type: s3
  bucket: mcp-openapi-documents
  region: us-west-2
  prefix: uploads/
```

### Health Checks

**Spectify Health Endpoint:**
```bash
curl http://localhost:3003/health
```

**Response:**
```json
{
  "status": "ok",
  "documentStore": {
    "accessible": true,
    "path": "/var/lib/uploads",
    "documentsCount": 42
  },
  "workers": {
    "total": 8,
    "active": 2,
    "idle": 6
  }
}
```

**Kubernetes Probes:**
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3003
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health
    port: 3003
  initialDelaySeconds: 10
  periodSeconds: 5
```

---

## Error Handling

### Document Not Found

**Scenario:** User submits lint job with invalid/deleted documentId

**Detection:**
```typescript
// src/document-accessor.ts
async getDocumentPath(documentId: string): Promise<string> {
  const path = join(this.uploadDir, `${documentId}.json`);
  
  if (!await this.fileExists(path)) {
    throw new DocumentNotFoundError(
      `Document ${documentId} not found in ${this.uploadDir}`
    );
  }
  
  return path;
}
```

**HTTP Response:**
```http
POST /lint
{
  "documentId": "00000000-0000-0000-0000-000000000000",
  "rulesetName": "pubhub"
}

HTTP/1.1 404 Not Found
{
  "error": "Not Found",
  "message": "Document 00000000-0000-0000-0000-000000000000 not found",
  "timestamp": "2025-11-20T10:30:00Z"
}
```

**Recommended User Action:**
1. Verify documentId from upload response
2. Check if document expired (MCP TTL)
3. Re-upload document

### Invalid Document ID Format

**Scenario:** User provides malformed documentId

**Detection:**
```typescript
isValidDocumentId(documentId: string): boolean {
  const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  return uuidRegex.test(documentId);
}
```

**HTTP Response:**
```http
POST /lint
{
  "documentId": "invalid-id",
  "rulesetName": "pubhub"
}

HTTP/1.1 400 Bad Request
{
  "error": "Validation Error",
  "message": "Invalid document ID format. Expected UUID v4.",
  "details": {
    "field": "documentId",
    "expected": "UUID v4 format",
    "received": "invalid-id"
  }
}
```

### Filesystem Access Errors

**Scenario:** Permission denied, disk full, NFS unavailable

**Detection:**
```typescript
try {
  const content = await fs.readFile(documentPath, 'utf-8');
} catch (error) {
  if (error.code === 'EACCES') {
    throw new Error('Permission denied accessing document store');
  } else if (error.code === 'ENOSPC') {
    throw new Error('Disk full in document store');
  } else if (error.code === 'ETIMEDOUT') {
    throw new Error('Timeout accessing document store (NFS issue?)');
  }
  throw error;
}
```

**HTTP Response:**
```http
HTTP/1.1 503 Service Unavailable
{
  "error": "Service Unavailable",
  "message": "Document store temporarily unavailable",
  "retryAfter": 30
}
```

### Fallback Strategy (HTTP)

**Configuration:**
```yaml
documentStore:
  directory: /mnt/nfs/uploads
  fallbackHttp:
    enabled: true
    baseUrl: http://mcp-server:3002
    timeout: 5000
```

**Fallback Logic:**
```typescript
async getDocumentContent(documentId: string): Promise<object> {
  try {
    // Primary: Filesystem
    const path = await this.getDocumentPath(documentId);
    const content = await fs.readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (this.config.fallbackHttp.enabled) {
      // Fallback: HTTP API
      logger.warn('Filesystem access failed, using HTTP fallback', { error });
      return await this.fetchViaHttp(documentId);
    }
    throw error;
  }
}
```

### Retry Strategy

**Exponential Backoff:**
```typescript
async executeWithRetry(task: Task): Promise<Result> {
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await this.execute(task);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      logger.warn(`Retry ${attempt}/${maxRetries} after ${delay}ms`, { error });
      await sleep(delay);
    }
  }
}
```

---

## Security Considerations

### Path Traversal Prevention

**Vulnerability:** Malicious documentId could access arbitrary files

**Example Attack:**
```json
{
  "documentId": "../../../etc/passwd"
}
```

**Mitigation (Implemented):**
```typescript
sanitizeDocumentId(documentId: string): string {
  // Remove path separators and special characters
  return documentId.replace(/[^a-zA-Z0-9-]/g, '');
}

async getDocumentPath(documentId: string): Promise<string> {
  // Validate UUID format BEFORE constructing path
  if (!this.isValidDocumentId(documentId)) {
    throw new Error('Invalid document ID format');
  }
  
  // Construct path safely
  const safePath = join(this.uploadDir, `${documentId}.json`);
  
  // Verify resolved path is within upload directory
  const resolvedPath = resolve(safePath);
  const uploadDirResolved = resolve(this.uploadDir);
  
  if (!resolvedPath.startsWith(uploadDirResolved)) {
    throw new Error('Path traversal attempt detected');
  }
  
  return safePath;
}
```

**Test Cases:**
```typescript
it('should reject path traversal attempts', () => {
  const attacks = [
    '../../../etc/passwd',
    '..%2F..%2Fetc%2Fpasswd',
    '....//....//etc/passwd',
    '/etc/passwd'
  ];
  
  attacks.forEach(attack => {
    expect(() => accessor.getDocumentPath(attack))
      .toThrow('Invalid document ID format');
  });
});
```

### Filesystem Permissions

**Recommended Permissions:**
```bash
# Upload directory
chown mcp-server:spectify /var/lib/uploads
chmod 2775 /var/lib/uploads  # SGID bit for group ownership

# Document files (created by MCP)
chmod 0664 /var/lib/uploads/*.json
```

**User/Group Setup:**
```bash
# Create shared group
groupadd mcp-upload-access

# Add both processes to group
usermod -a -G mcp-upload-access mcp-server
usermod -a -G mcp-upload-access spectify
```

**SELinux (if enabled):**
```bash
semanage fcontext -a -t mcp_upload_t "/var/lib/uploads(/.*)?"
restorecon -Rv /var/lib/uploads
```

### Document Content Validation

**Prevent Malicious Payloads:**
```typescript
async validateDocument(content: string): Promise<void> {
  // Check file size
  if (content.length > 100 * 1024 * 1024) {  // 100MB
    throw new Error('Document too large');
  }
  
  // Validate JSON structure
  let doc;
  try {
    doc = JSON.parse(content);
  } catch {
    throw new Error('Invalid JSON format');
  }
  
  // Validate OpenAPI structure
  if (!doc.openapi && !doc.swagger) {
    throw new Error('Not an OpenAPI document');
  }
  
  // Prevent prototype pollution
  if (doc.hasOwnProperty('__proto__') || 
      doc.hasOwnProperty('constructor')) {
    throw new Error('Malicious payload detected');
  }
}
```

### Rate Limiting (Future)

**Per-Document Rate Limiting:**
```typescript
// Prevent abuse of same documentId
const rateLimiter = new RateLimiter({
  maxRequestsPerDocument: 100,
  windowSeconds: 3600
});

app.post('/lint', async (req, res) => {
  if (!rateLimiter.allow(req.body.documentId)) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded for this document'
    });
  }
  // ...
});
```

---

## API Contract Reference

### MCP Server Version

**Server:** openapi-analysis-mcp  
**Version:** 0.3.1  
**Protocol:** 2025-06-18  
**Transport:** streamable-http

### Contract Dump

**Location:** `docs/mcp-openapi-analysis/mcp_openapi_analysis-mcpcontract_dump-0.3.1.yaml`

**Dump Schema:** `docs/mcp-openapi-analysis/mcpcontract_dump_schema-0.3.1.json`

**Generated:** 2025-11-12 using `mcpcontract` tool v0.6.3

### Key Contract Points

1. **Document Upload:**
   - Endpoint: `POST http://localhost:3002/upload`
   - Returns: `{ documentId: "uuid" }`

2. **Document Storage:**
   - Location: `./uploads/{documentId}.json`
   - Format: JSON (parsed OpenAPI)
   - Lifetime: 24 hours (configurable)

3. **Document ID:**
   - Format: UUID v4
   - Pattern: `[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}`

4. **MCP Tools:**
   - 9 tools available (not used by Spectify)
   - All require `documentId` parameter
   - Return structured JSON results

### Version Compatibility

**Spectify** is compatible with MCP OpenAPI Analyzer:
- **v0.3.x** - Current version (tested)
- **v0.2.x** - Should work (same filesystem contract)
- **v0.4.x** - Expected to work (backward compatible)

**Breaking Changes:**
- If MCP changes document storage location
- If MCP changes document ID format
- If MCP changes file naming convention

**Migration Guide:** See `mcp-openapi-analysis/CHANGELOG.md`

---

## Summary

### Integration Checklist

- [x] **Filesystem Contract** - Documents stored at `./uploads/{uuid}.json`
- [x] **Document ID Format** - UUID v4 validation
- [x] **Path Traversal Prevention** - UUID validation + path checks
- [x] **Error Handling** - Document not found, filesystem errors, fallback
- [x] **Configuration** - Environment variables + YAML config
- [x] **Development Setup** - Local MCP server + Spectify
- [x] **Production Deployment** - NFS, Kubernetes, co-located options
- [x] **Security** - Permissions, validation, rate limiting
- [x] **Documentation** - This document + contract dump + README

### Key Takeaways

1. **Spectify uses filesystem access** - Not HTTP API during linting
2. **MCP server is independent** - Can be deployed separately
3. **Documents are cached** - Workers cache for fast re-execution
4. **Zero-copy architecture** - File paths passed, not content
5. **Fallback supported** - HTTP API fallback if filesystem unavailable
6. **Production-ready** - NFS, Kubernetes, security hardening

### Related Documentation

- **MCP Server README:** `docs/mcp-openapi-analysis/README.md`
- **MCP Contract Dump:** `docs/mcp-openapi-analysis/mcp_openapi_analysis-mcpcontract_dump-0.3.1.yaml`
- **Contract Schema:** `docs/mcp-openapi-analysis/mcpcontract_dump_schema-0.3.1.json`
- **Spectify README:** `README.md`
- **AGENTS.md:** Integration patterns for AI agents
- **Architecture Decisions:** `docs/ARCHITECTURE_DECISIONS.md`

---

**Last Updated:** November 20, 2025  
**Maintainer:** DevNet Team  
**License:** Apache 2.0
