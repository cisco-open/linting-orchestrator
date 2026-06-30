# AGENTS.md

Instructions for AI coding agents working on the orchestrator.

---

## Project Overview

The **linting orchestrator** is an independent microservice that orchestrates linting of API specifications (OpenAPI, AsyncAPI, Arazzo) using Spectral and custom rule engines.

**Deployment Modes:**
- **Light Mode** (Embedded): CLI embeds server, zero-config, perfect for CI/CD
- **Standalone Mode**: Independent server process, long-running, multi-user
- **Companion Mode**: Runs alongside MCP OpenAPI Analyzer for integrated document lifecycle

📖 **[Complete Deployment Guide](docs/deployment-modes.md)** - Architecture, ports, and integration patterns

**Core Architecture:**
- **HTTP API Server** (port 3003) - Accepts lint requests, returns job IDs
- **Job Orchestrator** - Manages job lifecycle and task distribution
- **Worker Pool Manager** - Manages persistent worker threads with document affinity
- **Workers** - Each worker pre-loaded with specific ruleset + document caching
- **Storage Adapter** - Pluggable interface for result caching
- **Document Accessor** - Direct filesystem access to document store

**Key Principles:**
1. Worker-per-ruleset architecture (pre-loaded for performance)
2. Document affinity caching (workers cache documents)
3. Zero-copy architecture (file paths, not content)
4. Pluggable storage (memory, Redis, custom)
5. Versioned rulesets with defaults

---

## Quick Reference

### Documentation Structure

**User Documentation** → [docs/](docs/)
- [**Deployment Modes & Ports**](docs/DEPLOYMENT_MODES_AND_PORTS.md) ⭐ **OVERVIEW** - Complete deployment architecture
- [Port & Mode Quick Reference](docs/PORT_AND_MODE_QUICK_REF.md) - Visual quick reference
- [API Quick Start](docs/QUICK_START_API.md)
- [CLI Quick Start](docs/QUICK_START_CLI.md)
- [Ruleset Management](docs/RULESET_MANAGEMENT.md)
- [MCP Integration](docs/SPECTIFY_MCP_INTEGRATION_ARCHITECTURE.md)
- [See all](docs/README.md)

**Design & Architecture** → [docs/design/](docs/design/)
- [Lint Orchestrator Design](docs/design/LINT_ORCHESTRATOR_DESIGN.md) ⭐⭐⭐
- [Architecture Decisions](docs/design/ARCHITECTURE_DECISIONS.md)
- [CLI Design](docs/design/CLI_DESIGN_SIMPLIFIED.md)
- [See all](docs/design/README.md)

**Implementation** → [docs/build/](docs/build/)
- [Implementation Status](docs/build/IMPLEMENTATION_STATUS.md)
- Phase documentation (PHASE_1 through PHASE_7)

### Setup Commands

**Choose installation method based on your role:**

| Method | Use Case | After Code Changes |
|--------|----------|-------------------|
| `npm link` | **Developers** (you!) | Just `npm run build` (or `npm run rebuild` for clean) |
| `npm install -g .` | Users/testers | Must reinstall |
| `npm install -g @cisco_open/linting-orchestrator` | End users | Update via npm |


**Build Scripts:**
| Script | What it does |
|--------|-------------|
| `npm run build` | TypeScript compile + chmod executables (spectify only) |
| `npm run build:all` | Builds document-store, spectify-reports, then spectify |
| `npm run rebuild` | Clean build directory + `build:all` (use after major changes) |

**Why npm link for development:**
- ✅ Changes take effect immediately after rebuild
- ✅ No need to reinstall after every code change
- ✅ Both `spectify` and `spectifyd` binaries available
- ✅ Perfect for testing Phase 1 deployment modes
- ✅ `build` script auto-applies `chmod 755` to executables

📖 **[Complete Installation Guide](docs/INSTALLATION_GUIDE.md)** - All methods, troubleshooting, and upgrade procedures

### Running the Server

```bash
# Start server (standalone mode)
npm start

# Development mode (auto-reload)
npm run dev
```

### Global Binaries

The orchestrator provides **two global binaries** (both installed automatically):

