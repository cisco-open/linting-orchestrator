/**
 * Agents Command
 * Generates LLM-friendly documentation in markdown format
 * Like a man page but optimized for AI agents
 */

export async function agentsCommand(): Promise<void> {
  console.log(generateAgentDocumentation());
}

function generateAgentDocumentation(): string {
  return `# Linting Orchestrator — For AI Agents

## OVERVIEW

The **linting orchestrator** is an independent microservice that orchestrates quality assurance checks on API specifications using Spectral and custom rule engines.

- **Type:** HTTP API Server + CLI Tool
- **Purpose:** Validate and lint API specifications (OpenAPI, AsyncAPI, Arazzo) against configurable rulesets
- **Architecture:** Worker-pool based with document caching and dynamic scaling
- **Deployment:** Three modes (Embedded/Standalone/Companion)
- **Performance:** 100-200 documents/minute, 60% faster with cache hits

---

## QUICK START FOR AGENTS

### 1. Check if the orchestrator is running

\`\`\`bash
curl -s http://localhost:3003/health | jq
\`\`\`

Expected response:
\`\`\`json
{
  "status": "healthy",
  "version": "0.5.0",
  "workerPool": {"activeWorkers": 6, "maxWorkers": 15}
}
\`\`\`

### 2. List Available Rulesets

\`\`\`bash
curl -s http://localhost:3003/rulesets | jq
\`\`\`

### 3. Lint a Document

\`\`\`bash
# Submit lint job
curl -X POST http://localhost:3003/lint \\
  -H "Content-Type: application/json" \\
  -d '{
    "documentId": "doc-uuid",
    "rulesetName": "pubhub",
    "rulesetVersion": "1.1.0"
  }'

# Returns: {"jobId": "job-abc-123", "status": "queued"}

# Poll for results
curl -s http://localhost:3003/lint/job-abc-123

# Get results when completed
curl -s http://localhost:3003/lint/job-abc-123/results | jq
\`\`\`

---

## ARCHITECTURE

### Components

1. **HTTP API Server** (port 3003)
   - Accepts lint requests, returns job IDs
   - RESTful endpoints for job status and results
   - Health monitoring and statistics

2. **Job Orchestrator**
   - Manages job lifecycle and task distribution
   - Handles retries with exponential backoff
   - Aggregates results from workers

3. **Worker Pool Manager**
   - Manages persistent worker threads
   - Pre-loads rulesets (200-500ms saved per job)
   - Document affinity caching (60% faster)
   - Auto-scaling based on load (5-30 workers)

4. **Workers**
   - Execute Spectral linting in isolated threads
   - Cache last document (LRU, 50MB max per worker)
   - Pre-loaded with specific rulesets

5. **Storage Adapter**
   - Pluggable result storage (memory, Redis)
   - Cache invalidation support
   - TTL-based expiration

### Zero-Copy Architecture

Workers receive **file paths**, not document content:
- Minimizes memory copies between threads
- 50-100ms saved per large document
- Enables document caching at worker level

---

## DEPLOYMENT MODES

| Mode | Use Case | Workers | Document Store |
|------|----------|---------|----------------|
| **Embedded** | CLI embedded | 10 | ~/.spectify/uploads/ |
| **Standalone** | Dedicated server | 30 | /var/spectify/uploads/ |
| **Companion** | MCP-managed | 15 | Shared with MCP |

### Starting the Server

\`\`\`bash
# Embedded mode (embedded in CLI)
spectify start

# Standalone mode (dedicated daemon)
spectifyd

# Or with custom config
spectifyd --port 3003 --document-store /var/spectify/uploads
\`\`\`

---

## HTTP API REFERENCE

### POST /lint - Submit Lint Job

**Request:**
\`\`\`json
{
  "documentId": "550e8400-e29b-41d4-a716-446655440000",
  "rulesetName": "pubhub",
  "rulesetVersion": "1.1.0",
  "options": {
    "forceRun": false,
    "failOnError": false
  }
}
\`\`\`

**Response:** 202 Accepted
\`\`\`json
{
  "jobId": "job-uuid-123",
  "status": "queued",
  "estimatedCompletion": "2025-12-19T10:05:30Z"
}
\`\`\`

### GET /lint/:jobId - Get Job Status

**Response:** 200 OK
\`\`\`json
{
  "jobId": "job-uuid-123",
  "status": "running",
  "progress": {
    "totalTasks": 1,
    "completedTasks": 0,
    "runningTasks": 1,
    "percentage": 0
  },
  "submittedAt": "2025-12-19T10:05:00Z"
}
\`\`\`

### GET /lint/:jobId/results - Get Results

**Response:** 200 OK (when completed)
\`\`\`json
{
  "jobId": "job-uuid-123",
  "documentId": "doc-uuid",
  "status": "completed",
  "summary": {
    "totalIssues": 15,
    "errorCount": 5,
    "warningCount": 8,
    "infoCount": 2
  },
  "results": [
    {
      "code": "operation-description",
      "message": "Operation must have a description",
      "severity": "error",
      "path": ["paths", "/users", "get"],
      "range": {"start": {"line": 10, "character": 0}}
    }
  ],
  "executionTime": 245,
  "cacheHit": false
}
\`\`\`

### GET /rulesets - List Available Rulesets

**Response:** 200 OK
\`\`\`json
{
  "rulesets": [
    {
      "name": "pubhub",
      "displayName": "PubHub Readiness Analyzer",
      "description": "60+ rules for DevNet publication",
      "versions": ["1.0.0", "1.1.0"],
      "defaultVersion": "1.1.0",
      "tags": ["devnet", "publishing", "quality"]
    }
  ]
}
\`\`\`

### GET /rulesets/:name - Get Ruleset Details

**Response:** 200 OK
\`\`\`json
{
  "name": "pubhub",
  "displayName": "PubHub Readiness Analyzer",
  "versions": ["1.0.0", "1.1.0"],
  "defaultVersion": "1.1.0",
  "rules": [
    {
      "code": "info-description",
      "severity": "error",
      "message": "Info object must have a description"
    }
  ]
}
\`\`\`

### GET /health - Health Check

**Response:** 200 OK
\`\`\`json
{
  "status": "healthy",
  "version": "0.5.0",
  "uptime": 3600,
  "workerPool": {
    "activeWorkers": 6,
    "idleWorkers": 4,
    "maxWorkers": 15
  },
  "stats": {
    "totalJobs": 125,
    "completedJobs": 120,
    "failedJobs": 2,
    "cacheHitRate": 0.45
  }
}
\`\`\`

### GET /stats - Statistics

**Response:** 200 OK
\`\`\`json
{
  "totalJobs": 125,
  "activeJobs": 3,
  "completedJobs": 120,
  "failedJobs": 2,
  "cacheHits": 56,
  "cacheMisses": 69,
  "cacheHitRate": 0.448,
  "averageExecutionTime": 245,
  "workerStats": {
    "active": 6,
    "idle": 4,
    "busy": 3
  }
}
\`\`\`

### DELETE /cache/:documentId - Invalidate Cache

**Response:** 204 No Content

---

## CLI USAGE

### Available Commands

\`\`\`bash
spectify start [options]          # Start server
spectify stop [options]            # Stop server
spectify ps [options]              # List running processes
spectify lint <file> [options]    # Lint a document
spectify status <jobId>            # Check job status
spectify results <jobId>           # Get job results
spectify history [options]         # Show lint history
spectify rulesets [options]        # List rulesets
spectify health [options]          # Check server health
spectify config [action]           # Manage configuration
spectify completion [--shell]      # Generate shell completion
spectify --agents                  # Show this documentation
spectify --help                    # Show help
spectify --version                 # Show version
\`\`\`

### Lint Command Examples

\`\`\`bash
# Basic lint
spectify lint openapi.yaml

# With specific ruleset
spectify lint api.yaml --ruleset contract --version 1.0.0

# Force bypass cache
spectify lint api.yaml --no-cache

# Show all issues (no limit)
spectify lint api.yaml --show-all

# Use custom server
spectify lint api.yaml --server http://server.company.com:3003
\`\`\`

### Configuration

\`\`\`bash
# Show current configuration
spectify config show

# Set default mode
spectify config set mode standalone

# Set default server URL (e.g. remote Docker host)
spectify config set url http://localhost:3003

# Reset to defaults
spectify config reset
\`\`\`

---

## CONFIGURATION

### Default Configuration

Located at \`config/default.yaml\` or via environment variables:

\`\`\`yaml
server:
  port: 3003
  host: 0.0.0.0

workerPool:
  minWorkersPerRuleset: 1
  maxWorkersPerRuleset: 2
  totalMaxWorkers: 15
  documentCache:
    enabled: true
    maxDocumentsPerWorker: 1
    ttlSeconds: 300

documentStore:
  type: local
  baseDir: ./uploads

storage:
  type: memory
  ttl: 3600

logging:
  level: info
  format: json

rulesets:
  directory: ./rulesets
  defaultVersion: latest
  cacheEnabled: true
\`\`\`

### Environment Variables

\`\`\`bash
PORT=3003                          # Server port
DOCUMENT_STORE_DIR=./uploads       # Document storage path
TOTAL_MAX_WORKERS=15               # Max worker threads
STORAGE_TYPE=memory                # Storage backend (memory|redis)
LOG_LEVEL=info                     # Logging level
\`\`\`

---

## AVAILABLE RULESETS

### 1. PubHub (pubhub)

**Purpose:** DevNet PubHub publication readiness
**Rules:** 60+
**Versions:** 1.0.0, 1.1.0 (default)

**Categories:**
- Developer Experience (14 rules)
- Publishing Requirements (12 rules)
- PubHub Rendering (9 rules)
- API Design (25+ rules)

**Example rules:**
- \`info-description\`: Info must have description
- \`operation-description\`: Operations must have descriptions
- \`operation-summary\`: Operations must have summaries
- \`tag-description\`: Tags must have descriptions

### 2. Contract (contract)

**Purpose:** API contract validation
**Rules:** 62+
**Versions:** 1.0.0 (default)

**Categories:**
- Versioning
- Documentation
- Operations
- Schemas

### 3. API Insights (api-insights)

**Purpose:** Cisco API Insights compatibility
**Rules:** 50+
**Versions:** 2025.11.19

**Categories:**
- REST Guidelines
- Best Practices
- Common Mistakes

### 4. Documentation (documentation)

**Purpose:** Documentation quality
**Rules:** 20+

### 5. Quality (quality)

**Purpose:** General API quality
**Rules:** 15+

---

## INTEGRATION PATTERNS

### Pattern 1: Direct HTTP API

\`\`\`typescript
// Submit lint job
const response = await fetch('http://localhost:3003/lint', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    documentId: 'doc-uuid',
    rulesetName: 'pubhub'
  })
});
const { jobId } = await response.json();

// Poll for completion
let status = 'running';
while (status === 'running' || status === 'queued') {
  const statusRes = await fetch(\`http://localhost:3003/lint/\${jobId}\`);
  ({ status } = await statusRes.json());
  await new Promise(r => setTimeout(r, 1000));
}

// Get results
const resultsRes = await fetch(\`http://localhost:3003/lint/\${jobId}/results\`);
const results = await resultsRes.json();
\`\`\`

### Pattern 2: CLI Automation

\`\`\`bash
#!/bin/bash
# Lint all OpenAPI files in directory

for file in apis/*.yaml; do
  echo "Linting $file..."
  spectify lint "$file" --ruleset pubhub
  
  if [ $? -eq 0 ]; then
    echo "✓ $file passed"
  else
    echo "✗ $file failed"
  fi
done
\`\`\`

### Pattern 3: MCP Integration

The orchestrator integrates with MCP OpenAPI Analyzer to access uploaded documents:

\`\`\`bash
# 1. Upload document to MCP
curl -X POST http://localhost:3002/upload \\
  -H "Content-Type: application/x-yaml" \\
  --data-binary @api.yaml
# Returns: {"documentId": "550e8400..."}

# 2. Lint via the orchestrator
curl -X POST http://localhost:3003/lint \\
  -H "Content-Type: application/json" \\
  -d '{"documentId": "550e8400...", "rulesetName": "pubhub"}'

# 3. Get results
curl http://localhost:3003/lint/<jobId>/results
\`\`\`

---

## PERFORMANCE CHARACTERISTICS

### Execution Times

- **Ruleset loading:** 200-500ms (once per worker)
- **Document parsing:** 10-50ms (small), 100-200ms (large)
- **Rule execution:** 50-300ms (depends on ruleset size)
- **Cache lookup:** 5-10ms
- **Cache hit speedup:** 60% faster

### Throughput

- **Without cache:** 100-150 docs/minute (15 workers)
- **With cache:** 150-200 docs/minute (45% hit rate)
- **Single document:** 1-3 seconds (cold start), 0.5-1s (cached)

### Resource Usage

- **Memory:** 200-500MB base + 50MB per worker
- **CPU:** Scales with core count (1-2 workers per core)
- **Disk:** Minimal (results cached in memory by default)

### Scaling Limits

- **Max workers:** 30 (recommended), configurable to CPU cores
- **Max concurrent jobs:** 100+
- **Document size:** Up to 50MB (configurable)

---

## ERROR HANDLING

### Common HTTP Status Codes

- **200 OK:** Request successful
- **202 Accepted:** Job submitted, check status
- **400 Bad Request:** Invalid request (missing documentId, etc.)
- **404 Not Found:** Job, document, or ruleset not found
- **409 Conflict:** Cached result already exists (use forceRun=true)
- **500 Internal Server Error:** Server error, check logs
- **503 Service Unavailable:** Server overloaded or starting up

### Job Statuses

- **queued:** Job submitted, waiting for worker
- **running:** Currently executing
- **completed:** Finished successfully
- **failed:** Execution failed (check error details)

### Retry Strategy

The orchestrator automatically retries failed tasks:
- **Max retries:** 2 (configurable)
- **Backoff:** Exponential (100ms, 200ms, 400ms)
- **Retry conditions:** Worker crashes, timeout, transient errors

---

## TROUBLESHOOTING FOR AGENTS

### Problem: Server not responding

\`\`\`bash
# Check if server is running
curl -s http://localhost:3003/health

# If not, start it
spectify start
# or
spectifyd
\`\`\`

### Problem: Job stuck in "queued" status

**Cause:** Worker pool not initialized or overloaded

**Solution:**
\`\`\`bash
# Check worker status
curl -s http://localhost:3003/stats | jq '.workerStats'

# Restart server if needed
spectify stop && spectify start
\`\`\`

### Problem: "Document not found" error

**Cause:** Document not uploaded or expired

**Solution:**
1. Verify document exists: \`curl http://localhost:3002/documents/<docId>\`
2. Re-upload document if needed
3. Check document store path configuration

### Problem: Cache stale after document update

**Solution:**
\`\`\`bash
# Invalidate cache for specific document
curl -X DELETE http://localhost:3003/cache/<documentId>

# Or force bypass cache
curl -X POST http://localhost:3003/lint \\
  -d '{"documentId": "...", "rulesetName": "pubhub", "options": {"forceRun": true}}'
\`\`\`

---

## AGENT RECOMMENDATIONS

### When to use the linting orchestrator

✅ **Good for:**
- Automated API quality checks in CI/CD
- Batch validation of multiple documents
- Pre-publication readiness checks
- Integration with custom workflows
- High-performance linting (100+ docs/min)

❌ **Not ideal for:**
- Interactive web-based linting (use API Insights)
- Visual diff and changelog generation
- Team collaboration with dashboards
- Long-term version history tracking

### Integration Best Practices

1. **Always check health** before submitting jobs
2. **Poll with exponential backoff** (1s, 2s, 4s, max 30s)
3. **Handle all HTTP status codes** gracefully
4. **Cache ruleset info** (changes infrequently)
5. **Use forceRun=true** when document updated
6. **Invalidate cache** after document modifications
7. **Set reasonable timeouts** (30s for status, 5min for results)

### Example Agent Workflow

\`\`\`
1. User provides OpenAPI file
2. Check if the orchestrator is running (GET /health)
3. If not running, suggest: "spectify start"
4. Submit lint job (POST /lint)
5. Poll status every 2-3 seconds (GET /lint/:jobId)
6. When completed, fetch results (GET /lint/:jobId/results)
7. Parse and present issues to user
8. Offer to fix issues or explain errors
\`\`\`

---

## ADDITIONAL RESOURCES

- **Repository:** https://github.com/cisco-open/linting-orchestrator
- **API Documentation:** docs/quick-start-api.md
- **CLI Documentation:** docs/quick-start-cli.md
- **Architecture:** docs/internal/design/lint-orchestrator-design.md
- **Integration Guide:** docs/internal/integrations/spectify-mcp.md
- **Installation:** docs/installation.md

---

## VERSION

**Linting Orchestrator v0.5.0**
- API Version: 0.5.0
- CLI Version: 0.5.0
- Updated: December 19, 2025

---

*This documentation is generated for AI agents and LLMs. For human-readable documentation, see the main README.md or docs/ directory.*
`;
}
