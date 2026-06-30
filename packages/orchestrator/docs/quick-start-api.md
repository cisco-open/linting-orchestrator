# orchestrator API Server Quick Start

Get the orchestrator API server (linting engine) up and running in minutes.

---

## 🎯 Choose Your Mode

The orchestrator runs in two modes:

- **Standalone Mode** ⭐ (Recommended) - the orchestrator manages its own document storage
- **Companion Mode** - Integrates with MCP OpenAPI Analyzer for document management

---

## 1️⃣ Standalone Mode (Recommended)

### Prerequisites

```bash
# Node.js 20+ required
node --version  # Should be >= 20.0.0

# Install the orchestrator
npm install -g @cisco_open/linting-orchestrator
```

### Start the Server

```bash
spectifyd
# Server runs on http://localhost:3003
```

### Quick Test

```bash
# 1. Check health
curl http://localhost:3003/health

# 2. Upload an OpenAPI document
curl -X POST http://localhost:3003/documents \
  -H "Content-Type: application/x-yaml" \
  --data-binary @examples/petstore.yaml

# Returns: {"documentId": "550e8400-e29b-41d4-a716-446655440000"}

# 3. Lint the document
curl -X POST http://localhost:3003/lint \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "550e8400-e29b-41d4-a716-446655440000",
    "rulesetName": "pubhub"
  }'

# Returns: {"jobId": "job-123"}

# 4. Check lint results
curl http://localhost:3003/lint/job-123

# 5. Get results when complete
curl http://localhost:3003/lint/job-123/results
```

### Available Rulesets

```bash
# List all rulesets
curl http://localhost:3003/rulesets | jq

# Get ruleset details
curl http://localhost:3003/rulesets/pubhub | jq
```

---

## 2️⃣ Companion Mode (With MCP)

### Prerequisites

```bash
# Install the orchestrator
npm install -g @cisco_open/linting-orchestrator
```

### ⚠️ CRITICAL: Startup Order

**the orchestrator MUST start before MCP** (MCP checks the orchestrator health on startup)

```bash
# Terminal 1: Start the orchestrator FIRST
spectifyd --config config/companion.yaml
# Wait for: "✅ Orchestrator initialized on port 3003"

# Terminal 2: Start MCP SECOND (after Spectify is ready)
cd ../mcp-openapi-analysis
npm start
# MCP verifies Spectify is running, then starts
```

### Quick Test

```bash
# 1. Check both services
curl http://localhost:3003/health  # Spectify
curl http://localhost:3002/health  # MCP

# 2. Upload to MCP (different port!)
curl -X POST http://localhost:3002/upload \
  -H "Content-Type: application/x-yaml" \
  --data-binary @examples/petstore.yaml

# Returns: {"documentId": "550e8400-..."}

# 3. Lint via Spectify (using MCP's documentId)
curl -X POST http://localhost:3003/lint \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "550e8400-e29b-41d4-a716-446655440000",
    "rulesetName": "pubhub"
  }'

# 4. Check results (same as standalone)
curl http://localhost:3003/lint/<jobId>/results
```

---

## 🔧 Configuration

### Standalone Configuration

Default config: [config/standalone.yaml](../config/standalone.yaml)

```yaml
server:
  port: 3003
  host: '0.0.0.0'

documentStore:
  type: 'local'
  baseDir: './uploads'

httpEndpoints:
  enableDocumentUpload: true  # Enable /documents endpoint

workerPool:
  minWorkersPerRuleset: 1
  maxWorkersPerRuleset: 2
  totalMaxWorkers: 15
```

### Companion Configuration

Default config: [config/companion.yaml](../config/companion.yaml)

```yaml
server:
  port: 3003

documentStore:
  type: 'mcp'
  baseDir: '../mcp-openapi-analysis/datastore/documents'
  fallbackHttp: 'http://localhost:3002'

httpEndpoints:
  enableDocumentUpload: false  # Use MCP's upload endpoint
```

### Custom Configuration

```bash
# Use custom config file
npm start -- --config path/to/your-config.yaml

# Or override with environment variables
PORT=4000 npm start
SPECTIFYD_DOCUMENT_STORE_DIR=/path/to/uploads npm start
```

---

## 📊 API Endpoints

### Health & Monitoring

```bash
# Health check
GET /health

# Server statistics
GET /stats

# List rulesets
GET /rulesets

# Ruleset details
GET /rulesets/:name
GET /rulesets/:name/versions
```

### Document Management (Standalone Mode Only)

```bash
# Upload document
POST /documents
Content-Type: application/json | application/x-yaml

# List documents
GET /documents

# Get document
GET /documents/:id

# Delete document
DELETE /documents/:id
```

### Linting

```bash
# Submit lint job
POST /lint
Body: {
  "documentId": "uuid",
  "rulesetName": "pubhub",
  "rulesetVersion": "latest"  # optional
}

# Get job status
GET /lint/:jobId

# Get lint results
GET /lint/:jobId/results

# List jobs
GET /lint/jobs
```

---

## 🐛 Troubleshooting

### Port Already in Use

```bash
# Change port
PORT=4000 npm start

# Or edit config file
server:
  port: 4000
```

### Document Not Found (Companion Mode)

**Check MCP is running:**
```bash
curl http://localhost:3002/health
```

**Verify document store path:**
```bash
ls ../mcp-openapi-analysis/datastore/documents/
```

**Check the orchestrator config:**
```yaml
documentStore:
  baseDir: '../mcp-openapi-analysis/datastore/documents'
```

### MCP Won't Start

**Error:** "The orchestrator is enabled but not reachable"

**Solution:** Start the orchestrator FIRST, then MCP

```bash
# Correct order:
# 1. Start Spectify
cd linting-orchestrator && npm start -- --config config/companion.yaml

# 2. Wait for ready message
# ✅ Orchestrator initialized on port 3003

# 3. Then start MCP
cd ../mcp-openapi-analysis && npm start
```

### Worker Pool Issues

**Check worker status:**
```bash
curl http://localhost:3003/stats | jq '.workerPool'
```

**Adjust worker limits:**
```yaml
workerPool:
  minWorkersPerRuleset: 1
  maxWorkersPerRuleset: 5    # Increase for better throughput
  totalMaxWorkers: 30        # Increase on powerful servers
```

---

## 🚀 Development Mode

### With Hot Reload

```bash
# Standalone mode
npm run dev:standalone

# Companion mode
npm run dev:companion
```

### Run Tests

```bash
# All tests
npm test

# Server tests only (unit + e2e/loader/perf)
npm run test:server

# CLI tests only
npm run test:cli
```

---

## 📚 Next Steps

- **CLI Quick Start:** [quick-start-cli.md](quick-start-cli.md) - Use the command-line interface
- **Ruleset Management:** [ruleset-management.md](ruleset-management.md) - Create custom rulesets
- **Integration:** [internal/integrations/spectify-mcp.md](internal/integrations/spectify-mcp.md) - Deep dive into MCP integration