1. **`spectify`** - CLI with embedded server (light mode)
   - Location: `build/cli/index.js`
   - Used for: Linting documents, checking status, managing history
   - Command: `spectify lint`, `spectify rulesets`, etc.

2. **`spectifyd`** - Standalone server
   - Location: `build/index.js`
   - Used for: Production deployments, dedicated server instances
   - Command: `spectifyd` or `npm start`

Both are defined in `package.json` under `bin` and work with all installation methods (`npm link`, `npm install -g .`, or `npm install -g @cisco_open/linting-orchestrator`).

### Testing

```bash
# All tests
npm test

# Server tests only (unit + e2e/loader/perf)
npm run test:server

# CLI tests only
npm run test:cli

# Specific suites
npm run test:unit
npm run test:integration
npm run test:integration:e2e
```

---

## External Dependencies

### Document Store (Workspace Package)

**Location**: `../document-store/` (workspace package `@cisco_open/linting-document-store`)  
**Import from**: `@cisco_open/linting-document-store`

```bash
# Workspace install handles linking; just rebuild after editing
npm run build --workspace=@cisco_open/linting-document-store
```

```typescript
// Import example
import { LocalDocumentStore } from '@cisco_open/linting-document-store';
```

### MCP OpenAPI Analyzer (Optional Integration)

Provides document storage in companion mode. The orchestrator can run standalone or integrate with MCP.

**Key Points:**
- MCP manages document uploads (port 3002)
- The orchestrator reads via filesystem (no HTTP during linting)
- Independent services with graceful degradation
- See [docs/SPECTIFY_MCP_INTEGRATION_ARCHITECTURE.md](docs/SPECTIFY_MCP_INTEGRATION_ARCHITECTURE.md)

---

# Override defaults with environment variables
PORT=4000 SPECTIFYD_DOCUMENT_STORE_DIR=/path/to/uploads npm start

# Advanced: Use custom config file
npm start -- --config examples/config.yaml
```

## Project Structure

```
/
├── src/                        # Source code
│   ├── index.ts                # Main entry point - HTTP server + orchestrator startup
│   ├── orchestrator.ts         # Core job orchestration logic
│   ├── worker-pool.ts          # Worker pool manager (lifecycle, scaling, affinity)
│   ├── worker.ts               # Worker thread implementation with document caching
│   ├── job-queue.ts            # Job queue management
│   ├── config.ts               # Configuration loader
│   ├── types.ts                # Complete TypeScript type definitions
│   ├── ruleset-loader.ts       # Ruleset loading and versioning
│   ├── document-accessor.ts    # Filesystem access to MCP document store
│   ├── mock-server.ts          # Mock implementation for testing
│   ├── engines/                # Rule execution engines
│   │   ├── base-engine.ts      # Abstract base class
│   │   ├── spectral-engine.ts  # Spectral integration
│   │   └── [future engines]    # LLM, custom rules (NOT_IMPLEMENTED)
│   └── storage/                # Storage implementations
│       ├── storage-adapter.ts  # Interface definition
│       ├── memory-storage.ts   # In-memory implementation
│       └── redis-storage.ts    # Redis implementation (PENDING)
│
├── rulesets/                   # Built-in minimal rulesets (shipped with service)
│   ├── config/
│   │   └── rulesets.yaml       # Ruleset registry
│   ├── sources/
│   │   └── example/
│   │       └── oas-recommended/
│   │           ├── v1.0.0/     # YAML-only, no npm deps
│   │           │   └── ruleset.yaml
│   │           └── v2.0.0/     # Default version
│   │               └── ruleset.yaml
│   └── CHANGELOG.md            # Rulesets-specific changelog
│                               # See ruleset-externalization.md for adding
│                               # team-specific rulesets via SPECTIFYD_RULESETS_DIR
│
├── examples/                   # Example configurations
│   └── config.yaml             # Complete config example (reference only)
│
├── docs/                       # Documentation
│   ├── AGENTS.md               # This file - AI agent instructions
│   ├── LINT_ORCHESTRATOR_DESIGN.md  # Complete design specification
│   ├── ARCHITECTURE_DECISIONS.md    # Key architectural decisions
│   └── API.md                  # HTTP API documentation (generated)
│
├── tests/                      # Test files
│   ├── unit/                   # Unit tests
│   ├── integration/            # Integration tests
│   └── fixtures/               # Test OpenAPI documents
│
├── mcp-openapi-analysis/       # MCP Server (cloned, not part of orchestrator)
│   └── uploads/                # Shared document storage (accessed via filesystem)
│
├── build/                      # Compiled JavaScript output (generated)
├── node_modules/               # Dependencies (generated)
├── package.json                # NPM package configuration (manual)
├── tsconfig.json               # TypeScript configuration (manual)
├── AGENTS.md                   # This file (root for discoverability)
└── README.md                   # Main project documentation (manual)
```

## Code Style & Conventions

### Implementation Velocity: PENDING vs NOT_IMPLEMENTED vs TODO

To move fast while maintaining code quality, use these markers:

```typescript
// TODO: Future enhancement, not required for production
// Example: Add webhook notifications when jobs complete
function notifyJobComplete(jobId: string) {
  // TODO: Implement webhook integration
}---

