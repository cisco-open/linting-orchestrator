# Integration Tests

This directory contains integration tests that validate the entire the orchestrator system end-to-end.

## Test Structure

```
tests/integration/
├── deployment-modes.test.ts # Phase 1: Deployment architecture tests
├── loader-accessor.test.ts  # Ruleset and document store integration
├── e2e.test.ts              # End-to-end workflow tests (requires MCP)
├── performance.test.ts      # Performance benchmarks (requires MCP)
├── cli-config.test.ts       # CLI configuration tests (manual testing)
├── service-utils.ts         # Service lifecycle management
└── api-client.ts            # API client utilities
```

## Running Integration Tests

### Quick Start (Standard Tests)

**Tests that run without external dependencies:**

```bash
# Build first
npm run build

# Run all standard integration tests (no MCP needed)
npm run test:integration

# Runs: deployment-modes.test.ts, loader-accessor.test.ts
```

### MCP-Dependent Tests (Manual)

**Tests that require MCP OpenAPI Analyzer running:**

```bash
# 1. Start MCP server in a separate terminal
cd ../mcp-openapi-analysis
npm install && npm run build
npm start
# Wait for: "Upload API listening on http://localhost:3002"

# 2. Run MCP-dependent tests
npm run test:mcp

# Runs: e2e.test.ts, performance.test.ts
```

### Prerequisites for MCP Tests

1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Install ruleset dependencies:**
   ```bash
   npm run install-rulesets
   ```

3. **Start MCP OpenAPI Analyzer (external dependency):**
   ```bash
   # Clone if not already available
   cd .. # Go to parent directory
   git clone https://github.com/[org]/mcp-openapi-analysis
   cd mcp-openapi-analysis
   npm install && npm run build
   
   # Start MCP server
   npm start
   ```
   
   Wait for:
   ```
   MCP Server listening on http://localhost:3001/mcp
   Upload API listening on http://localhost:3002
   ```

4. **Ensure ports are available:**
   - Port 3001 (MCP server)
   - Port 3002 (MCP upload API)
   - Port 3003 (the orchestrator)

### Run All Integration Tests

```bash
npm run test:integration
```

### Run Specific Test Suites

```bash
# End-to-end tests only
npm run test:integration -- e2e

# Performance benchmarks only
npm run test:integration -- performance
```

### Debug Mode

Enable verbose logging to see service output:

```bash
DEBUG_SERVICES=1 npm run test:integration
```

## Test Coverage

### End-to-End Tests (`e2e.test.ts`)

**Complete Workflow:**
- Upload OpenAPI document to MCP server
- Submit lint job to the orchestrator
- Poll for job completion
- Retrieve and validate results
- Test with pubhub and contract rulesets
- Parallel job execution

**Cache Behavior:**
- Cache hit on re-submission
- Force run bypass
- Explicit cache invalidation

**Error Scenarios:**
- Non-existent documents
- Invalid ruleset names
- Malformed JSON
- Invalid OpenAPI documents

**Service Health:**
- Health check endpoints
- Ruleset listing
- Worker pool status

### Performance Tests (`performance.test.ts`)

**Latency Measurements:**
- Single job end-to-end latency
- Execution time vs overhead
- Target: <10 seconds for first run

**Cache Performance:**
- Cache miss latency
- Cache hit latency
- Speedup comparison
- Target: 50%+ speedup on cache hit

**Throughput:**
- Concurrent job processing
- Jobs per minute
- Average latency
- Target: 5+ jobs/min

**Worker Pool Scaling:**
- Initial worker count
- Scaling under load
- Worker utilization
- Idle state after completion

**Memory/Stability:**
- High-volume job processing (50+ jobs)
- Cache hit rate
- Failure rate
- Target: 0 failures

## Test Fixtures

### OpenAPI Documents

- `petstore.json` - Valid, comprehensive API
- `invalid-missing-fields.json` - Missing required OpenAPI fields
- `malformed.json` - Invalid JSON syntax

