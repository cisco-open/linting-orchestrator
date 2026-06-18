# AGENTS.md

Instructions for AI coding agents working on the linting reporting service.

---

## Project Overview

**Linting Reports** (binary: `spectifyr`, package:
`@cisco-open/linting-reports`) is the **linting reporting
service** — a standalone companion to the linting orchestrator
that provides persistent storage and web-based browsing of lint job
results.

**Core Architecture:**
- **HTTP API Server** (port 3010) — receives job notifications from the linting orchestrator
- **SQLite Database** — persistent storage for job results
- **Web UI** — server-side HTML for browsing reports
- **Notification Client** — fire-and-forget with retry + local backup
- **Background Retry Job** — retries failed notifications every 5 minutes

**Key Principles:**
1. Never lose production reports (local backup if notification fails)
2. Independent of the linting orchestrator (survives restarts)
3. Simple HTML templates (no build step)
4. SQLite first, PostgreSQL later
5. API key authentication (Bearer token)

---

## Quick Reference

### Documentation Structure

**Design** → [docs/](docs/)
- [**Architecture**](docs/SPECTIFYR_ARCHITECTURE.md) ⭐⭐⭐ **START HERE**

### Setup Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Development mode (auto-reload)
npm run dev

# Start server
npm start

# Run tests
npm test
```

### Environment Variables

```bash
# Required
SPECTIFYR_API_KEY=your-secret-key-here

# Optional
PORT=3010
DATABASE_PATH=./reports.db
LOG_LEVEL=info
```

---

## Project Structure

**This is a monorepo** containing both the Report Service server and a reusable TypeScript client library.

```
/
├── src/                        # Source code
│   ├── server/                 # Report Service HTTP server
│   │   ├── index.ts            # Main entry point - HTTP server startup
│   │   ├── server.ts           # Fastify HTTP server setup
│   │   ├── database.ts         # SQLite database adapter
│   │   ├── auth.ts             # API key authentication middleware
│   │   └── routes/             # HTTP route handlers
│   │       ├── reports.ts      # POST /reports/jobs
│   │       ├── jobs.ts         # GET /jobs, GET /jobs/:id
│   │       └── web.ts          # GET / (HTML views)
│   │
│   ├── client/                 # 📦 TypeScript client library
│   │   ├── index.ts            # ReportServiceClient class
│   │   ├── types.ts            # Client-specific types
│   │   └── CHANGELOG.md        # 📝 Client library changelog
│   │
│   ├── types.ts                # Shared TypeScript type definitions
│   └── cleanup/                # Cleanup utilities
│       └── cleanup.ts          # Manual cleanup CLI
│
├── schema/                     # Database schema
│   └── schema.sql              # SQLite schema definition
│
├── docs/                       # Documentation
│   ├── SPECTIFYR_ARCHITECTURE.md  # Complete design spec (→ docs/internal/architecture.md)
│   └── VERSIONING_STRATEGY.md          # Versioning rules (→ docs/internal/versioning-strategy.md)
│
├── tests/                      # Test files
│   ├── unit/                   # Unit tests (server + client)
│   │   ├── server.test.ts      # Server tests
│   │   └── client.test.ts      # Client library tests
│   └── integration/            # Integration tests
│       └── client.integration.test.ts
│
├── build/                      # Compiled JavaScript (generated)
├── node_modules/               # Dependencies (generated)
├── package.json                # NPM package configuration (dual versions)
├── tsconfig.json               # TypeScript configuration
├── CHANGELOG.md                # 📝 Server changelog (references client)
├── AGENTS.md                   # This file
└── README.md                   # User documentation
```

### Versioning & Changelog Organization

We use **dual versioning** to independently track server and client library versions:

**Server Version** (`package.json` → `version`):
- Current: `0.3.0`
- Changes tracked in **[CHANGELOG.md](CHANGELOG.md)** (root)
- Scope: Server endpoints, database schema, health checks, infrastructure, Web UI

**Client Library Version** (`package.json` → `clientVersion`):
- Current: `1.2.0`
- Changes tracked in **[src/client/CHANGELOG.md](src/client/CHANGELOG.md)**
- Scope: Client API methods, configuration options, bug fixes, examples

**Why Dual Versioning?**
- Server can add endpoints/features without forcing client version bumps
- Client API is stable (1.0.0) even as server evolves (0.2.x → 1.0.0)
- Clear separation of concerns for consumers

**Changelog Workflow:**

| Change Type | File to Update | Format |
|-------------|----------------|--------|
| Server endpoint added/changed | `CHANGELOG.md` | High-level summary |
| Database schema change | `CHANGELOG.md` | Migration notes |
| Health check enhancement | `CHANGELOG.md` | Feature description |
| Client API method added/changed | `src/client/CHANGELOG.md` | Full API docs with examples |
| Client config option added | `src/client/CHANGELOG.md` | Config details + usage |
| Client bug fix | `src/client/CHANGELOG.md` | Bug description + fix |
| Client performance improvement | `src/client/CHANGELOG.md` | Benchmark data |

**Example Flow:**
1. Add new endpoint `GET /jobs/:id/metadata` → Update `CHANGELOG.md` under "Added"
2. Client library needs `getJobMetadata()` method → Update `src/client/CHANGELOG.md` under "Added"
3. Bump `clientVersion` in `package.json` if client API changed
4. Bump `version` in `package.json` if server changed

**Version Bumping Rules:**
- See [docs/internal/versioning-strategy.md](docs/internal/versioning-strategy.md) for semver rules
- Client breaking change → bump `clientVersion` major (1.0.0 → 2.0.0)
- Server breaking change → bump `version` major when ready (0.x.x → 1.0.0)
- New features → bump minor version
- Bug fixes → bump patch version

---

## Code Style & Conventions

### TypeScript Essentials
- **Strict Mode**: Enabled
- **Module System**: ES modules (`.js` extensions in imports required)
- **No `any`**: Use proper types or `unknown`

```typescript
// ✅ ESM imports require .js extension
import { Database } from './database.js';

