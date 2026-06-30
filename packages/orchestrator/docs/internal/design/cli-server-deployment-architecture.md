# CLI & Server Deployment Architecture

**Status:** Design  
**Date:** December 19, 2025  
**Version:** 1.0

## Executive Summary

This document defines the deployment architecture for Spectify CLI and Server, addressing the challenge that the CLI cannot reliably locate server source code when distributed via npm. We define three deployment modes and provide a migration path from the current development setup to production npm distribution.

---

## The Problem

**Current Issue:**
The CLI `start` command tries to locate server source files using relative paths:

```typescript
const projectRoot = path.resolve(__dirname, '../../../..');
const script = options.dev 
  ? path.join(projectRoot, 'src/index.ts')  // ❌ Doesn't exist in npm package
  : path.join(projectRoot, 'build/index.js');
```

**Why it breaks:**
- When installed via `npm install -g @cisco_open/linting-orchestrator`, files go to `/usr/local/lib/node_modules/spectify/`
- Only compiled `build/` directory is shipped (no source `src/`)
- The CLI binary location changes: `/usr/local/bin/spectify` → symlink to nested file
- Relative path calculations become unreliable
- `src/` directory doesn't exist in npm package

**Current Workaround:**
- Run from source directory only
- Use `npm link` for local development
- **NOT suitable for end-user distribution**

---

## Deployment Modes

### 🎯 Mode 1: **Embedded Mode** (Embedded Server)

**Target:** Developer laptops, CI/CD pipelines, quick testing

**Characteristics:**
- CLI embeds server code within same process
- No separate installation needed
- Auto-starts on first CLI command
- Lightweight configuration
- Local document storage (`~/.spectify/uploads/`)

**Architecture:**
```
┌─────────────────────────────────────┐
│   spectify (npm package)            │
│                                     │
│  ┌──────────┐      ┌─────────────┐ │
│  │   CLI    │─────▶│   Server    │ │
│  │ Commands │      │  (embedded) │ │
│  └──────────┘      └─────────────┘ │
│                           │         │
│                           ▼         │
│                    ~/.spectify/     │
│                      uploads/       │
└─────────────────────────────────────┘
```

**User Experience:**
```bash
# Install once
npm install -g @cisco_open/linting-orchestrator

# Just works - server starts automatically
spectify lint openapi.yaml
# → Embedded server auto-starts in background
# → Lints document
# → Server stays running for subsequent commands

# Check status
spectify health
# → Uses running embedded server
```

**Implementation:**
- Server code imported as ES module
- Runs in same Node.js process
- Can be backgrounded (daemon mode)
- Graceful shutdown on CLI exit

**Storage:**
- Default: `~/.spectify/uploads/`
- Configurable: `--document-store <path>`

---

### 🖥️ Mode 2: **Standalone Mode** (Dedicated Server)

**Target:** Production deployments, team servers, always-on services

**Characteristics:**
- Server runs as independent process
- Survives CLI disconnection
- Multiple CLIs can connect
- Full configuration options
- Managed via systemd/Docker/pm2

**Architecture:**
```
┌─────────────────┐          ┌──────────────────────┐
│   spectify CLI  │          │  spectifyd     │
│   (any machine) │          │  (dedicated server)  │
│                 │          │                      │
│  ┌──────────┐   │  HTTP    │  ┌────────────────┐ │
│  │   CLI    │───┼─────────▶│  │     Server     │ │
│  │ Commands │   │          │  │  (standalone)  │ │
│  └──────────┘   │          │  └────────────────┘ │
│                 │          │          │          │
└─────────────────┘          │          ▼          │
                             │   /var/spectify/    │
                             │     uploads/        │
                             └─────────────────────┘
```

**User Experience:**
```bash
# On server: Start dedicated server
spectifyd start --port 3003 --config /etc/spectify/config.yaml

# Or with Docker
docker run -d -p 3003:3003 spectifyd

# Or with systemd
systemctl start spectify

# On client: Connect to server
spectify lint openapi.yaml --server http://server.company.com:3003
```

**Implementation:**
- Separate binary: `spectifyd`
- Full orchestrator with worker pool
- Production-grade configuration
- Health monitoring, metrics
- Persistent storage options (Redis)

