# Runtime Session ID (Minimal Session Tracking)

**Status**: ✅ **RECOMMENDED** - Pragmatic solution  
**Version**: 1.0  
**Date**: 2025-12-22  
**Target**: Server v0.7.0, CLI v0.8.0  

---

## Philosophy: Minimal, Not Zero

This is the **pragmatic middle ground** between:
- ❌ Complex execution session tracking (rejected - over-engineering)
- ❌ No session tracking (current - confusing errors)
- ✅ **Minimal runtime session ID** (this proposal - just enough)

**Key principles:**
1. **Add just enough state** to solve the stale history problem, nothing more
2. **One server at a time** - History tracks only the currently configured server
3. **Lightweight design** - No multi-server history management, no server switching memory
4. **Simple reset** - Changing CLI configuration = fresh start

---

## Problem Statement

**Current behavior causes confusion:**

```bash
# User uploads and lints
$ spectify lint api.yaml
✓ Job completed: job-123

$ spectify history
job-123  api.yaml  pubhub  completed

# Server restarts (or user switches servers)
$ spectify results job-123
Error: Job not found (404)
# User is confused - history shows it exists!

# Manual cleanup required
$ spectify history --clear
```

**Root cause:** CLI doesn't know when server state changes.

---

## Proposed Solution: Runtime Session ID

### Server Changes (Minimal)

**On startup, generate a random session ID:**

```typescript
// src/server.ts
class SpectifyServer {
  private readonly runtimeSessionId: string;
  
  constructor() {
    // Generate once at startup, never changes until restart
    this.runtimeSessionId = crypto.randomUUID();
    logger.info('Server started', { runtimeSessionId: this.runtimeSessionId });
  }
  
  // Include in all API responses
  addSessionHeaders(response: Response): void {
    response.header('X-Spectify-Session-Id', this.runtimeSessionId);
  }
}
```

**Update all API responses to include session ID:**

```typescript
// Before
{
  "jobId": "job-123",
  "status": "completed",
  ...
}

// After
{
  "jobId": "job-123",
  "status": "completed",
  "session": {
    "id": "abc-def-123",              // Runtime session ID
    "server_version": "0.6.1"
  },
  ...
}
```

**Alternative: HTTP Header (lighter)**

```typescript
// Include in response headers only, not body
Response Headers:
  X-Spectify-Session-Id: abc-def-123
  X-Spectify-Version: 0.6.1
```

### CLI Changes (Minimal)

**Track server URL + session ID:**

```typescript
// src/cli/history.ts
interface HistoryEntry {
  jobId: string;
  documentPath: string;
  rulesetName: string;
  timestamp: string;
  status: 'completed' | 'failed';
  
  // NEW: Minimal session tracking
  serverUrl: string;        // "http://localhost:3003"
  sessionId: string;        // Server's runtime session ID
}

interface HistoryMetadata {
  // NEW: Track last known session
  lastServerUrl: string;
  lastSessionId: string;
}
```

**Auto-clear history when session changes:**

```typescript
class HistoryManager {
  async addEntry(entry: HistoryEntry): Promise<void> {
    const metadata = this.loadMetadata();
    
    // Check if server or session changed
    if (
      entry.serverUrl !== metadata.lastServerUrl ||
      entry.sessionId !== metadata.lastSessionId
    ) {
      // Server changed or restarted - clear stale history
      logger.debug('Session changed, clearing history', {
        old: { url: metadata.lastServerUrl, session: metadata.lastSessionId },
        new: { url: entry.serverUrl, session: entry.sessionId }
      });
      
      this.clearHistory();
      
      // Update metadata
      metadata.lastServerUrl = entry.serverUrl;
      metadata.lastSessionId = entry.sessionId;
      this.saveMetadata(metadata);
    }
    
    // Add new entry
    this.appendEntry(entry);
  }
  
  async getHistory(): Promise<HistoryEntry[]> {
    // Simple: just return history
    // Auto-cleared when session changes via addEntry()
    return this.loadHistory();
  }
}
```

**User Experience:**