## Code Style & Conventions

### TypeScript Essentials
- **Strict Mode**: Enabled
- **Module System**: ES modules (`.js` extensions in imports required)
- **No `any`**: Use proper types or `unknown`

```typescript
// ✅ ESM imports require .js extension
import { WorkerPool } from './worker-pool.js';

// ✅ Naming conventions
const workerPool = new WorkerPoolManager();  // camelCase
class WorkerPoolManager {}  // PascalCase
const MAX_WORKERS = 10;  // UPPER_CASE
```

### Implementation Velocity Markers

```typescript
// TODO: Future enhancement, not required for production
// PENDING: Required for production, not yet implemented
// NOT_IMPLEMENTED: Designed but intentionally deferred
```

### Error Handling

```typescript
// ✅ Descriptive errors with context
if (!ruleset) {
  throw new Error(`Ruleset '${rulesetName}' version '${version}' not found`);
}
```

---

## Testing

```bash
# All tests
npm test

# Server tests (unit + e2e/loader/perf)
npm run test:server

# CLI tests
npm run test:cli

# Specific suites
npm run test:unit
npm run test:integration:e2e
```

---

## Common Pitfalls

### 1. Document Access Pattern

```typescript
// ✅ GOOD: Pass file paths (zero-copy)
workerPool.executeTask({
  documentPath: await accessor.getDocumentPath(documentId),
  documentId,
  rulesetName
});

// ❌ BAD: Pass document content (expensive copy)
workerPool.executeTask({
  documentContent: document,  // 50MB copied to worker!
  rulesetName
});
```

### 2. Worker Thread Message Passing

```typescript
// ✅ GOOD: Simple, serializable data
const message = {
  taskId: 'task-123',
  documentPath: '/path/to/doc.json',
  rulesetName: 'oas-recommended'
};

// ❌ BAD: Cannot transfer functions/regex/dates
const message = { callback: () => {}, regex: /test/ };
```

### 3. Async Initialization Order

```typescript
// ✅ CORRECT: Initialize before accepting requests
await rulesetLoader.initialize();
await workerPool.initialize();
const httpServer = createHttpServer(orchestrator);
await httpServer.listen({ port: 3003 });

// ❌ WRONG: HTTP server starts before workers ready
await httpServer.listen({ port: 3003 });
await workerPool.initialize();  // Too late!
```

### 4. Path Validation

```typescript
// ✅ GOOD: Validate document ID format (UUID v4)
function isValidDocumentId(id: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
}

// ❌ BAD: No validation (path traversal risk)
const path = join(uploadsDir, `${documentId}.json`);
```

---

## Environment Variables

```bash
# Most common
PORT=3003                     # Server port
SPECTIFYD_DOCUMENT_STORE_DIR=./uploads  # Document storage path

# Advanced (use config file for these)
SPECTIFYD_MAX_WORKERS_PER_RULESET=2
SPECTIFYD_TOTAL_MAX_WORKERS=15
SPECTIFYD_LOG_LEVEL=info
```

---

## Key Dependencies

- **@stoplight/spectral-core** - Spectral linting engine
- **fastify** - HTTP server
- **vitest** - Test framework
- **document-store** - Git submodule for storage adapters