**Storage:**
- Default: `/var/spectify/uploads/`
- Configurable via config file
- Supports external storage adapters

---

### 🔗 Mode 3: **Companion Mode** (MCP Integration)

**Target:** DevNet PubHub, MCP-managed environments

**Characteristics:**
- Server started by MCP OpenAPI Analyzer
- Shares MCP's document store
- Integrated lifecycle management
- CLI connects to MCP-managed instance

**Architecture:**
```
┌─────────────────┐          ┌──────────────────────────┐
│   spectify CLI  │          │   MCP OpenAPI Analyzer   │
│                 │          │                          │
│  ┌──────────┐   │  HTTP    │  ┌──────────────────┐   │
│  │   CLI    │───┼─────────▶│  │   MCP Server     │   │
│  │ Commands │   │          │  │   (port 3002)    │   │
│  └──────────┘   │          │  └──────────────────┘   │
│                 │          │           │              │
└─────────────────┘          │           │ manages      │
                             │           ▼              │
                             │  ┌──────────────────┐   │
                             │  │  Spectify Server │   │
                             │  │   (port 3003)    │   │
                             │  └──────────────────┘   │
                             │           │              │
                             │           ▼              │
                             │  ./datastore/documents/  │
                             └──────────────────────────┘
```

**User Experience:**
```bash
# MCP starts Spectify automatically
cd mcp-openapi-analysis
./scripts/start-with-spectify.sh

# CLI auto-discovers MCP-managed Spectify
spectify lint openapi.yaml
# → Detects Spectify at localhost:3003
# → Uses MCP's document store

# Or explicit
spectify lint openapi.yaml --server http://localhost:3003
```

**Implementation:**
- MCP starts Spectify via `./scripts/start-with-spectify.sh`
- Spectify configured to use MCP's document store
- Graceful degradation if Spectify unavailable
- Lifecycle managed by MCP

**Storage:**
- MCP document store: `./mcp-openapi-analysis/datastore/documents/`
- Read-only access (MCP owns document lifecycle)

---

## Current State (Pre-NPM Deployment)

### What Works Today

**Development:**
```bash
# Clone repo
git clone <repo-url>
cd spectify

# Build
npm install
npm run build

# Run server directly
npm start

# Run CLI from source
node build/cli/index.js lint openapi.yaml --server http://localhost:3003
```

**Limitations:**
- ❌ Cannot `npm install -g @cisco_open/linting-orchestrator` (not published yet)
- ❌ CLI `start` command broken (path resolution issues)
- ❌ Must run from source directory
- ❌ No easy distribution to end users

### Interim Solution (Until NPM Deployment)

**Option A: Use `npm link` (Development)**
```bash
# In spectify directory
npm link

# Now globally available
spectify lint openapi.yaml
```

**Option B: Direct Node Invocation**
```bash
# Start server
node build/index.js &

# Use CLI
node build/cli/index.js lint openapi.yaml
```

**Option C: Shell Wrapper Script**
```bash
#!/bin/bash
# spectify-wrapper.sh
SPECTIFY_DIR="/path/to/spectify"
node "$SPECTIFY_DIR/build/cli/index.js" "$@"
```

**Option D: Docker (Recommended for current deployments)**
```dockerfile
FROM node:18
WORKDIR /app
COPY . .
RUN npm install && npm run build

# Expose both server and make CLI available
EXPOSE 3003
CMD ["node", "build/index.js"]
```

---

## Migration Path to NPM Deployment

### Phase 1: Fix Server Startup (Immediate - 2 days)

**Goal:** Make CLI work when installed via npm

**Changes:**

1. **Refactor server to be importable** (`src/server.ts`):
   ```typescript
   // src/server.ts (new file)
   export async function startServer(config: ServerConfig): Promise<void> {
     // Move all current index.ts code here
     const storage = new MemoryStorage();
     const rulesetLoader = new RulesetLoader(config.rulesets);
     const workerPool = new WorkerPoolManager(config.workerPool);
     const orchestrator = new Orchestrator(workerPool, storage, rulesetLoader);
     
     // Start HTTP server
     await startHttpServer(orchestrator, config);
   }
   ```