```bash
# Normal workflow
$ spectify lint api.yaml
✓ Job completed: job-123

$ spectify history
job-123  api.yaml  pubhub  1m ago

# Server restarts
$ spectify lint another.yaml
✓ Job completed: job-456
Note: History cleared (server restarted)

$ spectify history
job-456  another.yaml  pubhub  just now
# Old entries auto-cleared, no confusion!

# Change CLI configuration (switch servers)
$ spectify config set server http://prod:3003
Note: History cleared (server configuration changed)

$ spectify lint api.yaml
✓ Job completed: job-789

$ spectify history
job-789  api.yaml  pubhub  just now
# Fresh history for new server configuration!

# Switch back to local (fresh start again)
$ spectify config set server http://localhost:3003
Note: History cleared (server configuration changed)
# No memory of previous local history - lightweight design!
```

---

## Benefits Analysis

### ✅ What This Solves

1. **Automatic Cleanup**
   - No manual `spectify history --clear` needed
   - History always reflects current server state
   - Zero stale entries

2. **Clear User Feedback**
   - CLI notifies when history is cleared
   - Users understand why history changed
   - No confusing 404 errors

3. **Server Configuration Changes**
   - Changing server URL auto-clears history
   - No multi-server history tracking (by design)
   - Clean slate when switching environments
   - Lightweight: one configuration = one history

4. **Server Restart Detection**
   - Automatic detection without user intervention
   - No complex checksums or validation
   - Works reliably

### ✅ What This Doesn't Add (Good!)

1. **No Persistence Complexity**
   - Session ID is ephemeral (generated at startup)
   - No files to manage (no `execution-session.json`)
   - No checksums to calculate
   - No state synchronization

2. **No Database Creep**
   - No session history storage
   - No migration logic
   - No backup/restore concerns
   - No multi-tenancy issues

3. **No Validation Overhead**
   - No pinging server for each history entry
   - No status checks
   - No cleanup commands needed

4. **No Complex Logic**
   - Simple string comparison
   - Auto-clear on mismatch
   - Two fields added to history entries

---

## What Changed vs. Full Session Tracking

| Aspect | Full Design (Rejected) | Minimal Design (This) |
|--------|------------------------|----------------------|
| **Server State** | Persistent execution-session.json | Ephemeral UUID in memory |
| **Checksums** | Datastore content hash | None |
| **API Endpoints** | GET /session, POST /admin/reset | None (just header) |
| **CLI Validation** | Complex staleness checks | Simple string comparison |
| **Cleanup** | Manual + auto flags | Automatic only |
| **Files Added** | execution-session.json | None |
| **LOC** | ~500 lines | ~50 lines |
| **Complexity** | High | Minimal |

---

## Implementation Details

### Server Implementation (v0.7.0)

**File:** `src/server.ts`

```typescript
export class SpectifyServer {
  private readonly runtimeSessionId: string;
  
  constructor(config: ServerConfig) {
    // Generate session ID once at startup
    this.runtimeSessionId = crypto.randomUUID();
    logger.info('Spectify server starting', {
      version: this.getVersion(),
      runtimeSessionId: this.runtimeSessionId,
      port: config.port
    });
  }
  
  // Add session info to all responses
  private enrichResponse<T>(data: T): T & { session: SessionInfo } {
    return {
      ...data,
      session: {
        id: this.runtimeSessionId,
        server_version: this.getVersion()
      }
    };
  }
  
  // Apply to all API routes
  async handleLintRequest(req, reply) {
    const result = await this.orchestrator.submitJob(req.body);
    return this.enrichResponse(result);
  }
  
  async handleStatusRequest(req, reply) {
    const status = await this.orchestrator.getJobStatus(req.params.jobId);
    return this.enrichResponse(status);
  }
  
  // ... apply to all endpoints
}
```

**Alternative: Fastify Hook (cleaner)**

```typescript
// Add session header to all responses automatically
fastify.addHook('onSend', async (request, reply, payload) => {
  reply.header('X-Spectify-Session-Id', this.runtimeSessionId);
  reply.header('X-Spectify-Version', this.getVersion());
  return payload;
});
```

