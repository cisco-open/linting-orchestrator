# Deployment modes and port strategy

## Overview

The **linting orchestrator** is a quality-assurance service that analyzes API specifications (OpenAPI, AsyncAPI, Arazzo) using configurable rulesets and linters (Spectral, custom rules, etc.). It is designed to be flexible and can run in multiple deployment modes to suit different use cases.

This document defines the deployment architecture, port assignments, and how the orchestrator integrates with the **MCP OpenAPI Analyzer**.

---

## The Services

### 1. Linting orchestrator
- **Purpose**: Lint OpenAPI documents using Spectral and custom rulesets
- **Core API**: HTTP REST API for submitting lint jobs and retrieving results
- **Default Ports**: `3003` (standalone) or `3004` (companion)
- **Launched with**: `spectifyd` binary (for standalone/companion modes)
- **Embedded**: Can also run embedded in `spectify lint` command (embedded mode)

### 2. OpenAPI Analyzis MCP Server
- **Purpose**: MCP protocol server for AI agents to analyze OpenAPI documents
- **Core API**: MCP protocol over StreamableHTTP transport
- **Default Port**: `3001`
- **Launched with**: `npm run start+spectify` in `mcp-openapi-analysis` repository

### 3. Document Store
- **Purpose**: Document upload, storage, and metadata management
- **Core API**: HTTP REST API for uploading documents and retrieving metadata
- **Default Port**: `3002`
- **Launched with**: same as MCP Server (both MCP server and Upload API start together)

---

## Deployment modes

The orchestrator can run in **three distinct modes**, each designed for specific use cases:

### Mode 1: Embedded Mode

**Use Case**: CI/CD pipelines, isolated containers, one-time usage, getting started

**Architecture**:
- orchestrator server runs embedded in the CLI process
- No separate server process
- Server starts automatically when needed, stops when CLI exits
- Uses in-memory storage (results not persisted)

**Characteristics**:
- ✅ Zero configuration required
- ✅ No server management needed
- ✅ Perfect for CI/CD and automation (GitHub Actions, GitLab CI, Docker)
- ✅ Complete isolation (no shared state or security concerns)
- ✅ Works without persistent infrastructure
- ⚠️ Slower than standalone (startup overhead ~1-2s per invocation)
- ❌ Not recommended for iterative development (use standalone instead)
- ❌ No persistent results storage
- ❌ Not suitable for concurrent requests

**Performance Note**: Embedded mode has overhead (Node.js startup, module loading, worker initialization). For regular development with multiple lint operations, **standalone mode is significantly faster**.

**Port**: `3003` (internal, auto-assigned)

**CLI Commands**:
```bash
# Embedded mode is automatic - just run lint commands directly
# Server starts in-process, lints the file, then exits
spectify lint ./openapi.yaml --ruleset pubhub

# Each command is independent - no state shared between invocations
spectify lint ./openapi.yaml --ruleset spectral:oas

# Future enhancement: Session context to reuse last document
# spectify lint --ruleset spectral:oas  (would reuse previous document)
```

**Note**: In embedded mode, document IDs are internal only. Users work with file paths, and each command is completely independent.

**Who Starts the Server**: The `spectify` CLI itself (automatically)

**Configuration**: 
- None required (zero-config)
- Uses built-in defaults only
- Does NOT read `config.yaml` or `~/.spectify/config.json`
- All configuration is embedded in the CLI binary

---

### Mode 2: Standalone Mode

**Use Case**: Long-running server, multiple users/requests, persistent results

