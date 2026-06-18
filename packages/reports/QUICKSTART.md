# Linting Reports (`spectifyr`) — quick start

## Overview

The **linting reporting service** (`spectifyr`) is a standalone companion
to the linting orchestrator that provides persistent storage and
web-based browsing of lint job results.

## Prerequisites

- Node.js 18+ 
- npm or yarn

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and set your API key:

```bash
SPECTIFYR_API_KEY=your-secure-secret-key-here
```

### 3. Build the Project

```bash
npm run build
```

### 4. Start the Server

```bash
npm start
```

The service will start on `http://localhost:3010`

## Development Mode

For auto-reload during development:

```bash
npm run dev
```

## Verify Installation

Check the health endpoint:

```bash
curl http://localhost:3010/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-02-05T...",
  "server": {
    "version": "0.3.0",
    "environment": "development"
  },
  "clientLibrary": {
    "version": "1.2.0"
  },
  "database": {
    "connected": true,
    "totalJobs": 0
  }
}
```

## Testing the API

### Send a Test Job Notification

```bash
curl -X POST http://localhost:3010/reports/jobs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secure-secret-key-here" \
  -d '{
    "jobId": "test-123",
    "documentId": "doc-456",
    "status": "completed",
    "results": [{
      "rulesetName": "pubhub",
      "status": "completed",
      "issues": [],
      "summary": {
        "errorCount": 0,
        "warningCount": 0,
        "infoCount": 0,
        "hintCount": 0,
        "totalIssues": 0
      }
    }],
    "summary": {
      "totalIssues": 0,
      "errorCount": 0,
      "warningCount": 0,
      "infoCount": 0,
      "hintCount": 0,
      "durationMs": 1200
    },
    "metadata": {
      "name": "Test API",
      "version": "1.0.0"
    },
    "timestamp": "2026-02-04T10:00:00Z"
  }'
```

### List Jobs

```bash
curl http://localhost:3010/jobs
```

### Get Job Details

```bash
curl http://localhost:3010/jobs/test-123
```

## Configuration

Environment variables (see `.env.example`):

- `SPECTIFYR_API_KEY` (required) - API key for authentication
- `PORT` (default: 3010) - Server port
- `HOST` (default: 0.0.0.0) - Server host
- `DATABASE_PATH` (default: ./reports.db) - SQLite database file location
- `LOG_LEVEL` (default: info) - Logging level (debug, info, warn, error)
- `LOG_FORMAT` - Set to `json` for JSON logs, omit for human-readable format
- `NODE_ENV` (default: development) - Environment mode

## Project Structure

```
/
├── src/                    # TypeScript source code
│   ├── index.ts            # Main entry point
│   ├── server.ts           # Fastify server setup
│   ├── database.ts         # Database adapter
│   ├── auth.ts             # Authentication middleware
│   ├── types.ts            # TypeScript types
│   └── routes/             # Route handlers
│       ├── reports.ts      # POST /reports/jobs
│       └── jobs.ts         # GET /jobs, GET /jobs/:id
├── schema/                 # Database schema
│   └── schema.sql          # SQLite schema
├── build/                  # Compiled JavaScript (generated)
└── reports.db              # SQLite database (generated)
```

## Integration with the linting orchestrator

Configure the orchestrator to send notifications to this service:

```yaml
# spectifyd config.yaml
reportService:
  enabled: true
  url: 'http://localhost:3010'
  apiKey: ${SPECTIFYR_API_KEY}
  timeout: 5000
  retries: 3
```

## Web UI

Open your browser and navigate to `http://localhost:3010` to:
- View all lint jobs with pagination
- Search by document ID
- Filter by status (completed/failed/timeout)
- View detailed job results with issue breakdown
- See per-ruleset results

## Cleanup Old Reports

Delete old reports to manage database size:

```bash
# Preview what would be deleted (dry-run)
npm run cleanup -- --days 90 --dry-run

# Delete jobs older than 90 days
npm run cleanup -- --days 90

# Delete only failed jobs
npm run cleanup -- --status failed

# Non-interactive mode (skip confirmation)
npm run cleanup -- --days 365 --yes
```

## Reset Database

To completely reset the database (deletes all data):

```bash
npm run reset
```

⚠️ **Warning**: This permanently deletes `reports.db`. The database will be recreated empty on the next server start.

## Troubleshooting

### Server won't start

- Check that `SPECTIFYR_API_KEY` is set
- Verify port 3010 is not in use
- Check database file permissions

### Authentication errors

- Ensure API key matches between the linting orchestrator and the linting reporting service
- Verify `Authorization: Bearer <key>` header format

### Database errors

- Check write permissions for `DATABASE_PATH`
- Verify SQLite is properly installed

## Documentation

- [Architecture Design](docs/SPECTIFYR_ARCHITECTURE.md) - Complete design specification
- [Agent Guide](AGENTS.md) - AI agent instructions