2. **Create server entrypoint** (`src/index.ts`):
   ```typescript
   // src/index.ts (modified)
   import { startServer } from './server.js';
   import { loadConfig } from './config.js';
   
   const config = await loadConfig();
   await startServer(config);
   ```

3. **Update CLI start command** (`src/cli/commands/start.ts`):
   ```typescript
   // Import server directly
   import { startServer } from '../../server.js';
   
   export async function startCommand(options: StartOptions) {
     // No more path resolution needed!
     const config = buildConfig(options);
     await startServer(config);
   }
   ```

4. **Update package.json**:
   ```json
   {
     "bin": {
       "spectify": "build/cli/index.js",
       "spectifyd": "build/index.js"
     },
     "files": [
       "build/",
       "rulesets/",
       "config/",
       "README.md"
     ]
   }
   ```

**Result:**
- ✅ CLI works when installed via npm
- ✅ Embedded mode functional
- ✅ Both `spectify` and `spectifyd` binaries available

---

### Phase 2: Auto-Discovery & Hybrid Mode (1 week)

**Goal:** Smart server detection and auto-start

**Features:**

1. **Server Auto-Discovery:**
   ```typescript
   async function discoverServer(): Promise<string | null> {
     // Try common endpoints
     const candidates = [
       'http://localhost:3003',  // Standalone
       'http://localhost:3002',  // MCP companion (fallback to 3003)
     ];
     
     for (const url of candidates) {
       try {
         const response = await fetch(`${url}/health`);
         if (response.ok) return url;
       } catch {}
     }
     
     return null;
   }
   ```

2. **Smart CLI Behavior:**
   ```typescript
   export async function lintCommand(file: string, options: LintOptions) {
     let apiUrl = options.server;
     
     if (!apiUrl) {
       apiUrl = await discoverServer();
     }
     
     if (!apiUrl) {
       // No server found - start embedded
       console.log('Starting embedded Spectify server...');
       await startEmbeddedServer({ port: 3003, mode: 'light' });
       apiUrl = 'http://localhost:3003';
     }
     
     // Continue with lint...
   }
   ```

3. **Daemon Process Management:**
   ```typescript
   // Track running servers
   interface ServerProcess {
     pid: number;
     port: number;
     mode: 'light' | 'standalone';
     startedAt: string;
   }
   
   // ~/.spectify/processes.json
   {
     "light": { "pid": 12345, "port": 3003, ... },
     "standalone": { "pid": 12346, "port": 3004, ... }
   }
   ```

**Result:**
- ✅ CLI "just works" - no manual server start needed
- ✅ Reuses existing servers when available
- ✅ Manages background processes cleanly

---

### Phase 3: NPM Publication (2 days)

**Goal:** Publish to npm registry

**Steps:**

1. **Pre-publish checklist:**
   - ✅ Version in package.json
   - ✅ CHANGELOG.md updated
   - ✅ README.md with installation instructions
   - ✅ LICENSE file present
   - ✅ `.npmignore` configured (exclude tests, src/)
   - ✅ `files` field in package.json

2. **Package.json configuration:**
   ```json
   {
     "name": "spectify",
     "version": "0.5.0",
     "description": "Quality Assurance for OpenAPI - CLI and orchestration server",
     "keywords": ["openapi", "linting", "spectral", "api"],
     "repository": {
       "type": "git",
       "url": "https://github.com/cisco-open/linting-orchestrator.git"
     },
     "files": [
       "build/",
       "rulesets/",
       "config/",
       "README.md",
       "LICENSE"
     ],
     "bin": {
       "spectify": "build/cli/index.js",
       "spectifyd": "build/index.js"
     }
   }
   ```

3. **Publish:**
   ```bash
   # Test package locally
   npm pack
   npm install -g ./spectify-0.5.0.tgz
   
   # Verify
   spectify --version
   spectify lint test.yaml
   
   # Publish to npm (or private registry)
   npm publish
   ```

4. **Post-publish verification:**
   ```bash
   # Fresh install test
   npm install -g @cisco_open/linting-orchestrator
   spectify --version
   spectify health
   ```