**Recommendation:** Use HTTP headers (lighter, no response body changes).

### CLI Implementation (v0.8.0)

**File:** `src/cli/history.ts`

```typescript
interface HistoryEntry {
  jobId: string;
  documentPath: string;
  rulesetName: string;
  timestamp: string;
  status: 'completed' | 'failed';
  serverUrl: string;
  sessionId: string;  // NEW
  summary?: LintSummary;
}

interface HistoryMetadata {
  version: string;
  lastServerUrl: string;    // Current server configuration
  lastSessionId: string;    // Current session ID
  // NOTE: No history per server - lightweight single-server design
}

export class HistoryManager {
  private historyFile = path.join(configDir, 'history.json');
  private metadataFile = path.join(configDir, 'history-metadata.json');
  
  async addEntry(
    job: LintJob,
    serverUrl: string,
    sessionId: string
  ): Promise<void> {
    const metadata = this.loadMetadata();
    
    // Check for server configuration or session change
    const serverChanged = serverUrl !== metadata.lastServerUrl;
    const sessionChanged = sessionId !== metadata.lastSessionId;
    
    if (serverChanged || sessionChanged) {
      // Clear history - fresh start
      await this.clearHistory();
      
      // Show notification (clear user feedback)
      if (serverChanged) {
        console.log(chalk.dim(`Note: History cleared (server configuration changed to ${serverUrl})`));
      } else {
        console.log(chalk.dim('Note: History cleared (server restarted)'));
      }
      
      // Update metadata (new server/session = new history)
      metadata.lastServerUrl = serverUrl;
      metadata.lastSessionId = sessionId;
      await this.saveMetadata(metadata);
    }
    
    // Add entry
    const entry: HistoryEntry = {
      jobId: job.jobId,
      documentPath: job.documentPath,
      rulesetName: job.rulesetName,
      timestamp: new Date().toISOString(),
      status: job.status,
      serverUrl,
      sessionId,
      summary: job.summary
    };
    
    await this.appendEntry(entry);
  }
  
  async getHistory(): Promise<HistoryEntry[]> {
    // Simple: just return current history for current server
    // Automatically cleaned when server config or session changes
    return this.loadHistory();
  }
  
  // Called when user explicitly changes CLI configuration
  async onConfigChange(newServerUrl: string): Promise<void> {
    const metadata = this.loadMetadata();
    
    if (newServerUrl !== metadata.lastServerUrl) {
      // Clear history immediately on config change
      await this.clearHistory();
      console.log(chalk.dim('Note: History cleared (server configuration changed)'));
      
      // Reset metadata (session will be captured on next API call)
      metadata.lastServerUrl = newServerUrl;
      metadata.lastSessionId = '';  // Unknown until first API call
      await this.saveMetadata(metadata);
    }
  }
  
  private async clearHistory(): Promise<void> {
    await fs.promises.writeFile(this.historyFile, JSON.stringify([], null, 2));
  }
  
  private loadMetadata(): HistoryMetadata {
    try {
      return JSON.parse(fs.readFileSync(this.metadataFile, 'utf-8'));
    } catch {
      return {
        version: '1.0',
        lastServerUrl: '',
        lastSessionId: ''
      };
    }
  }
  
  private async saveMetadata(metadata: HistoryMetadata): Promise<void> {
    await fs.promises.writeFile(
      this.metadataFile,
      JSON.stringify(metadata, null, 2)
    );
  }
}
```

**File:** `src/cli/client.ts`

```typescript
export class SpectifyClient {
  async submitLintJob(request: LintRequest): Promise<LintJobResponse> {
    const response = await fetch(`${this.baseUrl}/lint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    const data = await response.json();
    
    // Extract session ID from header or body
    const sessionId = response.headers.get('X-Spectify-Session-Id') ||
                      data.session?.id ||
                      'unknown';
    
    return { ...data, sessionId };
  }
  
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const response = await fetch(`${this.baseUrl}/lint/${jobId}`);
    const data = await response.json();
    
    const sessionId = response.headers.get('X-Spectify-Session-Id') ||
                      data.session?.id ||
                      'unknown';
    
    return { ...data, sessionId };
  }
}
```

**File:** `src/cli/commands/config.ts`

```typescript
// Config command implementation
export class ConfigCommand {
  async setServer(url: string): Promise<void> {
    // Validate URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('Server URL must start with http:// or https://');
    }
    
