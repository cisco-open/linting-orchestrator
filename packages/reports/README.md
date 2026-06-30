# Linting Reporting Service (`spectifyr`)

> Package: `@cisco_open/linting-reports`
> Binary: `spectifyr`

The **linting reporting service** stores lint job results
produced by the [linting orchestrator](https://github.com/cisco-open/linting-orchestrator)
and exposes them through a browsable web UI. *Linting Reports* is the
user-facing label of this service; on the command line and in
configuration, it is named `spectifyr`.

## What is the linting reporting service?

The linting reporting service (`spectifyr`) is a standalone companion to
the linting orchestrator that provides:

- **Persistent Storage**: Job results survive orchestrator restarts
- **Web UI**: Browse and search lint results in your browser
- **Independent Operation**: Can be stopped/started without affecting the orchestrator
- **Production-Ready**: Never lose reports with local backup and retry logic

## Features

- ✅ HTTP API for receiving job notifications from the linting orchestrator
- ✅ SQLite database for persistent storage
- ✅ API key authentication (Bearer token)
- ✅ Job listing with filtering and pagination
- ✅ Detailed job results API
- ✅ Health check endpoint with version info
- ✅ **Web UI** - Browse reports in your browser (Phase 3)
- ✅ **Manual cleanup CLI** - Delete old reports (Phase 4)
- ✅ Reusable TypeScript client library with retry logic
- ✅ Runtime version compatibility checking
- ✅ Payload validation before sending
- 🚧 PostgreSQL support (future)
- 🚧 Charts and trends (future)

## Project Structure

This is a **monorepo** containing both the reports service server and a reusable TypeScript client library for integrating with it:

```
linting-reports/
├── src/
│   ├── server/               # spectifyr HTTP server
│   ├── client/               # Reusable TypeScript client library
│   │   └── CHANGELOG.md      # Detailed client library changelog
│   └── types.ts              # Shared TypeScript types
├── docs/
│   ├── SPECTIFYR_ARCHITECTURE.md
│   └── VERSIONING_STRATEGY.md
├── CHANGELOG.md              # Server changelog (references client)
├── package.json              # Dual versions (server + client)
└── README.md                 # This file
```

### Versioning & Changelogs

We use **dual versioning** to independently track server and client library versions:

- **Server Version**: `package.json` → `version` field (e.g., `0.2.2`)
  - Changes tracked in root **[CHANGELOG.md](CHANGELOG.md)**
  - Server-specific features (endpoints, database, health checks)

- **Client Library Version**: `package.json` → `clientVersion` field (e.g., `1.0.0`)
  - Changes tracked in **[src/client/CHANGELOG.md](src/client/CHANGELOG.md)**
  - Client API, configuration options, bug fixes

**Where to Find What:**
- **Server changes** → [CHANGELOG.md](CHANGELOG.md) (high-level summaries)
- **Client library changes** → [src/client/CHANGELOG.md](src/client/CHANGELOG.md) (detailed API docs)
- **Versioning rules** → [docs/internal/versioning-strategy.md](docs/internal/versioning-strategy.md)

This allows the server to evolve (adding endpoints, database changes) without forcing client library version bumps when the client API hasn't changed.

## Quick Start

### Development Mode (Recommended for Local Testing)

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start in development mode (no configuration needed)
npm run dev
```

Development mode runs with sensible defaults:
- ✅ Auto-generates API key (with warning)
- ✅ Local database: `./reports.db`
- ✅ Human-readable logs
- ✅ Port 3010

Access at `http://localhost:3010`

### Production Mode

**1. Create `.env` file:**

```bash
cp .env.example .env
```

**2. Edit `.env` and set your API key:**

```bash
# Required
SPECTIFYR_API_KEY=your-secure-production-key

# Optional (production defaults shown)
SPECTIFYR_PORT=3010
SPECTIFYR_HOST=0.0.0.0
SPECTIFYR_DB_PATH=~/.spectify/reports/database/reports.db
LOG_LEVEL=info
LOG_FORMAT=pretty  # or 'json' for structured logs
```

**3. Build and start:**

```bash
npm run build
npm start
```

Production mode validates all configuration and fails fast if misconfigured.

### Configuration via .env File (Recommended)

Create a `.env` file in the project root:

```bash
# .env - Report Service Configuration

# Required: API key for authentication
SPECTIFYR_API_KEY=your-secret-key-here

# Optional: Server configuration (defaults shown)
SPECTIFYR_PORT=3010
SPECTIFYR_HOST=0.0.0.0

# Optional: Database location
# Development default: ./reports.db
# Production default: ~/.spectify/reports/database/reports.db
SPECTIFYR_DB_PATH=~/.spectify/reports/database/reports.db

# Optional: Logging
LOG_LEVEL=info            # debug, info, warn, error
LOG_FORMAT=pretty         # 'pretty' (human-readable) or 'json' (structured)
```

### Environment Variables

Alternatively, use environment variables:

```bash
export SPECTIFYR_API_KEY=your-secret-key-here
export SPECTIFYR_PORT=3010
export SPECTIFYR_DB_PATH=~/.spectify/reports/database/reports.db
npm start
```

### Configure the linting orchestrator

In the orchestrator's configuration:

```yaml
# config.yaml
reportService:
  enabled: true
  url: 'http://localhost:3010'
  apiKey: ${SPECTIFYR_API_KEY}
  retries: 3
  pendingDir: './pending-reports'
```

Or with environment variables:

```bash
export SPECTIFYR_URL=http://localhost:3010
export SPECTIFYR_API_KEY=your-secret-key-here
```

## Usage

### Web UI

Navigate to `http://localhost:3010` in your browser to:
- View recent lint jobs
- Search by document name or organization
- Filter by status, ruleset, or date range
- View detailed results for each job
- See per-ruleset breakdown

### API

#### POST /reports/jobs
Receive job completion notification from the linting orchestrator (authenticated).

```bash
curl -X POST http://localhost:3010/reports/jobs \
  -H "Authorization: Bearer your-secret-key" \
  -H "Content-Type: application/json" \
  -d @job-notification.json
```

#### GET /jobs
List all jobs (paginated).

```bash
curl http://localhost:3010/jobs?limit=50&offset=0
```

#### GET /jobs/:jobId
Get detailed results for specific job.

```bash
curl http://localhost:3010/jobs/abc123
```

### Cleanup

Delete reports older than N days:

```bash
# Dry run (shows what would be deleted)
npm run cleanup -- --days 90 --dry-run

# Actually delete
npm run cleanup -- --days 90
```

## Architecture

The linting reporting service is designed as an independent companion to
the linting orchestrator:

```
┌──────────────────┐                  ┌──────────────────┐
│  spectifyd       │ ───────────────> │  spectifyr       │
│  (orchestrator)  │  HTTP POST       │  (reports)       │
│  port 3003       │  notifications   │  port 3010       │
└──────────────────┘  (fire-and-forget)        │
                                               │
                                               v
                                        ┌─────────────┐
                                        │   SQLite    │
                                        │  Database   │
                                        └─────────────┘
```

**Communication Pattern:**
- Fire-and-forget HTTP POST notifications
- 3 retry attempts with exponential backoff (1s, 2s, 4s)
- If all retries fail, the orchestrator stores the notification locally
- Background job retries pending notifications every 5 minutes
- **Never lose production reports**

## Deployment

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

### Docker Compose

See [examples/docker-compose.yml](examples/docker-compose.yml) for running
the linting orchestrator and the linting reporting service
together.

### Systemd

See [examples/spectifyr.service](examples/spectifyr.service) for systemd configuration.

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Development mode (auto-reload)
npm run dev

# Type checking
npm run typecheck
```

## Documentation

- [**Architecture**](docs/SPECTIFYR_ARCHITECTURE.md) - Complete design specification
- [**AGENTS.md**](AGENTS.md) - AI agent instructions

## Configuration Options

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3010` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_PATH` | `./reports.db` | SQLite database file |
| `SPECTIFYR_API_KEY` | *(required)* | API key for authentication |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `LOG_FORMAT` | `pretty` | Log format (`json` for JSON, anything else for human-readable) |

## License

See [LICENSE](LICENSE)

## Related Projects

- [spectify](https://github.com/cisco-open/linting-orchestrator) — the linting orchestrator (`spectifyd` daemon + `spectify` CLI)
- [linting-document-store](https://github.com/cisco-open/linting-document-store) — the document store
- [mcp-openapi-analysis](https://github.com/cisco-open/mcp-openapi-analysis) — MCP server for OpenAPI documents analysis

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

## Support

- Issues: [GitHub Issues](https://github.com/cisco-open/linting-reports/issues)
- Documentation: [docs/](docs/)
- Discussions: [spectify Discussions](https://github.com/cisco-open/linting-orchestrator/discussions)