---

## Common Build Tasks

### Add Storage Adapter

```typescript
// src/storage/redis-storage.ts
export class RedisLintStorage implements LintResultStorage {
  constructor(private redis: RedisClient) {}

  async storeJob(result: LintJobResult): Promise<void> {
    const key = `job:${result.jobId}`;
    await this.redis.set(key, JSON.stringify(result), 'EX', 86400);
  }

  // Implement all interface methods...
}
```

### Add API Endpoints

```typescript
// src/index.ts or src/api.ts
app.get('/rulesets/:name/stats', async (request, reply) => {
  const { name } = request.params;
  const stats = await rulesetLoader.getStats(name);
  return stats;
});
```

### 4. Rebuild and Test

```bash
npm run build       # Quick build (spectify only)
npm run build:all   # Full build (all subprojects + spectify)
npm run rebuild     # Clean + full build
npm run dev         # Development mode (auto-reload)
npm test            # Run tests
```

## Performance Considerations

### Worker Pool Sizing
- **Min Workers**: 1 per ruleset (e.g., 5-6 rulesets = 5-6 minimum workers)
- **Max Workers Per Ruleset**: 2 workers (scales based on load)
- **Total Max Workers**: 15 (global limit across all rulesets, laptop-friendly)
- **Scaling Threshold**: 10+ queued jobs for a ruleset triggers scale-up
- **CPU Cores**: Respect `os.cpus().length` for total workers
- **Note**: For dedicated servers with 16+ cores, increase `totalMaxWorkers` to 30

### Memory Management
- **Worker Isolation**: Each worker holds one ruleset + one cached document
- **Zero-Copy Architecture**: File paths passed, not document content
- **Document Caching**: Workers cache last document (LRU, 1 doc per worker)
- **Cache Limits**: 50MB max per worker, evict after 5 minutes idle
- **Storage**: In-memory storage grows with job count (use TTL or external storage)

### Execution Performance
- **Ruleset Pre-loading**: Rulesets loaded once at worker initialization (200-500ms saved)
- **Document Caching**: Document reused across multiple rulesets (10-200ms saved)
- **File Path References**: No document copy between threads (50-100ms saved)
- **Document Affinity**: Routes jobs to workers that already have document cached
- **Expected Throughput**: 100+ documents/minute with 15 workers (laptop), 200+ with 30 workers (server)
- **Cache Hit Performance**: 60% faster for large documents on cache hit

### Optimization Tips

```typescript
// ✅ Good - reuse workers
const worker = await pool.getWorkerForRule(rule);
await worker.execute(task);
// Worker remains ready for next task

// ❌ Bad - recreate workers
const worker = new Worker(rule);
await worker.execute(task);
await worker.terminate(); // Lose all loaded state!

// ✅ Good - batch result storage
const results = await Promise.all(tasks.map(t => execute(t)));
await storage.storeJob(aggregateResults(results));

// ❌ Bad - store each result individually
for (const task of tasks) {
  const result = await execute(task);
  await storage.storeJob(result); // Too many I/O calls
}
```

## Debugging Tips

### Enable Verbose Logging

```typescript
// config/default.yaml
logging:
  level: debug  # or trace for very verbose
  format: text  # easier to read than json
```

### Worker Thread Debugging

Worker threads run in separate contexts. Debug with messages:

```typescript
// In worker.ts
parentPort?.on('message', (msg) => {
  console.error('[Worker] Received:', msg); // Use stderr for debugging
  // Process message
});

// In worker-pool.ts
worker.postMessage(task);
console.error('[Pool] Sent task to worker:', task.taskId);
```

### Job Status Tracking

Add detailed logging to orchestrator:

```typescript
// src/orchestrator.ts
async submitJob(request: LintJobRequest): Promise<string> {
  const jobId = generateId();
  logger.info('Job submitted', { jobId, documentId: request.documentId });
  
  // ... create job
  
  logger.info('Job queued', { jobId, totalRules: job.tasks.length });
  return jobId;
}
```

### Test API Manually