    // Load current config
    const config = this.loadConfig();
    const oldUrl = config.server?.url;
    
    // Update config
    config.server = { url };
    this.saveConfig(config);
    
    // Clear history if server changed (lightweight design)
    if (oldUrl && oldUrl !== url) {
      const historyManager = new HistoryManager();
      await historyManager.onConfigChange(url);
    }
    
    console.log(chalk.green(`✓ Server set to ${url}`));
  }
}
```

---

## Testing Strategy

### Server Tests

```typescript
// tests/server/session-id.test.ts
describe('Runtime Session ID', () => {
  it('should generate unique session ID on startup', async () => {
    const server1 = new SpectifyServer(config);
    const server2 = new SpectifyServer(config);
    
    expect(server1.runtimeSessionId).not.toBe(server2.runtimeSessionId);
  });
  
  it('should include session ID in response headers', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health'
    });
    
    expect(response.headers['x-spectify-session-id']).toBeDefined();
    expect(response.headers['x-spectify-session-id']).toMatch(/^[a-f0-9-]{36}$/);
  });
  
  it('should use same session ID across all requests', async () => {
    const response1 = await server.inject({ url: '/health' });
    const response2 = await server.inject({ url: '/rulesets' });
    
    expect(response1.headers['x-spectify-session-id'])
      .toBe(response2.headers['x-spectify-session-id']);
  });
});
```

### CLI Tests

```typescript
// tests/cli/history-session.test.ts
describe('History Session Management', () => {
  it('should clear history when session ID changes', async () => {
    const history = new HistoryManager();
    
    // Add entry with session-1
    await history.addEntry(job1, 'http://localhost:3003', 'session-1');
    expect(await history.getHistory()).toHaveLength(1);
    
    // Add entry with session-2 (simulating server restart)
    await history.addEntry(job2, 'http://localhost:3003', 'session-2');
    
    // Old entry should be cleared
    const entries = await history.getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0].sessionId).toBe('session-2');
  });
  
  it('should clear history when server URL changes', async () => {
    const history = new HistoryManager();
    
    await history.addEntry(job1, 'http://localhost:3003', 'session-1');
    await history.addEntry(job2, 'http://prod:3003', 'session-2');
    
    const entries = await history.getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0].serverUrl).toBe('http://prod:3003');
  });
  
  it('should NOT clear history for same server and session', async () => {
    const history = new HistoryManager();
    
    await history.addEntry(job1, 'http://localhost:3003', 'session-1');
    await history.addEntry(job2, 'http://localhost:3003', 'session-1');
    
    const entries = await history.getHistory();
    expect(entries).toHaveLength(2);
  });
});
```

### Integration Tests

```bash
# tests/integration/session-tracking.bats
@test "history clears on server restart" {
  # Start server
  spectifyd &
  SERVER_PID=$!
  sleep 2
  
  # Upload and check history
  spectify lint api.yaml
  run spectify history
  [ "$status" -eq 0 ]
  [[ "$output" =~ "api.yaml" ]]
  
  # Restart server
  kill $SERVER_PID
  spectifyd &
  sleep 2
  
  # History should be cleared on next operation
  spectify lint api2.yaml
  run spectify history
  [ "$status" -eq 0 ]
  [[ "$output" =~ "api2.yaml" ]]
  [[ ! "$output" =~ "api.yaml" ]]  # Old entry cleared
}