Add more test documents to `tests/fixtures/openapi-docs/`.

## Service Management

Integration tests automatically:
1. **Check if MCP server is running** (external dependency)
2. **Fail with helpful error** if MCP not running
3. Start the orchestrator (port 3003)
4. Wait for health checks
5. Run tests
6. Stop the orchestrator (MCP keeps running)

**Startup timeout:** 2 minutes (allows Spectral to load)  
**Test timeout:** Up to 5 minutes for performance tests

**Note:** MCP server is a separate service and must be started manually before running integration tests.

## Troubleshooting

### MCP server not running

If you see:
```
❌ MCP OpenAPI Analyzer not running on http://localhost:3002

Spectify integration tests require the MCP server (external dependency).

Start the MCP server with:
  cd mcp-openapi-analysis
  npm install && npm run build
  npm start
```

**Solution:**
```bash
# Clone MCP server if needed
cd .. # Go to parent directory
git clone https://github.com/[org]/mcp-openapi-analysis
cd mcp-openapi-analysis
npm install && npm run build

# Terminal 1: Start MCP server
npm start

# Terminal 2: Run integration tests
cd ../spectify
npm run test:integration
```

### Services fail to start

Check that ports are not in use:
```bash
lsof -i :3001
lsof -i :3003
```

Kill processes if needed:
```bash
kill -9 <PID>
```

### Tests timeout

Increase test timeout in specific test:
```typescript
it('should complete', async () => {
  // test
}, 120000); // 2 minute timeout
```

### Worker initialization slow

First test run loads Spectral rulesets (60s+). Subsequent tests reuse workers.

Enable debug mode to see progress:
```bash
DEBUG_SERVICES=1 npm run test:integration
```

### Results not found

Ensure services started successfully:
```bash
curl http://localhost:3001/health
curl http://localhost:3003/health
```

## CI/CD Integration

Add to `.github/workflows/test.yml`:

```yaml
integration-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
      with:
        node-version: '20'
    - run: npm ci
    - run: npm run build
    - run: npm run install:rulesets
    - run: npm run test:integration
      timeout-minutes: 10
```

## Performance Baselines

Expected performance on typical hardware (4 cores, 8GB RAM):

| Metric | Target | Typical |
|--------|--------|---------|
| Single job latency | <10s | 3-5s |
| Cache hit speedup | >50% | 60-80% |
| Throughput | >5 jobs/min | 10-15 jobs/min |
| Workers | 6-15 | ~8 |
| Cache hit rate | >50% | 70-90% |

Server-class hardware (16+ cores, 32GB RAM):
- Throughput: 30-50 jobs/min
- Workers: 20-30
- Latency: 1-3s

## Adding New Tests

### 1. Create test file

```typescript
// tests/integration/my-feature.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { /* utilities */ } from './service-utils.js';

describe('My Feature', () => {
  beforeAll(async () => {
    // Setup
  });

  afterAll(async () => {
    // Cleanup
  });

  it('should work', async () => {
    // Test
  });
});
```

### 2. Use helper utilities

```typescript
import { MCPClient, SpectifyClient } from './api-client.js';

const mcpClient = new MCPClient();
const spectifyClient = new SpectifyClient();

const documentId = await mcpClient.uploadDocument(doc);
const jobId = await spectifyClient.submitLintJob({ documentId, rulesetName: 'pubhub' });
const results = await spectifyClient.waitForJobComplete(jobId);
```

### 3. Add test fixtures

Place OpenAPI documents in `tests/fixtures/openapi-docs/`.

## Related Documentation

- `docs/PHASE_7_PRODUCTION_READINESS.md` - Unit test details
- `docs/PHASE_8_INTEGRATION_TESTING.md` - Integration test results
- `docs/LINT_ORCHESTRATOR_DESIGN.md` - System design
- `AGENTS.md` - Development guide