```bash
# Submit job and capture job ID
JOB_ID=$(curl -s -X POST http://localhost:3003/lint \
  -H "Content-Type: application/json" \
  -d @test-request.json | jq -r '.jobId')

# Poll status
watch -n 1 "curl -s http://localhost:3003/lint/$JOB_ID | jq"

# Get results when complete
curl -s http://localhost:3003/lint/$JOB_ID/results | jq '.summary'
```

### Memory Leak Detection

```bash
# Run with --inspect for Node.js debugging
node --inspect build/index.js

# Connect Chrome DevTools to chrome://inspect
# Use Memory profiler to track heap usage over time
```

## Git Workflow

### Branch Strategy
- **main**: Stable production code
- **feature/feature-name**: New features
- **fix/bug-description**: Bug fixes
- **refactor/description**: Code refactoring

### Before Committing

```bash
npm run build             # Ensure TypeScript compiles
npm test                  # Run all tests
npm run lint              # Run linter (if configured)
git status                # Review changes
```

### Commit Message Format

```
<type>: <description>

<optional body>

<optional footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code restructuring
- `perf`: Performance improvement
- `test`: Test additions/changes
- `docs`: Documentation updates
- `chore`: Build, dependencies, etc.

**Examples:**
```
feat: add worker pool dynamic scaling

Implements auto-scaling of worker pool based on queue depth.
Workers scale from 4-10 based on load thresholds (80%/30%).

feat: support Redis storage adapter

fix: handle worker crash during rule execution

Previously, worker crashes caused job to hang. Now automatically
restarts failed workers and retries tasks up to configured limit.

refactor: extract worker lifecycle management

test: add integration tests for job orchestration

docs: update AGENTS.md with debugging tips
```

## Versioning and Changelog

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

### Component Versioning Strategy

The orchestrator has **two independently versioned components**:

- **Server** (API, orchestrator, worker pool): Primary version
- **CLI** (command-line interface): Independent version

**Package Version Format: `{server}-cli{cli}` (always)**

Examples:
- Server 0.6.1 + CLI 0.7.0 = `0.6.1-cli0.7.0`
- Server 0.7.0 + CLI 0.7.0 = `0.7.0-cli0.7.0`
- Server 0.7.0 + CLI 0.8.0 = `0.7.0-cli0.8.0`

**package.json structure:**
```json
{
  "version": "0.6.1-cli0.7.0",
  "spectify": {
    "components": {
      "server": "0.6.1",
      "cli": "0.7.0"
    }
  }
}
```

**When to update versions:**
- **Server changes only**: Bump server component and package version (e.g., 0.6.1-cli0.7.0 → 0.7.0-cli0.7.0)
- **CLI changes only**: Bump CLI component and package version (e.g., 0.6.1-cli0.7.0 → 0.6.1-cli0.8.0)
- **Both changed**: Update both components and package version (e.g., 0.6.1-cli0.7.0 → 0.8.0-cli0.8.0)

**Changelog files:**
- `CHANGELOG.md` - Server changes (version matches `spectify.components.server`)
- `src/cli/CHANGELOG.md` - CLI changes (version matches `spectify.components.cli`)

### When to Update Version and CHANGELOG

**ALWAYS update both `package.json` version and `CHANGELOG.md` when:**
1. Adding/removing/changing HTTP API endpoints
2. Changing API request/response formats
3. Adding new features (storage adapters, rule engines, etc.)
4. Fixing bugs that affect users
5. Making breaking changes to interfaces

### When to Update Rulesets Changelog

**Rulesets have their own changelog:** `rulesets/CHANGELOG.md`

**Update `rulesets/CHANGELOG.md` when:**
- Adding, removing, or renaming rulesets
- Updating ruleset versions
- Changing ruleset metadata (displayName, tags, description, etc.)
- Changing default ruleset versions
- Adding new ruleset sources

**When you update `rulesets/CHANGELOG.md`, ALSO add an entry to main `CHANGELOG.md`:**
```markdown
### Changed
- Updated ruleset configuration (see [rulesets/CHANGELOG.md](rulesets/CHANGELOG.md) for details)
```

This keeps the main changelog aware of ruleset changes while avoiding duplication.

### Version Number Selection

**Consult with maintainer before committing version changes.**

Provide:
1. **List of changes** (features, fixes, breaking changes)
2. **Suggested version number** with reasoning
3. **Backward compatibility analysis**

#### Semantic Versioning Rules

**MAJOR version (x.0.0) - Breaking changes:**
- Removing or renaming API endpoints
- Changing request/response structure incompatibly
- Changing configuration file format
- Removing storage adapter interface methods
- Changing worker pool behavior significantly

**Example MAJOR change:**
```
v0.2.0 → v1.0.0
- Changed: POST /lint now requires rulesetVersion (breaking!)
- Removed: GET /jobs endpoint (use /lint/:jobId instead)
```

**MINOR version (0.x.0) - New features (backward compatible):**
- Adding new API endpoints
- Adding optional request parameters
- Adding new storage adapter implementations
- Adding new rule engines
- Performance improvements

**Example MINOR change:**
```
v0.2.0 → v0.3.0
- Added: Redis storage adapter
- Added: GET /rulesets/:name/versions endpoint
```

**PATCH version (0.0.x) - Bug fixes:**
- Fixing bugs without changing API
- Documentation updates
- Internal refactoring
- Performance improvements without behavior change

**Example PATCH change:**
```
v0.2.0 → v0.2.1
- Fixed: Worker pool crash on invalid ruleset
- Fixed: Memory leak in result aggregation
```

### CHANGELOG.md Format

Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/):

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New HTTP endpoint `GET /rulesets/:name/stats`
- Redis storage adapter implementation
- Worker pool auto-scaling

### Changed
- Improved worker initialization performance (30% faster)

### Fixed
- Worker crash when Spectral rule fails
- Memory leak in job queue

### Breaking Changes
- Changed API response format for `/lint/:jobId/results`
  - Old: `{ issues: [...] }`
  - New: `{ results: [...], summary: {...} }`

### Migration Guide (0.2.0 → 1.0.0)
Update client code to use new response format:
\`\`\`typescript
// Before
const issues = response.issues;

// After
const issues = response.results;
const summary = response.summary;
\`\`\`
```