@test "history clears when CLI config changes" {
  # Start two servers
  spectifyd --port 3003 &
  SERVER1_PID=$!
  spectifyd --port 4003 &
  SERVER2_PID=$!
  sleep 2
  
  # Use first server
  spectify config set server http://localhost:3003
  spectify lint api.yaml
  run spectify history
  [[ "$output" =~ "api.yaml" ]]
  
  # Change CLI config to second server
  spectify config set server http://localhost:4003
  run spectify history
  [ "$status" -eq 0 ]
  [[ ! "$output" =~ "api.yaml" ]]  # History cleared immediately
  
  # Lint with second server
  spectify lint api2.yaml
  run spectify history
  [[ "$output" =~ "api2.yaml" ]]
  [[ ! "$output" =~ "api.yaml" ]]  # Still no first server history
  
  # Clean up
  kill $SERVER1_PID $SERVER2_PID
}

@test "history does not remember previous server config" {
  # Use server A
  spectify config set server http://localhost:3003
  spectify lint api1.yaml
  
  # Switch to server B
  spectify config set server http://localhost:4003
  spectify lint api2.yaml
  
  # Switch back to server A
  spectify config set server http://localhost:3003
  spectify lint api3.yaml
  
  # History should only show api3.yaml (fresh start)
  run spectify history
  [ "$status" -eq 0 ]
  [[ "$output" =~ "api3.yaml" ]]
  [[ ! "$output" =~ "api1.yaml" ]]  # No memory of previous A session
  [[ ! "$output" =~ "api2.yaml" ]]  # No memory of B
}
```

---

## Configuration

### Server Config (Optional)

```yaml
# config.yaml - OPTIONAL, generated automatically by default
server:
  # Session ID generated at runtime if not specified
  # Leave blank for automatic generation (recommended)
  runtime_session_id: ""  
  
  # Optional: Custom session ID for testing/development
  # runtime_session_id: "test-session-123"
```

### CLI Config (No changes needed)

```yaml
# ~/.spectify/config.yaml - no new config needed
server:
  url: http://localhost:3003
```

---

## Documentation Updates

### User Documentation

**README.md update:**

```markdown
## History Management

Spectify CLI automatically tracks your lint history. History is **automatically cleared** when:
- Server restarts (new session)
- You switch to a different server

This prevents confusion from stale job references.

```bash
$ spectify history
job-123  api.yaml  pubhub  5m ago

# Server restarts...

$ spectify lint api.yaml
Note: History cleared (server restarted)
```

### API Documentation

**API.md update:**

```markdown
### Response Headers

All API responses include:

```
X-Spectify-Session-Id: abc-def-123
X-Spectify-Version: 0.6.1
```

- **X-Spectify-Session-Id**: Unique identifier for server runtime session (changes on restart)
- **X-Spectify-Version**: Spectify server version

Use the session ID to detect server restarts.
```

---

## Migration Path

### Server Migration (v0.6.1 → v0.7.0)

**No breaking changes:**
- New header added to all responses
- Existing clients ignore unknown headers
- New CLI uses header, old CLI works fine

### CLI Migration (v0.7.0 → v0.8.0)

**Automatic migration:**
- On first run with v0.8.0, history metadata file created
- Session ID extracted from first API call
- Existing history entries preserved
- Future session changes handled automatically

**Migration code:**

```typescript
private loadMetadata(): HistoryMetadata {
  try {
    return JSON.parse(fs.readFileSync(this.metadataFile, 'utf-8'));
  } catch {
    // First run or old CLI - initialize
    return {
      version: '1.0',
      lastServerUrl: '',
      lastSessionId: ''  // Empty = accept any session on first run
    };
  }
}
```

---

## Rollout Plan

### Phase 1: Server Update (v0.7.0)

**Week 1:**
- [ ] Implement session ID generation
- [ ] Add response headers to all endpoints
- [ ] Write unit tests
- [ ] Update API documentation

**Week 2:**
- [ ] Integration testing
- [ ] Performance testing (verify no overhead)
- [ ] Release v0.7.0 server

### Phase 2: CLI Update (v0.8.0)

**Week 3:**
- [ ] Implement history metadata tracking
- [ ] Add auto-clear logic
- [ ] Add user notifications
- [ ] Write CLI tests