// ✅ Naming conventions
const database = new DatabaseAdapter();  // camelCase
class DatabaseAdapter {}  // PascalCase
const MAX_RETRIES = 3;  // UPPER_CASE
```

### Error Handling

```typescript
// ✅ Descriptive errors with context
if (!apiKey) {
  throw new Error('Missing SPECTIFYR_API_KEY environment variable');
}
```

---

## Testing

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Watch mode
npm run test:watch
```

---

## Common Tasks

### Add New Endpoint

```typescript
// src/routes/reports.ts
export async function reportsRoutes(app: FastifyInstance) {
  app.post('/reports/jobs', {
    preHandler: [authenticateApiKey],
    schema: {
      body: jobNotificationSchema
    }
  }, async (request, reply) => {
    const notification = request.body as JobNotification;
    await database.storeJob(notification);
    return { status: 'received' };
  });
}
```

### Add Database Migration

```typescript
// src/database.ts
async function migrate() {
  const version = await this.getSchemaVersion();
  if (version < 2) {
    await this.db.exec(`
      ALTER TABLE jobs ADD COLUMN new_field TEXT;
    `);
    await this.setSchemaVersion(2);
  }
}
```

---

## Deployment

### Standalone Server

```bash
# Set API key
export SPECTIFYR_API_KEY=your-secret-key

# Start server
npm start
```

### Docker

```bash
# Build image
docker build -t linting-reports:latest .

# Run container
docker run -d \
  -p 3010:3010 \
  -v $(pwd)/reports.db:/app/reports.db \
  -e SPECTIFYR_API_KEY=your-secret-key \
  linting-reports:latest
```

### With the linting orchestrator

```bash
# Terminal 1: Start the linting reporting service
cd linting-orchestrator/packages/reports
npm start

# Terminal 2: Start the linting orchestrator with reporting enabled
cd linting-orchestrator
export SPECTIFYR_URL=http://localhost:3010
export SPECTIFYR_API_KEY=your-secret-key
npm start
```

---

## Key Dependencies

- **fastify 5.1.0** - HTTP server (updated for security)
- **better-sqlite3 11.0.0** - SQLite database
- **handlebars 4.7.8** - HTML templating for Web UI
- **pino 10.3.0** - Logging (with pino-pretty for human-readable output)
- **semver 7.7.3** - Version compatibility checking
- **vitest 4.0.18** - Test framework

---

## Related Documentation

- [**Architecture**](docs/internal/architecture.md) - Complete design spec ⭐⭐⭐ **START HERE**
- [**Versioning Strategy**](docs/internal/versioning-strategy.md) - Semver rules, release process, compatibility matrix
- [**Client Library Changelog**](src/client/CHANGELOG.md) - Detailed client API changes and examples
- [**Server Changelog**](CHANGELOG.md) - Server-side changes and infrastructure updates
- [spectify](https://github.com/cisco-open/linting-orchestrator) — the linting orchestrator (`spectifyd` daemon + `spectify` CLI)
- [spectify MCP integration docs](https://github.com/cisco-open/linting-orchestrator/blob/main/docs/internal/integrations/spectify-mcp.md) — companion patterns

---

## Implementation Phases

**Phase 1: Foundation** (3-4 days) - ✅ COMPLETED
- ✅ Project structure
- ✅ TypeScript setup
- ✅ Fastify server
- ✅ SQLite database
- ✅ API key authentication
- ✅ POST /reports/jobs endpoint

**Phase 2: Client Library** (2 days) - ✅ COMPLETED
- ✅ Reusable TypeScript client
- ✅ Retry logic with exponential backoff
- ✅ Comprehensive test suite
- ✅ Version compatibility checking (v1.1.0)
- ✅ Payload validation (v1.2.0)

**Phase 3: Web UI** (4-5 days) - ✅ COMPLETED
- ✅ Handlebars templating setup
- ✅ Job listing page with filters and pagination
- ✅ Job details page with issue breakdown
- ✅ Search/filter controls
- ✅ Responsive CSS with colored badges

**Phase 4: Production Hardening** (2-3 days) - 🔄 IN PROGRESS
- ✅ Manual cleanup CLI tool
- ✅ Human-readable logging (pino-pretty)
- ⏳ Docker images
- ⏳ Deployment docs
- ⏳ Performance testing

---

## Questions?

This is agent-focused documentation. For user-facing docs, see README.md.

For linting orchestrator documentation: https://github.com/cisco-open/linting-orchestrator