## Deployment Notes

### Running in Production

```bash
# Build
npm run build

# Start with production config
NODE_ENV=production npm start

# Or use process manager
pm2 start build/index.js --name lint-orchestrator

# With systemd
sudo systemctl start lint-orchestrator
```

### Configuration Management

Use environment-specific config files:

```
config/
├── default.yaml         # Default configuration
├── development.yaml     # Development overrides
├── production.yaml      # Production overrides
└── test.yaml           # Test configuration
```

### Health Checks

Monitor these endpoints:
- `GET /health` - Overall service health
- Worker pool status (active/idle/busy workers)
- Queue depth
- Storage connectivity

### Resource Requirements

**Minimum (development):**
- 2GB RAM
- 2 CPU cores
- 1GB disk space

**Recommended (production):**
- 4GB RAM (8GB with 10 workers)
- 4+ CPU cores
- 10GB disk space (for logs, temp files)

### Scaling Considerations

**Vertical Scaling:**
- Increase max workers (up to CPU core count)
- Increase memory for more concurrent jobs
- Faster CPU for faster rule execution

**Horizontal Scaling:**
- Run multiple orchestrator instances
- Use external storage (Redis) for shared state
- Load balance API requests
- Consider distributed worker pool (future)

## Security Considerations

**Current State (Development):**
- No authentication on HTTP API
- No rate limiting
- Results stored without encryption
- No audit logging

**For Production:**
- Add API key authentication
- Implement rate limiting per client
- Encrypt sensitive data at rest
- Add audit logging for all operations
- Validate and sanitize OpenAPI input
- Set resource limits (max document size, timeout)

## Related Documentation

- `docs/LINT_ORCHESTRATOR_DESIGN.md` - Complete design specification
- `docs/ARCHITECTURE.md` - Architecture deep dive
- `docs/API.md` - HTTP API reference
- `README.md` - User-facing documentation

## Questions?

This is agent-focused documentation. For human-readable docs, see README.md.

For Spectral documentation: https://stoplight.io/open-source/spectral  
For Node.js worker threads: https://nodejs.org/api/worker_threads.html