**Week 4:**
- [ ] Integration testing with v0.7.0 server
- [ ] Backward compatibility testing with v0.6.1 server
- [ ] Update user documentation
- [ ] Release v0.8.0 CLI

### Phase 3: Verification

**Week 5:**
- [ ] Monitor user feedback
- [ ] Verify no confusion about history clearing
- [ ] Check performance metrics
- [ ] Document any edge cases

---

## Edge Cases

### 1. Server Behind Load Balancer

**Problem:** Each server instance has different session ID

**Solution:** Don't use load balancer for Spectify (it's a local/team dev tool). If needed:
- Deploy single server instance per environment
- Or use sticky sessions in load balancer
- Spectify is designed for single-server usage per environment

### 2. Switching Between Multiple Servers

**Problem:** User works with dev/staging/prod servers

**Solution:** By design, history is NOT tracked per server:
- Changing server = fresh history
- Lightweight: no multi-server history database
- Use reports (--output) if you need to track across servers
- This is intentional simplicity

### 3. CLI Offline Usage

**Problem:** Can't reach server to get session ID

**Solution:** CLI stores last known session ID, uses it until server available

### 4. Rapid Server Restarts

**Problem:** Multiple restarts during development

**Solution:** Expected behavior - history clears each time, notifies user

### 5. Missing Session Header (Old Server)

**Problem:** CLI connects to old server without session header

**Solution:** 
```typescript
const sessionId = response.headers.get('X-Spectify-Session-Id') || 'legacy';
// Treat 'legacy' as permanent session (never clears)
```

### 6. User Wants Multi-Server History

**Problem:** User switches between dev/prod and wants to keep both histories

**Solution:** Use reports instead:
```bash
# Dev environment
spectify config set server http://localhost:3003
spectify lint api.yaml --output dev-report.json

# Prod environment  
spectify config set server http://prod:3003
spectify lint api.yaml --output prod-report.json

# Compare later
spectify diff dev-report.json prod-report.json
```

This aligns with Spectify's philosophy: ephemeral history, persistent reports.

---

## Comparison with Alternatives

### Alternative 1: No Session Tracking (Current)

**Pros:** Simple  
**Cons:** Confusing errors, manual cleanup

### Alternative 2: Full Execution Session Tracking (Rejected)

**Pros:** Most robust  
**Cons:** Over-engineered, database creep, complex

### Alternative 3: This Proposal (Runtime Session ID)

**Pros:**
- ✅ Automatic cleanup
- ✅ Minimal complexity
- ✅ No database creep
- ✅ Clear user experience

**Cons:**
- None significant

---

## Success Metrics

### Phase 1 (v0.7.0 Server)
- ✅ Session ID generated on every startup
- ✅ All responses include X-Spectify-Session-Id header
- ✅ Zero performance impact (< 1ms overhead)
- ✅ Tests pass

### Phase 2 (v0.8.0 CLI)
- ✅ History auto-clears on session change
- ✅ User notifications clear and helpful
- ✅ Zero false positives (history cleared unnecessarily)
- ✅ Backward compatible with v0.6.1 server

### Phase 3 (User Adoption)
- ✅ Zero user reports of stale history errors
- ✅ Positive feedback on auto-cleanup
- ✅ No performance complaints

---

## Open Questions

### 1. Response Header vs Body?

**Options:**
- A. Header only: `X-Spectify-Session-Id: abc-123`
- B. Body only: `{ "session": { "id": "abc-123" } }`
- C. Both (redundant)

**Recommendation:** Header only (A)
- Lighter weight
- No response body changes
- Standard practice (X-Request-Id, etc.)

### 2. Session ID Format?

**Options:**
- A. UUID v4: `abc-123-def-456`
- B. Short hash: `abc123def`
- C. Timestamp: `1703251234567`

**Recommendation:** UUID v4 (A)
- Standard, unique, collision-resistant
- Works with crypto.randomUUID()

### 3. User Notification Verbosity?

**Options:**
- A. Always show: "Note: History cleared (reason)"
- B. Only on first clear per session
- C. Flag to control: `--quiet`