**Result:**
- ✅ Available via `npm install -g @cisco_open/linting-orchestrator`
- ✅ Works out-of-the-box
- ✅ Both CLI and server included

---

### Phase 4: Production Deployment Support (1 week)

**Goal:** Enterprise deployment options

**Deliverables:**

1. **Docker Image:**
   ```dockerfile
   FROM node:18-alpine
   RUN npm install -g @cisco_open/linting-orchestrator
   EXPOSE 3003
   CMD ["spectifyd", "--config", "/etc/spectify/config.yaml"]
   ```

2. **Systemd Service:**
   ```ini
   [Unit]
   Description=Spectify OpenAPI Linter
   After=network.target
   
   [Service]
   Type=simple
   User=spectify
   ExecStart=/usr/local/bin/spectifyd --config /etc/spectify/config.yaml
   Restart=on-failure
   
   [Install]
   WantedBy=multi-user.target
   ```

3. **Kubernetes Deployment:**
   ```yaml
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: spectify
   spec:
     replicas: 2
     template:
       spec:
         containers:
         - name: spectify
           image: spectify:latest
           ports:
           - containerPort: 3003
   ```

4. **Installation Script:**
   ```bash
   #!/bin/bash
   # install-spectify.sh
   
   echo "Installing Spectify..."
   npm install -g @cisco_open/linting-orchestrator
   
   # Create service user
   useradd -r -s /bin/false spectify
   
   # Setup directories
   mkdir -p /var/spectify/uploads /etc/spectify
   chown -R spectify:spectify /var/spectify
   
   # Install systemd service
   cp spectify.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable spectify
   systemctl start spectify
   
   echo "✅ Spectify installed and running"
   ```

**Result:**
- ✅ Production-ready deployments
- ✅ Multiple deployment options (Docker, systemd, k8s)
- ✅ Enterprise-grade installation

---

## Technical Implementation Details

### Embedded Server Architecture

```typescript
// src/server.ts - Refactored for both modes

export interface ServerConfig {
  port: number;
  host?: string;
  mode: 'light' | 'standalone' | 'companion';
  documentStore: {
    type: 'local' | 'mcp';
    directory: string;
  };
  workerPool?: WorkerPoolConfig;
  rulesets?: RulesetConfig;
}

export async function startServer(config: ServerConfig): Promise<ServerInstance> {
  // Common startup logic
  const storage = createStorage(config.mode);
  const rulesetLoader = new RulesetLoader(config.rulesets);
  await rulesetLoader.initialize();
  
  const workerPool = new WorkerPoolManager(config.workerPool);
  await workerPool.initialize();
  
  const orchestrator = new Orchestrator(workerPool, storage, rulesetLoader);
  
  // Start HTTP server
  const server = await createHttpServer(orchestrator, config);
  await server.listen({ port: config.port, host: config.host });
  
  return {
    server,
    orchestrator,
    shutdown: async () => {
      await server.close();
      await workerPool.shutdown();
    }
  };
}

// Embedded mode config
export function createLightModeConfig(): ServerConfig {
  return {
    port: 3003,
    mode: 'light',
    documentStore: {
      type: 'local',
      directory: path.join(os.homedir(), '.spectify', 'uploads')
    },
    workerPool: {
      minWorkersPerRuleset: 1,
      maxWorkersPerRuleset: 2,
      totalMaxWorkers: 10,  // Lighter footprint
    }
  };
}
```

### CLI Integration

```typescript
// src/cli/commands/start.ts - Fixed implementation

import { startServer, createLightModeConfig } from '../../server.js';

export async function startCommand(options: StartOptions): Promise<void> {
  const mode = options.mode || 'light';
  
  if (mode === 'light') {
    // Embedded mode
    const config = createLightModeConfig();
    
    if (options.port) config.port = options.port;
    if (options.documentStore) config.documentStore.directory = options.documentStore;
    
    const spinner = ora('Starting embedded Spectify server...').start();
    
    try {
      const instance = await startServer(config);
      spinner.succeed('Server started!');
      
      console.log(chalk.green(`\n✅ Spectify running in embedded mode`));
      console.log(chalk.dim(`   Port: ${config.port}`));
      console.log(chalk.dim(`   Document Store: ${config.documentStore.directory}\n`));
      
      // Keep process alive
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n\nShutting down...'));
        await instance.shutdown();
        process.exit(0);
      });
      
    } catch (error) {
      spinner.fail('Failed to start server');
      throw error;
    }
    
  } else {
    // Standalone mode - fork as separate process
    await startStandaloneServer(options);
  }
}
```