**Architecture**:
- orchestrator server runs as independent background process
- Launched with `spectifyd` binary (no special CLI commands needed)
- Process persists across CLI invocations
- Can use external storage (Redis, database)
- Multiple clients can connect concurrently
- Document store: `~/.spectify/uploads` (user's home directory)

**Characteristics**:
- ✅ Long-running, persistent server
- ✅ Handles concurrent requests
- ✅ Optional external storage for results
- ✅ Independent scaling
- ✅ Full-featured HTTP API
- ⚠️ Requires manual server management (start/stop)
- ⚠️ User manages document storage

**Port**: `3003` (default, configurable)

**CLI Commands**:
```bash
# Start standalone server (default port 3003)
spectifyd

# Start with custom port
spectifyd --port 8080

# Start with custom document store
spectifyd --document-store /path/to/uploads

# Run in background (use standard process management)
spectifyd &

# Or use nohup for persistent background process
nohup spectifyd > /tmp/spectify.log 2>&1 &

# Stop the server (use system process management)
kill <pid>  # or use pkill, systemctl, pm2, etc.
```

**Who Starts the Server**: 
- User explicitly via `spectifyd` binary
- System service (systemd, pm2, Docker)

**Configuration**: 
- Optional `config.yaml` for advanced settings
- Environment variables: `PORT`, `SPECTIFYD_DOCUMENT_STORE_DIR`
- CLI flags: `--port`, `--document-store`, `--host`, `--log-level`

**Document Storage**: 
- Default: `~/.spectify/uploads` (user's home directory)
- Override with `--document-store` flag or `SPECTIFYD_DOCUMENT_STORE_DIR` env var

---

### Mode 3: Companion Mode (with MCP)

**Use Case**: Integrated with MCP OpenAPI Analyzer for full document lifecycle management

**Architecture**:
- orchestrator server runs as independent process (like standalone)
- MCP OpenAPI Analyzer manages document storage and lifecycle
- MCP delegates linting tasks to the orchestrator via HTTP API
- Graceful degradation: MCP works without the orchestrator (linting disabled)

**Characteristics**:
- ✅ Integrated document management (upload, storage, analysis, linting)
- ✅ Shares MCP's document store (no duplication)
- ✅ Lighter resource usage (moderate worker pool)
- ✅ Graceful degradation (MCP works without the orchestrator)
- ✅ Auto-reconnection if the orchestrator restarts
- ✅ AI agents get unified interface via MCP
- ⚠️ Must specify `--document-store` path explicitly (required)
- ⚠️ Different default port (3004) to avoid conflicts with standalone

**Ports**: 
- the orchestrator Companion: `3004` (default for companion mode, avoids conflicts)
- MCP Upload API: `3002` (document upload/storage)
- MCP Server: `3001` (MCP protocol for AI agents)

**How to Start**:

**Option A: Using spectifyd directly**
```bash
# Terminal 1: Start MCP (manages documents)
cd mcp-openapi-analysis
npm start

# Terminal 2: Start Spectify in companion mode
spectifyd --mode companion --document-store /path/to/mcp/datastore/documents

# Or with absolute path
spectifyd --mode companion --document-store /home/user/repos/mcp-openapi-analysis/datastore/documents
```

**Option B: Using simplified launch script**
```bash
# Use the provided example script (handles everything)
cd spectify
./examples/start-with-mcp.sh

# Or customize with environment variables
SPECTIFY_PORT=3005 MCP_DOCUMENTS_PATH=/custom/path ./examples/start-with-mcp.sh
```

**Who Starts the Server**: 
- MCP: Always started by user (`npm start`)
- the orchestrator: Started separately with `spectifyd --mode companion`

**Configuration**:
- **Document store path**: REQUIRED via `--document-store` flag
- **Port**: Default 3004, override with `--port` or `PORT` env var
- **Example**: See `examples/start-with-mcp.sh` for reference
  baseUrl: http://localhost:3003
  gracefulDegradation: true
  retryInterval: 30000  # Auto-reconnect every 30s
```

**Document Storage**: 
- MCP manages: `./datastore/` (persistent storage)
- Spectify accesses: Via filesystem or HTTP API
- Documents uploaded to MCP, linted by Spectify

**Integration Flow**:
1. AI agent uploads document to MCP (`POST :3002/upload`)
2. MCP stores document in `./datastore/`
3. AI agent requests lint via MCP tool (`lint_document`)
4. MCP calls Spectify API (`POST :3003/lint`)
5. Spectify lints document and returns job ID
6. AI agent polls Spectify via MCP (`get_lint_status`, `get_lint_results`)

---

## Port Assignment Strategy

### Current Port Allocations

| Service | Port | Purpose | Configurable |
|---------|------|---------|--------------|
| **MCP Server** | `3001` | MCP protocol (AI agents) | Yes (`MCP_PORT`) |
| **MCP Upload API** | `3002` | Document upload/storage | Yes (`UPLOAD_PORT`) |
| **Spectify Standalone** | `3003` | Lint orchestrator (independent) | Yes (`PORT`, `--port`) |
| **Spectify Companion** | `3004` | Lint orchestrator (with MCP) | Yes (`PORT`, `--port`) |

**Note:** Spectify uses different default ports for standalone (3003) and companion (3004) modes to allow running both simultaneously without port conflicts.

### Rationale

**Why these specific ports?**

1. **Sequential numbering** (`3001`, `3002`, `3003`):
   - Easy to remember
   - Indicates service relationship
   - Avoids common port conflicts

2. **MCP first** (`3001-3002`):
   - MCP is the "front door" for AI agents
   - Document lifecycle starts with MCP
   - Upload API is secondary MCP endpoint

3. **Spectify last** (`3003`):
   - Spectify is a backend service (called by MCP)
   - Independent service (works standalone too)
   - Higher port number indicates "supporting service"

**Why separate upload and MCP ports?**
- Upload API: RESTful HTTP (simple, curl-friendly)
- MCP Server: MCP protocol over HTTP (AI agent clients)
- Different protocols, different clients, clear separation

### Port Configuration Priority

**Spectify** (Standalone/Companion modes only):
```
1. CLI flag:        --port 3005
2. Environment:     PORT=3005
3. Config file:     config.yaml (server.port: 3005)
4. CLI config:      ~/.spectify/config.json (ports.standalone: 3005)
5. Default:         3003 (standalone), 3004 (companion)
```

**Note**: Embedded mode uses built-in port assignment (internal only) and ignores all configuration sources.

**MCP OpenAPI Analyzer**:
```
1. CLI argument:    --upload-port=3012 --mcp-port=3011
2. Environment:     UPLOAD_PORT=3012 MCP_PORT=3011
3. Config file:     config.yaml (uploadPort: 3012, mcpPort: 3011)
4. Defaults:        3002 (upload), 3001 (MCP)
```

### Multi-Instance Support

You can run multiple Spectify instances simultaneously:

```bash
# Standalone on default port
spectify start --mode standalone --port 3003

# Companion mode on different port (for different MCP)
spectify start --mode companion --port 3013
```

**CLI automatically tracks running instances**:
- Stores PIDs and ports in `~/.spectify/processes.json`
- `spectify status` shows all running instances
- `spectify stop --port 3013` stops specific instance

---

## CLI Client Modes

The `spectify` CLI client is **mode-aware** and can operate in three configurations:

### 1. Embedded Mode (Embedded Server)

**When to use**:
- One-off lint tasks
- CI/CD pipelines
- No server management desired

**Behavior**:
- CLI starts embedded server automatically
- Server runs in CLI process
- Server stops when CLI exits
- No external server required

**Commands**:
```bash
# Embedded mode is the default - just run commands directly
spectify lint <document-id> --ruleset pubhub
spectify health
spectify rulesets list

# No --mode flag needed, no server start needed
# Server automatically starts in-process and stops when done
```

**Server Startup**: Automatic (embedded in CLI)

**Note**: There is no `spectify start --mode embedded` - embedded mode starts automatically when you run any command without an external server available.

---

### 2. Standalone Client Mode

**When to use**:
- Connect to running standalone server
- Multiple users sharing one server
- Long-running server instance

**Behavior**:
- CLI connects to existing server (HTTP client)
- CLI does NOT start server
- Server must be running separately

**Commands**:
```bash
# Start server first (separate command)
spectify start --mode standalone

# Then use CLI as client
spectify lint <document-id> --ruleset pubhub --mode standalone

# Or set as default in config
spectify config set mode standalone
spectify lint <document-id> --ruleset pubhub  # Uses default mode
```

**Server Startup**: User must start separately (`spectify start --mode standalone`)

**Server URL Configuration**:
```bash
# Configure server URL if not on localhost:3003
spectify config set server.url http://my-server:3005

# Or use environment variable
export SPECTIFY_SERVER_URL=http://my-server:3005
spectify lint <document-id> --ruleset pubhub --mode standalone
```

---

### 3. Companion Client Mode

**When to use**:
- Working with MCP OpenAPI Analyzer
- Full document lifecycle (upload → lint → analyze)
- AI agent workflows

**Behavior**:
- CLI connects to Spectify server running as MCP companion
- CLI does NOT start server
- MCP manages documents, Spectify provides linting
- Documents referenced by IDs (uploaded to MCP)

**Commands**:
```bash
# Start both servers first
cd mcp-openapi-analysis
npm start  # Starts MCP on :3001/:3002

cd spectify
spectifyd  # Starts the orchestrator on :3003

# Use CLI as companion client
spectify lint <document-id> --ruleset pubhub --mode companion

# Or set as default
spectify config set mode companion
spectify lint <document-id> --ruleset pubhub
```

**Server Startup**: User must start both servers separately (or use launch script)

**Workflow**:
```bash
# 1. Upload document to MCP
curl -X POST http://localhost:3002/upload \
  -F "file=@openapi.yaml" \
  -H "X-API-Name: My API"
# Returns: {"documentId": "abc-123"}

# 2. Lint via the orchestrator CLI (companion mode)
spectify lint abc-123 --ruleset pubhub --mode companion

# 3. Check status
spectify status abc-123 --mode companion

# 4. Get results
spectify results abc-123 --mode companion
```

---

## Configuration Summary

### Spectify Configuration

**CLI Config** (`~/.spectify/config.json`):

**Note**: This config file is used only for **standalone** and **companion** modes. Embedded mode does NOT read this file and uses built-in defaults only.

```json
{
  "defaultMode": "embedded",
  "ports": {
    "standalone": 3003,
    "companion": 3004
  },
  "server": {
    "standalone": {
      "url": "http://localhost:3003"
    },
    "companion": {
      "url": "http://localhost:3004"
    }
  }
}
```

**Server Config** (`config.yaml`):
```yaml
server:
  port: 3003
  host: 0.0.0.0

documentStore:
  type: local
  baseDir: ./uploads
  fallbackHttp: http://localhost:3002  # MCP upload API

workerPool:
  totalMaxWorkers: 15

storage:
  type: memory  # or redis
```

### MCP OpenAPI Analyzer Configuration

**Config** (`config.yaml`):
```yaml
uploadPort: 3002
mcpPort: 3001

datastoreDir: ./datastore
datastoreQuotaGB: 10

spectify:
  enabled: true
  baseUrl: http://localhost:3004  # ⬅️ Companion mode uses port 3004
  gracefulDegradation: true
  retryInterval: 30000
```

---

## Running All Modes Simultaneously

**Use Case:** You want to test or use multiple deployment modes at the same time - for example, using embedded mode for local development while also running a standalone server for team use and a companion server integrated with MCP.

### Port Allocation for Concurrent Operation

| Mode | Port | Binds Externally? | Conflicts? |
|------|------|-------------------|-----------|
| **Light (Embedded)** | 3003 | ❌ No (internal only) | ✅ No conflicts |
| **Standalone** | 3003 | ✅ Yes | ❌ Would conflict with companion if same port |
| **Companion** | 3004 | ✅ Yes | ✅ No conflicts (different port) |

### Setup Example

```bash
# Terminal 1: Run embedded mode for quick local testing
# (Uses embedded server, no external port binding)
spectify lint ./my-api.yaml --ruleset pubhub

# Terminal 2: Run standalone server for team use
# (Binds to external port 3003)
spectify start --mode standalone --port 3003 --daemon

# Terminal 3: Run MCP + Companion for AI agents
# (MCP on 3001/3002, the orchestrator companion on 3004)
cd mcp-openapi-analysis && npm start &
cd spectify && spectify start --mode companion --port 3004 --daemon

# Now you can use all three simultaneously!
# - Embedded mode CLI: spectify lint local-file.yaml
# - Standalone HTTP: curl http://localhost:3003/health
# - Companion HTTP: curl http://localhost:3004/health
# - MCP tools: AI agents use MCP on :3001
```

### Configuration for Concurrent Operation

**Spectify CLI Config** (`~/.spectify/config.json`):

**Note**: Embedded mode doesn't use this config file. This is only for standalone/companion modes.

```json
{
  "defaultMode": "embedded",
  "ports": {
    "standalone": 3003,
    "companion": 3004
  },
  "server": {
    "standalone": {
      "url": "http://localhost:3003"
    },
    "companion": {
      "url": "http://localhost:3004"
    }
  }
}
```

**MCP Config** (`mcp-openapi-analysis/config.yaml`):
```yaml
spectify:
  enabled: true
  baseUrl: http://localhost:3004  # Companion mode port
```

### Why This Works

1. **Embedded Mode**: Runs in-process, doesn't bind to external port
   - ✅ No port conflict possible
   
2. **Standalone Mode**: Binds to port 3003
   - ✅ No conflict with embedded mode (internal only)
   - ✅ No conflict with companion (different port)
   
3. **Companion Mode**: Binds to port 3004
   - ✅ No conflict with embedded mode (internal only)
   - ✅ No conflict with standalone (different port)

---

## Decision: When Should Spectify Start the Server?

### Current Behavior

| Mode | CLI Starts Server? | Notes |
|------|-------------------|-------|
| **Light** | ✅ Yes | Embedded in CLI process |
| **Standalone** | ❌ No | User must start separately |
| **Companion** | ❌ No | User must start separately |

### Rationale

**Embedded Mode**: 
- Zero-config experience
- CLI controls lifecycle
- Server lifetime = CLI command lifetime

**Standalone Mode**: 
- Long-running server (daemon)
- CLI is just a client
- Separating client from server gives clean lifecycle management
- User controls server start/stop independently

**Companion Mode**: 
- Two independent services (MCP + Spectify)
- Loose coupling enables resilience
- Each can restart without affecting the other
- MCP launch script can start both, but they remain independent processes

### Alternative Considered (Rejected)

**Auto-start server in standalone/companion modes**:
- ❌ Confusing: "Is there a server running or not?"
- ❌ Hidden state: Users don't know if they started a daemon
- ❌ Process management complexity: CLI would need to track background processes
- ❌ Port conflicts: Auto-start would fail silently if port is taken
- ✅ Current approach: Explicit start/stop gives users control

---

## Deployment Examples

### Development (Embedded Mode)

```bash
# Clone and build
git clone <spectify-repo>
cd spectify
npm install && npm run build && npm link

# Lint a document (zero config - server starts automatically)
spectify lint ./examples/petstore.yaml --ruleset pubhub

# That's it! No server to start, no configuration needed.
```

### Local Server (Standalone Mode)

```bash
# Start server
spectify start --mode standalone --daemon

# Use CLI
spectify lint <document-id> --ruleset pubhub

# Check server status
spectify status

# Stop server
spectify stop
```

### Production (Standalone with Docker)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci && npm run build
EXPOSE 3003
CMD ["node", "build/index.js"]
```

```bash
docker run -p 3003:3003 -v ./uploads:/app/uploads spectify
```

### Integrated (Companion with MCP)

```bash
# Production: Both as system services
sudo systemctl start mcp-openapi-analyzer
sudo systemctl start spectify

# Development: Launch script
cd mcp-openapi-analysis
./scripts/start-with-spectify.sh
```

**Launch Script** (`mcp-openapi-analysis/scripts/start-with-spectify.sh`):
```bash
#!/bin/bash

# Start the orchestrator in background
cd ../spectify
npm start > logs/spectify.log 2>&1 &
SPECTIFY_PID=$!

# Start MCP (foreground)
cd ../mcp-openapi-analysis
npm start

# Cleanup on exit
trap "kill $SPECTIFY_PID" EXIT
```

---

## Migration Path

### For Existing Users

**If you were using Spectify standalone**:
- No changes needed
- Default mode is still `light` (zero config)
- Existing commands work as before

**If you want to use with MCP**:
1. Start MCP server: `cd mcp-openapi-analysis && npm start`
2. Start Spectify: `spectify start --mode companion`
3. Set default mode: `spectify config set mode companion`
4. Upload documents to MCP, lint via Spectify

### For New Users

**Recommended flow**:
1. Start with embedded mode (zero config)
2. Graduate to standalone mode when you need persistence
3. Add MCP integration when you need document management

---

## Summary

### Deployment Modes

| Mode | Server Lifecycle | Port | Document Storage | Use Case |
|------|------------------|------|------------------|----------|
| **Embedded** | Embedded in CLI | 3003 (internal) | In-memory | Quick tasks, CI/CD |
| **Standalone** | Independent daemon | 3003 | User-managed | Long-running, multi-user |
| **Companion** | Independent daemon | 3004 | MCP-managed | Integrated with MCP |

### Port Strategy

| Service | Port | Rationale |
|---------|------|-----------|
| MCP Server | 3001 | Front door for AI agents |
| MCP Upload API | 3002 | Document management |
| Spectify Standalone | 3003 | Backend linting service (independent) |
| Spectify Companion | 3004 | Backend linting service (with MCP) |

### CLI Behavior

| Mode | CLI Starts Server? | Server Required? |
|------|-------------------|------------------|
| Embedded | ✅ Yes (embedded) | No (auto-started) |
| Standalone | ❌ No | Yes (must be running) |
| Companion | ❌ No | Yes (must be running) |

### Key Principles

1. **Zero-config default**: Embedded mode works out-of-the-box
2. **Explicit server management**: Standalone/companion modes require explicit start/stop
3. **Sequential port numbering**: 3001 (MCP) → 3002 (Upload) → 3003 (Spectify)
4. **Independent processes**: Loose coupling enables resilience and scaling
5. **Graceful degradation**: MCP works without Spectify (linting disabled)
6. **Mode-aware CLI**: Client automatically adapts to deployment mode

---

## Next Steps

### Documentation Updates Needed

1. **README.md**: Add deployment modes overview
2. **QUICK_START.md**: Clarify mode differences
3. **INSTALLATION_GUIDE.md**: Add mode-specific setup
4. **MCP_INTEGRATION.md**: Consolidate companion mode docs

### Configuration Improvements

1. **Spectify**: Add `mode` to server config (auto-detect MCP presence)
2. **MCP**: Add `spectify.autoStart` option (optional child process spawning)
3. **CLI**: Improve mode detection (auto-detect running servers)

### Future Enhancements

1. **Auto-discovery**: CLI auto-detects MCP/standalone servers on default ports
2. **Health checks**: CLI verifies server availability before submitting requests
3. **Service mesh**: Enable multiple Spectify instances behind load balancer
4. **Cloud deployment**: Kubernetes manifests for production deployment

---

## Questions?

For more details:
- **Spectify Architecture**: [spectify/AGENTS.md](../AGENTS.md)
- **MCP Integration**: [SPECTIFY_MCP_INTEGRATION_ARCHITECTURE.md](./SPECTIFY_MCP_INTEGRATION_ARCHITECTURE.md)
- **CLI Usage**: [QUICK_START_CLI.md](./QUICK_START_CLI.md)
- **API Usage**: [QUICK_START_API.md](./QUICK_START_API.md)