**Recommendation:** Always show (A)
- Clear communication
- Not frequent enough to be annoying
- Can be suppressed with `--quiet` flag

---

## Decision

**✅ APPROVED for implementation**

This design strikes the perfect balance:
- Solves the stale history problem
- Minimal complexity (~ 50 LOC)
- No database creep
- Clear user experience
- No over-engineering

**Next steps:**
1. Implement server-side session ID (v0.7.0)
2. Implement CLI history management (v0.8.0)
3. Test and release

---

## Related Documents

- [EXECUTION_SESSION_TRACKING.md](EXECUTION_SESSION_TRACKING.md) - Full design (rejected as over-engineered)
- [CLI_REPORT_GENERATION.md](CLI_REPORT_GENERATION.md) - Report generation (approved)
- [CLI_DESIGN_SIMPLIFIED.md](CLI_DESIGN_SIMPLIFIED.md) - Overall CLI architecture
- [LINT_ORCHESTRATOR_DESIGN.md](LINT_ORCHESTRATOR_DESIGN.md) - Server architecture

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-12-22 | Runtime session ID approach | Minimal, pragmatic, solves problem |
| 2025-12-22 | Use HTTP header for session ID | Lighter than body modification |
| 2025-12-22 | Auto-clear history on session change | Zero user intervention needed |
| 2025-12-22 | No persistent session storage | Keep server stateless |
| 2025-12-22 | Single-server design (no multi-server history) | Lightweight philosophy - use reports for cross-server tracking |
| 2025-12-22 | CLI config change = history reset | Simple, clear behavior - no memory across config changes |

---

## Final Design Summary

### What Gets Built

**Server (v0.7.0) - 10 LOC:**
```typescript
// Generate UUID at startup
private readonly runtimeSessionId = crypto.randomUUID();

// Add header to all responses
fastify.addHook('onSend', (req, reply) => {
  reply.header('X-Spectify-Session-Id', this.runtimeSessionId);
});
```

**CLI (v0.8.0) - 50 LOC:**
```typescript
// Track (serverUrl, sessionId) in metadata
interface HistoryMetadata {
  lastServerUrl: string;
  lastSessionId: string;
}

// Auto-clear on change
if (url !== meta.lastServerUrl || session !== meta.lastSessionId) {
  clearHistory();
  notify(reason);
}

// Hook into config command
async setServer(url) {
  updateConfig(url);
  historyManager.onConfigChange(url);  // Clear immediately
}
```

### Behavior Summary

| Event | History Behavior | User Notification |
|-------|------------------|-------------------|
| Server restarts | Auto-cleared on next API call | "History cleared (server restarted)" |
| CLI config change (`spectify config set server`) | Auto-cleared immediately | "History cleared (server configuration changed)" |
| Switch back to previous server | Fresh history (no memory) | Same as config change |
| Normal lint operations | History accumulates | None |

### Design Principles Applied

✅ **Minimal state** - Just UUID in memory, no files  
✅ **Automatic cleanup** - No manual `--clear` needed  
✅ **Single-server design** - One config = one history at a time  
✅ **Clear notifications** - User always knows why history changed  
✅ **Use reports for persistence** - Cross-server tracking via `--output`  
✅ **Lightweight** - ~60 LOC total, zero complexity  

### What This Is NOT

❌ **NOT a multi-server history manager** - No per-server history tracking  
❌ **NOT persistent session storage** - UUID regenerated on restart  
❌ **NOT cross-session memory** - Switching servers = fresh start  
❌ **NOT a state database** - Zero files, zero persistence logic  

### Perfect For

✅ Local development workflows  
✅ Team servers (single environment at a time)  
✅ CI/CD (ephemeral by nature)  
✅ Quick checks and iterations  

### When Users Need More

→ **Use report generation** (`--output report.json`)  
→ Track results across servers via committed reports  
→ Compare environments via `spectify diff`  

This design keeps Spectify true to its identity: **lightweight, fast, focused on immediate feedback.**