---

## Configuration Strategy

### Embedded Mode Configuration

**Minimal, opinionated defaults:**
```yaml
# Auto-generated ~/.spectify/config.yaml
mode: light
port: 3003
documentStore:
  type: local
  directory: ~/.spectify/uploads/
workerPool:
  minWorkersPerRuleset: 1
  maxWorkersPerRuleset: 2
  totalMaxWorkers: 10
storage:
  type: memory  # No persistence needed for embedded mode
logging:
  level: info
```

### Standalone Mode Configuration

**Full production config:**
```yaml
# /etc/spectify/config.yaml
mode: standalone
port: 3003
host: 0.0.0.0
documentStore:
  type: local
  directory: /var/spectify/uploads/
workerPool:
  minWorkersPerRuleset: 2
  maxWorkersPerRuleset: 5
  totalMaxWorkers: 30
storage:
  type: redis
  redis:
    url: redis://localhost:6379
    ttl: 86400
logging:
  level: info
  format: json
  file: /var/log/spectify/spectify.log
```

### Companion Mode Configuration

**MCP-integrated config:**
```yaml
# Managed by MCP
mode: companion
port: 3003
documentStore:
  type: mcp
  directory: ../mcp-openapi-analysis/datastore/documents/
workerPool:
  minWorkersPerRuleset: 1
  maxWorkersPerRuleset: 3
  totalMaxWorkers: 15
storage:
  type: memory  # MCP handles persistence
logging:
  level: debug  # More verbose for troubleshooting
```

---

## Testing Strategy

### Pre-NPM Testing (Current)

```bash
# Build
npm run build

# Test embedded server
node build/cli/index.js health
node build/cli/index.js lint test.yaml

# Test standalone server
node build/index.js &
sleep 2
node build/cli/index.js lint test.yaml --server http://localhost:3003
```

### Post-NPM Testing

```bash
# Pack locally
npm pack

# Install globally from tarball
npm install -g ./spectify-0.5.0.tgz

# Test all modes
spectify lint openapi.yaml  # Embedded mode
spectifyd &           # Standalone
spectify lint openapi.yaml --server http://localhost:3003
```

### Integration Tests

```typescript
// tests/integration/deployment.test.ts
describe('Deployment Modes', () => {
  test('embedded mode - embedded server', async () => {
    const { startServer } = await import('../../src/server.js');
    const instance = await startServer(createLightModeConfig());
    
    // Verify server running
    const response = await fetch('http://localhost:3003/health');
    expect(response.ok).toBe(true);
    
    await instance.shutdown();
  });
  
  test('standalone mode - separate process', async () => {
    const child = spawn('spectifyd', ['--port', '3004']);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const response = await fetch('http://localhost:3004/health');
    expect(response.ok).toBe(true);
    
    child.kill();
  });
});
```

---

## Rollout Plan

### Immediate Actions (This Week)

1. ✅ Create this architecture document
2. 🔨 Refactor `src/index.ts` → `src/server.ts`
3. 🔨 Fix CLI `start` command (remove path resolution)
4. 🔨 Test with `npm link`
5. 📝 Update AGENTS.md with new architecture

### Next Sprint (Next Week)

1. 🔨 Implement auto-discovery
2. 🔨 Add daemon process management
3. 🧪 Integration tests for all modes
4. 📝 Update CLI documentation

### Month 1

1. 📦 Prepare for npm publication
2. 🐳 Create Docker image
3. 📝 Write installation guides
4. 🧪 End-to-end testing

### Month 2

1. 🚀 Publish to npm
2. 🐳 Publish Docker image
3. 📋 Create systemd/k8s templates
4. 📖 Complete production deployment guide

---

## Decision Log

### Why Not Separate Packages?

**Considered:** `spectify-cli` and `spectifyd` as separate packages

**Rejected because:**
- Adds complexity (version management, peer dependencies)
- Worse user experience (two installations)
- Embedded mode wouldn't work (CLI needs server code)
- More prone to version mismatches

**Decision:** Single package with both CLI and server, multiple modes

### Why Not Server-First Design?

**Considered:** Require server installation first, CLI connects only

**Rejected because:**
- Poor developer experience (multi-step setup)
- CLI can't "just work" out of the box
- CI/CD pipelines need simple installation
- Unnecessary for 80% of use cases

**Decision:** Embedded server by default, dedicated server for production

### Why In-Process for Embedded Mode?

**Considered:** Always spawn separate server process

**Rejected because:**
- Slower startup (process fork overhead)
- More complex process management
- Harder to debug
- Wastes resources for single CLI command

**Decision:** Import server as ES module, run in same process

---

## Future Considerations

### Clustered Deployment

For very high load scenarios:

```
Load Balancer
     │
     ├──▶ Spectify Instance 1
     ├──▶ Spectify Instance 2
     └──▶ Spectify Instance 3
           │
           └──▶ Shared Redis (results cache)
```

**Implementation:**
- Multiple Spectify servers behind load balancer
- Shared Redis for result caching
- Sticky sessions or stateless design
- Health checks for automatic failover

### Worker Pool Scaling

**Current:** Fixed worker pool per instance  
**Future:** Dynamic scaling based on load

```typescript
interface ScalingConfig {
  autoScale: boolean;
  scaleUpThreshold: number;    // Queue depth
  scaleDownThreshold: number;  // Idle time
  scaleUpBy: number;           // Workers to add
  maxWorkers: number;          // Global limit
}
```

### Plugin System

**Current:** Fixed Spectral-based linting  
**Future:** Pluggable rule engines

```typescript
interface RuleEnginePlugin {
  name: string;
  version: string;
  executeRule(rule: RuleDefinition, document: any): Promise<RuleResult>;
}

// Register custom engines
orchestrator.registerEngine('llm-validator', new LLMRuleEngine());
orchestrator.registerEngine('custom-rules', new CustomRuleEngine());
```

---

## Appendix: Command Reference

### Embedded Mode (Default)

```bash
# Install
npm install -g @cisco_open/linting-orchestrator

# Use immediately (auto-starts embedded server)
spectify lint openapi.yaml

# Explicit start
spectify start --mode light

# Stop
spectify stop
```

### Standalone Mode

```bash
# Install
npm install -g @cisco_open/linting-orchestrator

# Start dedicated server
spectifyd start --config /etc/spectify/config.yaml

# Or direct
spectifyd

# Use CLI
spectify lint openapi.yaml --server http://localhost:3003

# Stop
spectifyd stop
```

### Companion Mode (MCP)

```bash
# MCP starts Spectify
cd mcp-openapi-analysis
./scripts/start-with-spectify.sh

# CLI auto-discovers
spectify lint openapi.yaml

# Or explicit
spectify lint openapi.yaml --server http://localhost:3003
```

---

## Questions & Answers

**Q: Can I run multiple modes simultaneously?**  
A: Yes, on different ports. E.g., embedded mode on 3003, standalone on 3004.

**Q: What happens if I kill the CLI while server is running?**  
A: Embedded mode (embedded): server stops. Standalone: server continues. Companion: managed by MCP.

**Q: Can I upgrade without downtime?**  
A: Standalone/Companion: yes (rolling update). Embedded mode: no (restart required).

**Q: Is embedded mode production-ready?**  
A: For single-user, low-load scenarios, yes. For team/production, use standalone.

**Q: How do I migrate from light to standalone?**  
A: Export documents from `~/.spectify/uploads/`, start standalone server, import documents.

---

## Related Documentation

- [Spectify-MCP Integration Architecture](../integrations/spectify-mcp.md)
- [Deployment Modes](../../deployment-modes.md)
- [AGENTS.md](../../../AGENTS.md) - AI agent instructions

---

**Document Status:** Ready for review  
**Next Review:** After Phase 1 implementation  
**Owners:** DevNet Team
