# Report Service Configuration Design - Mode-Based Audit Trail

**Status:** Ready for Implementation  
**Created:** 2026-02-05  
**Updated:** 2026-02-05  
**Target:** spectify-reports server + client library  
**Decision:** Option 3 - Single Service + Mode Field

---

## Executive Summary

**Decision:** Implement a single Report Service instance with mode-based filtering using a `mode` field in the report payload.

**Rationale:**
- Simplest architecture (one service, one database)
- Meets core requirement: mode isolation via filtering
- Flexible for cross-mode analysis when needed
- Minimal infrastructure burden
- Easy migration path to multi-database if needed later

**Implementation Owner:** spectify-reports team  
**Spectify Integration:** Use spectify-reports client library v1.3.0+

---

## Background

Spectify operates in three distinct deployment modes:
- **Light Mode** (embedded): CLI embeds server, single-user, development/CI
- **Companion Mode**: Runs alongside MCP, shared document store
- **Standalone Mode**: Dedicated server, multi-user, production

**Problem:** Reports from different modes should be separable for analysis, but running separate Report Service instances per mode creates unnecessary infrastructure overhead.

**Solution:** Single Report Service with mode field in payload and database schema.

---

## Requirements

### Functional Requirements

1. **Mode Identification**: Each report must be tagged with its Spectify deployment mode
2. **Mode Filtering**: Report viewer must support filtering by mode (`--mode light`)
3. **Cross-Mode Analysis**: Viewer should allow viewing all modes together (default)
4. **Backward Compatibility**: Existing reports without mode should still be viewable
5. **Configuration Simplicity**: Mode auto-detected from Spectify deployment configuration

### Non-Functional Requirements

1. **Single Service**: One Report Service instance handles all modes
2. **Single Database**: One SQLite database with indexed mode column
3. **Performance**: Mode filtering via SQL index (<50ms query time)
4. **Migration**: Zero downtime migration from current schema
5. **Client Library**: spectify-reports client v1.3.0+ includes mode in payload

### Use Cases

| Mode | Typical Usage | Report Volume | Viewing Pattern |
|------|---------------|---------------|-----------------|
| **Light** | Developer testing, CI/CD pipelines | Low-Medium | Per-developer, filtered by mode |
| **Companion** | MCP integration, shared workflows | Medium | Team workflows, mode-specific |
| **Standalone** | Production API, multiple teams | High | Production monitoring, mode-filtered |

**Key Insight:** Users want mode separation for clarity, not physical database isolation.

---

---

## Simplified Production Deployment (Recommended Defaults)

### Philosophy: Mode-Aware Fault Tolerance

Different deployment modes have different expectations for Report Service availability:

| Mode | Report Service | Behavior if Unavailable | Rationale |
|------|---------------|-------------------------|-----------|
| **Light** | Optional | Continue, store in pending-reports | Dev/testing environment, no infrastructure assumed |
| **Companion** | Required | Fail startup | Production integration, service should be running |
| **Standalone** | Required | Fail startup | Production deployment, service should be running |

**API Key:** Single shared key across all modes (set once in environment or .env file)

### Default Storage Locations (Production)

**Spectify:**
```bash
~/.spectify/
├── reports/
│   └── pending/           # Failed notifications (all modes)
└── uploads/               # Document storage (light mode)
```

**Report Service:**
```bash
~/.spectify/
└── reports/
    ├── database/
    │   └── reports.db     # SQLite database (all modes)
    └── pending/           # Shared with Spectify
```

**Rationale:**
- User-level directory (`~/.spectify/`) - no root permissions required
- Shared `pending/` folder - both services can access failed notifications
- Shared API key - set once, works everywhere
- Consistent across all modes
- Survives service restarts
- Easy to backup/restore

### Configuration via .env File (Recommended)

**Create `.env` in Spectify project root:**

```bash
# .env - Spectify configuration

# Report Service Integration (all modes)
SPECTIFYR_ENABLED=true
SPECTIFYR_URL=http://localhost:3010
SPECTIFYR_API_KEY=your-shared-secret-key

# Optional: Override defaults
# SPECTIFYR_MODE=standalone           # Auto-detected from deployment mode
# SPECTIFYR_PENDING_DIR=~/.spectify/reports/pending  # Production default
# SPECTIFYR_STOP_IF_UNAVAILABLE=true  # Auto-set based on mode

# Optional: Advanced tuning
# SPECTIFYR_TIMEOUT=5000
# SPECTIFYR_MAX_RETRIES=3
# SPECTIFYR_BASE_RETRY_DELAY=1000
# SPECTIFYR_RETRY_JOB_ENABLED=true
# SPECTIFYR_RETRY_JOB_INTERVAL=300000
```

**Create `.env` in Report Service project root:**

```bash
# .env - Report Service configuration

# Server
SPECTIFYR_PORT=3010
SPECTIFYR_HOST=0.0.0.0
SPECTIFYR_API_KEY=your-shared-secret-key    # Same key as Spectify

# Database location (production default)
SPECTIFYR_DB_PATH=~/.spectify/reports/database/reports.db

# Optional: Logging
# LOG_LEVEL=info
# LOG_FILE=~/.spectify/reports/logs/server.log
```

**Setup (One-time):**

```bash
# 1. Copy example to .env in both projects
cp .env.example .env

# 2. Edit .env and set your API key (same key in both files)
# SPECTIFYR_API_KEY=your-shared-secret-key

# 3. Start services (no command line args needed!)
cd spectify-reports && npm start          # Report Service
cd spectify && npm start                  # Spectify
```

### Configuration per Mode

#### Light Mode (Embedded)

**Spectify .env:**
```bash
SPECTIFYR_ENABLED=true
SPECTIFYR_API_KEY=your-shared-secret-key
# Other settings auto-configured for light mode
```

**Behavior:**
- Report Service optional (user may not run it)
- Failed notifications stored in `~/.spectify/reports/pending/`
- Retry job attempts to send pending reports every 5 minutes
- No startup failure if Report Service unavailable
- **Use case:** Developer testing, CI/CD pipelines

#### Companion Mode (MCP Integration)

**Spectify .env:**
```bash
SPECTIFYR_ENABLED=true
SPECTIFYR_API_KEY=your-shared-secret-key
# Mode and stopIfUnavailable auto-configured
```

**Behavior:**
- Report Service required
- Startup fails with clear error if Report Service unavailable
- Ensures audit trail is always active in production
- **Use case:** MCP integration, shared team workflows

#### Standalone Mode (Production)

**Spectify .env:**
```bash
SPECTIFYR_ENABLED=true
SPECTIFYR_API_KEY=your-shared-secret-key
# Mode and stopIfUnavailable auto-configured
```

**Behavior:**
- Report Service required
- Startup fails with clear error if Report Service unavailable
- Ensures production audit trail is always active
- **Use case:** Production API, multiple teams

**Note:** All modes use the same API key from `.env` file. Mode-specific behavior (stopIfUnavailable) is auto-configured based on deployment mode.

### Report Service Configuration (All Modes)

**Report Service .env:**
```bash
# Server
SPECTIFYR_PORT=3010
SPECTIFYR_HOST=0.0.0.0
SPECTIFYR_API_KEY=your-shared-secret-key    # Same key as Spectify

# Database (production default)
SPECTIFYR_DB_PATH=~/.spectify/reports/database/reports.db

# Optional: Logging
LOG_LEVEL=info
# LOG_FILE=~/.spectify/reports/logs/server.log
```

**Note:** Report Service and Spectify share the same API key for simplicity.

### Startup Sequence

#### Light Mode
```bash
# Start Spectify (Report Service not required)
cd spectify
npm start    # Reads .env automatically

# If Report Service not running:
# ✓ Spectify starts successfully
# ⚠️ Warning: Report Service unavailable, notifications will be queued
# → Pending reports stored in ~/.spectify/reports/pending/

# Start Report Service later (optional)
cd spectify-reports
npm start    # Reads .env automatically
# → Spectify's retry job will send pending reports
```

#### Standalone/Companion Mode
```bash
# 1. Start Report Service FIRST
cd spectify-reports
npm start    # Reads .env automatically
# ✓ Report Service running on port 3010
# ✓ Database: ~/.spectify/reports/database/reports.db

# 2. Start Spectify
cd spectify
npm start    # Reads .env automatically
# ✓ Checks Report Service availability
# ✓ Starts if available
# ❌ Fails with error if Report Service down

# Error message if Report Service unavailable:
# ERROR: Report Service unavailable at http://localhost:3010
# ERROR: Standalone mode requires Report Service to be running
# ERROR: Please start Report Service in spectify-reports: npm start
# ERROR: Or disable reporting in .env: SPECTIFYR_ENABLED=false
```

### Environment Variables (Simplified)

**Minimal .env (all modes):**
```bash
SPECTIFYR_ENABLED=true
SPECTIFYR_API_KEY=your-shared-secret-key
```

**All settings with defaults:**
```bash
# Required
SPECTIFYR_ENABLED=true
SPECTIFYR_API_KEY=your-shared-secret-key

# Optional - Override production defaults
SPECTIFYR_URL=http://localhost:3010                    # Default
SPECTIFYR_MODE=standalone                              # Auto-detected
SPECTIFYR_PENDING_DIR=~/.spectify/reports/pending      # Production default
SPECTIFYR_STOP_IF_UNAVAILABLE=true                     # Auto-set per mode

# Optional - Advanced tuning
SPECTIFYR_TIMEOUT=5000
SPECTIFYR_MAX_RETRIES=3
SPECTIFYR_BASE_RETRY_DELAY=1000
SPECTIFYR_RETRY_JOB_ENABLED=true
SPECTIFYR_RETRY_JOB_INTERVAL=300000
```

### npm Scripts (Production)

**Spectify:**
```json
{
  "scripts": {
    "start": "node build/index.js",
    "dev": "NODE_ENV=development tsx watch src/index.ts"
  }
}
```

**Report Service:**
```json
{
  "scripts": {
    "start": "node build/server/index.js",
    "dev": "NODE_ENV=development tsx watch src/server/index.ts"
  }
}
```

**Note:** All configuration read from `.env` files. No command line arguments needed.

### .env.example Files

**Spectify `.env.example`:**
```bash
# Report Service Integration
SPECTIFYR_ENABLED=true
SPECTIFYR_URL=http://localhost:3010
SPECTIFYR_API_KEY=change-me-to-a-secure-secret

# Optional: Override defaults (usually not needed)
# SPECTIFYR_MODE=standalone
# SPECTIFYR_PENDING_DIR=~/.spectify/reports/pending
# SPECTIFYR_STOP_IF_UNAVAILABLE=true
# SPECTIFYR_TIMEOUT=5000
# SPECTIFYR_MAX_RETRIES=3
```

**Report Service `.env.example`:**
```bash
# Server Configuration
SPECTIFYR_PORT=3010
SPECTIFYR_HOST=0.0.0.0
SPECTIFYR_API_KEY=change-me-to-a-secure-secret

# Database Location
SPECTIFYR_DB_PATH=~/.spectify/reports/database/reports.db

# Optional: Logging
# LOG_LEVEL=info
# LOG_FILE=~/.spectify/reports/logs/server.log
```

**Setup Instructions (README.md):**
```bash
# 1. Copy example to .env
cp .env.example .env

# 2. Edit .env and set the same API key in both projects
#    Spectify: SPECTIFYR_API_KEY=your-secret-key
#    Report Service: SPECTIFYR_API_KEY=your-secret-key

# 3. Start services (configuration automatically loaded from .env)
cd spectify-reports && npm start
cd spectify && npm start
```

### Docker Compose Example

```yaml
version: '3.8'

services:
  spectify-reports:
    image: spectify-reports:latest
    ports:
      - "3010:3010"
    volumes:
      - spectify-reports-data:/root/.spectify/reports
    environment:
      - SPECTIFYR_PORT=3010
      - SPECTIFYR_HOST=0.0.0.0
      - SPECTIFYR_API_KEY=${SPECTIFYR_API_KEY}  # From .env
      - SPECTIFYR_DB_PATH=/root/.spectify/reports/database/reports.db
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3010/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  spectify:
    image: spectify:latest
    ports:
      - "3003:3003"
    volumes:
      - spectify-reports-data:/root/.spectify/reports  # Shared volume
    environment:
      - SPECTIFYR_ENABLED=true
      - SPECTIFYR_URL=http://spectify-reports:3010
      - SPECTIFYR_API_KEY=${SPECTIFYR_API_KEY}  # Same key from .env
      - SPECTIFYR_PENDING_DIR=/root/.spectify/reports/pending
    depends_on:
      spectify-reports:
        condition: service_healthy

volumes:
  spectify-reports-data:
```

**Docker .env file:**
```bash
# Shared API key for both services
SPECTIFYR_API_KEY=production-secret-key-here
```

**Usage:**
```bash
# Start both services (reads .env automatically)
docker-compose up -d
```

---

## Chosen Architecture: Single Service + Mode Field

### System Overview

```
┌─────────────────┐      
│ Spectify Light  │──┐   
│ (mode=light)    │  │   
└─────────────────┘  │   
                     │   
┌─────────────────┐  │   ┌──────────────────────┐
│ Spectify        │──┼──▶│ Report Service       │──▶ reports.db
│ Companion       │  │   │ (Port 3010)          │      ├─ mode='light'
│ (mode=companion)│  │   │                      │      ├─ mode='companion'
└─────────────────┘  │   └──────────────────────┘      └─ mode='standalone'
                     │   
┌─────────────────┐  │   
│ Spectify        │──┘   
│ Standalone      │      
│ (mode=standalone)│      
└─────────────────┘      
```

### Data Flow

1. **Spectify** completes lint job
2. **Spectify** sends notification to Report Service (includes `mode` field)
3. **Report Service** stores report with mode in database
4. **User** queries viewer with optional mode filter
5. **Viewer** returns filtered results

---

## Implementation Specifications

### 1. Database Schema Changes (Report Service)

**Required Migration:**

```sql
-- Migration: Add mode column
ALTER TABLE reports ADD COLUMN mode TEXT NOT NULL DEFAULT 'unknown';

-- Create index for performance
CREATE INDEX idx_reports_mode ON reports(mode);

-- Update existing reports (optional - mark as 'unknown' or infer from date)
-- UPDATE reports SET mode = 'standalone' WHERE created_at < '2026-02-05';
```

**Complete Schema (Reference):**

```sql
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL,
  document_name TEXT NOT NULL,
  ruleset_name TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,                    -- NEW: 'light', 'companion', 'standalone', 'unknown'
  format TEXT NOT NULL,
  error_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  info_count INTEGER NOT NULL DEFAULT 0,
  hint_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Existing indexes
  CONSTRAINT unique_document_ruleset UNIQUE(document_id, ruleset_name, ruleset_version)
);

CREATE INDEX idx_reports_document_id ON reports(document_id);
CREATE INDEX idx_reports_ruleset ON reports(ruleset_name);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_created_at ON reports(created_at);
CREATE INDEX idx_reports_mode ON reports(mode);  -- NEW
```

### 2. API Payload Changes (Report Service)

**Current Payload (v1.2.0):**

```typescript
{
  documentId: "abc-123",
  documentName: "my-api.yaml",
  rulesetName: "pubhub",
  rulesetVersion: "1.1.0",
  status: "completed",
  format: "openapi",
  errorCount: 5,
  warningCount: 10,
  infoCount: 2,
  hintCount: 0
}
```

**New Payload (v1.3.0):**

```typescript
{
  documentId: "abc-123",
  documentName: "my-api.yaml",
  rulesetName: "pubhub",
  rulesetVersion: "1.1.0",
  status: "completed",
  format: "openapi",
  mode: "standalone",           // NEW FIELD
  errorCount: 5,
  warningCount: 10,
  infoCount: 2,
  hintCount: 0
}
```

**Validation Rules:**

```typescript
// spectify-reports/src/types.ts
export type SpectifyMode = 'light' | 'companion' | 'standalone' | 'unknown';

export interface ReportPayload {
  documentId: string;
  documentName: string;
  rulesetName: string;
  rulesetVersion: string;
  status: 'completed' | 'failed' | 'timeout';
  format: 'openapi' | 'asyncapi' | 'json' | 'yaml';
  mode: SpectifyMode;        // REQUIRED in v1.3.0+
  errorCount: number;
  warningCount: number;
  infoCount: number;
  hintCount: number;
}

// Validation function
function validateReportPayload(payload: any): ReportPayload {
  // ... existing validation
  
  // NEW: Validate mode
  const validModes: SpectifyMode[] = ['light', 'companion', 'standalone', 'unknown'];
  if (!payload.mode || !validModes.includes(payload.mode)) {
    throw new Error(`Invalid mode: ${payload.mode}. Must be one of: ${validModes.join(', ')}`);
  }
  
  return payload as ReportPayload;
}
```

### 3. Client Library Changes (spectify-reports)

**Package:** `spectify-reports` v1.3.0

**Updated Client Interface:**

```typescript
// spectify-reports/src/client/index.ts

export interface ReportServiceClientConfig {
  url: string;
  apiKey: string;
  mode: SpectifyMode;        // NEW: Required configuration
  timeout?: number;
  maxRetries?: number;
  // ... other options
}

export class ReportServiceClient {
  private config: ReportServiceClientConfig;

  constructor(config: ReportServiceClientConfig) {
    // Validate mode
    const validModes: SpectifyMode[] = ['light', 'companion', 'standalone'];
    if (!validModes.includes(config.mode)) {
      throw new Error(`Invalid mode: ${config.mode}`);
    }
    
    this.config = config;
  }

  async submitReport(payload: Omit<ReportPayload, 'mode'>): Promise<void> {
    // Automatically inject mode from config
    const fullPayload: ReportPayload = {
      ...payload,
      mode: this.config.mode  // Mode comes from client config
    };

    // Validate payload
    validateReportPayload(fullPayload);

    // Send to Report Service
    await this.sendRequest('/reports', fullPayload);
  }
}
```

**Usage Example in Spectify:**

```typescript
// spectify/src/orchestrator.ts

import { ReportServiceClient } from 'spectify-reports';

// Initialize client with mode from Spectify config
const reportClient = new ReportServiceClient({
  url: config.reportService.url,
  apiKey: config.reportService.apiKey,
  mode: config.reportService.mode,  // 'light', 'companion', or 'standalone'
  timeout: config.reportService.timeout,
  maxRetries: config.reportService.maxRetries
});

// Submit report - mode automatically included
await reportClient.submitReport({
  documentId: job.documentId,
  documentName: job.documentName,
  rulesetName: job.rulesetName,
  rulesetVersion: job.rulesetVersion,
  status: job.status,
  format: job.format,
  errorCount: job.summary.errorCount,
  warningCount: job.summary.warningCount,
  infoCount: job.summary.infoCount,
  hintCount: job.summary.hintCount
});
```

### 4. Report Viewer Changes (Report Service CLI)

**CLI Filtering:**

```bash
# View all reports (all modes)
spectify-reports list

# Filter by mode
spectify-reports list --mode light
spectify-reports list --mode companion
spectify-reports list --mode standalone

# Filter by mode + other criteria
spectify-reports list --mode standalone --status completed
spectify-reports list --mode light --document-id abc-123
```

**Query Implementation:**

```typescript
// spectify-reports/src/server/database.ts

export interface ListReportsOptions {
  mode?: SpectifyMode;
  status?: string;
  documentId?: string;
  rulesetName?: string;
  limit?: number;
  offset?: number;
}

export async function listReports(
  db: Database,
  options: ListReportsOptions
): Promise<Report[]> {
  let query = 'SELECT * FROM reports WHERE 1=1';
  const params: any[] = [];

  // Filter by mode (NEW)
  if (options.mode) {
    query += ' AND mode = ?';
    params.push(options.mode);
  }

  // Filter by status
  if (options.status) {
    query += ' AND status = ?';
    params.push(options.status);
  }

  // ... other filters

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(options.limit || 50, options.offset || 0);

  return db.all(query, params);
}
```

---

## Spectify Integration

### Configuration Updates (Spectify)

**Support for dotenv:**

```typescript
// spectify/src/index.ts (top of file)
import 'dotenv/config';  // Load .env file before any config loading

// ... rest of imports and code
```

**Install dotenv:**
```bash
cd spectify
npm install dotenv
```

**Type Definitions:**

```typescript
// spectify/src/types.ts

export type SpectifyMode = 'light' | 'companion' | 'standalone';

export interface ReportServiceConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
  mode: SpectifyMode;           // NEW: Required field
  timeout: number;
  maxRetries: number;
  baseRetryDelay: number;
  pendingDir: string;
  enableRetryJob: boolean;
  retryJobInterval: number;
  stopIfUnavailable: boolean;   // IMPORTANT: Mode-dependent behavior
}
```

**Default Pending Directory:**

```typescript
// spectify/src/config.ts
import os from 'os';
import path from 'path';

// Production default: ~/.spectify/reports/pending
const DEFAULT_PENDING_DIR = path.join(
  os.homedir(),
  '.spectify',
  'reports',
  'pending'
);

// Development default: ./pending-reports (local to project)
const DEV_PENDING_DIR = './pending-reports';

function getPendingDir(): string {
  // Environment override takes precedence
  if (process.env.SPECTIFYR_PENDING_DIR) {
    return process.env.SPECTIFYR_PENDING_DIR;
  }
  
  // Use local directory in dev/test mode
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    return DEV_PENDING_DIR;
  }
  
  // Production: use user home directory
  return DEFAULT_PENDING_DIR;
}
```

**Mode Auto-Detection with Fault Tolerance:**

```typescript
// spectify/src/config.ts

function getReportServiceMode(deploymentMode: SpectifyMode): SpectifyMode {
  // Environment override takes precedence
  if (process.env.SPECTIFYR_MODE) {
    const mode = process.env.SPECTIFYR_MODE as SpectifyMode;
    const validModes: SpectifyMode[] = ['light', 'companion', 'standalone'];
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid SPECTIFYR_MODE: ${mode}`);
    }
    return mode;
  }
  
  // Auto-detect from deployment mode
  return deploymentMode;
}

function getStopIfUnavailable(mode: SpectifyMode): boolean {
  // Environment override
  if (process.env.SPECTIFYR_STOP_IF_UNAVAILABLE !== undefined) {
    return process.env.SPECTIFYR_STOP_IF_UNAVAILABLE === 'true';
  }
  
  // Mode-based defaults:
  // - Light mode: optional (continue if unavailable)
  // - Companion/Standalone: required (fail if unavailable)
  return mode === 'companion' || mode === 'standalone';
}

export function createLightModeConfig(): OrchestratorConfig {
  const mode = getReportServiceMode('light');
  
  return {
    // ... existing config
    reportService: {
      enabled: process.env.SPECTIFYR_ENABLED === 'true',
      url: process.env.SPECTIFYR_URL || 'http://localhost:3010',
      apiKey: process.env.SPECTIFYR_API_KEY || '',
      mode,
      timeout: parseInt(process.env.SPECTIFYR_TIMEOUT || '5000', 10),
      maxRetries: parseInt(process.env.SPECTIFYR_MAX_RETRIES || '3', 10),
      baseRetryDelay: parseInt(process.env.SPECTIFYR_BASE_RETRY_DELAY || '1000', 10),
      pendingDir: getPendingDir(),                    // Default: ~/.spectify/reports/pending
      enableRetryJob: process.env.SPECTIFYR_RETRY_JOB_ENABLED !== 'false',
      retryJobInterval: parseInt(process.env.SPECTIFYR_RETRY_JOB_INTERVAL || '300000', 10),
      stopIfUnavailable: getStopIfUnavailable(mode)   // Default: false (light mode)
    }
  };
}

export function createCompanionModeConfig(): OrchestratorConfig {
  const mode = getReportServiceMode('companion');
  
  return {
    // ... existing config
    reportService: {
      // ... same as above
      mode,
      pendingDir: getPendingDir(),
      stopIfUnavailable: getStopIfUnavailable(mode)   // Default: true (companion mode)
    }
  };
}

export function createStandaloneModeConfig(): OrchestratorConfig {
  const mode = getReportServiceMode('standalone');
  
  return {
    // ... existing config
    reportService: {
      // ... same as above
      mode,
      pendingDir: getPendingDir(),
      stopIfUnavailable: getStopIfUnavailable(mode)   // Default: true (standalone mode)
    }
  };
}
```

**Startup Validation:**

```typescript
// spectify/src/index.ts

async function validateReportService(config: ReportServiceConfig): Promise<boolean> {
  if (!config.enabled) {
    return true; // Not enabled, no validation needed
  }
  
  try {
    const response = await fetch(`${config.url}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(config.timeout)
    });
    
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function startServer(config: OrchestratorConfig): Promise<ServerInstance> {
  // Validate Report Service availability if required
  if (config.reportService?.enabled && config.reportService.stopIfUnavailable) {
    logger.info('Validating Report Service availability...');
    
    const isAvailable = await validateReportService(config.reportService);
    
    if (!isAvailable) {
      const mode = config.reportService.mode;
      logger.error(`Report Service unavailable at ${config.reportService.url}`);
      logger.error(`${mode} mode requires Report Service to be running`);
      logger.error('Please start Report Service: spectify-reports server start');
      logger.error('Or disable reporting: SPECTIFYR_ENABLED=false');
      
      throw new Error(
        `Report Service required for ${mode} mode but unavailable at ${config.reportService.url}`
      );
    }
    
    logger.info('✓ Report Service available');
  } else if (config.reportService?.enabled) {
    logger.warn('Report Service enabled but optional for this mode');
    logger.warn('Failed notifications will be queued in pending directory');
  }
  
  // ... rest of server startup
}
```

### YAML Configuration (Spectify)

**Production (Standalone):**
```yaml
# config.yaml

reportService:
  enabled: true
  url: 'http://localhost:3010'
  apiKey: 'production-secret'
  mode: 'standalone'                                  # Auto-detected
  timeout: 5000
  maxRetries: 3
  baseRetryDelay: 1000
  pendingDir: '~/.spectify/reports/pending'           # Production default
  enableRetryJob: true
  retryJobInterval: 300000
  stopIfUnavailable: true                             # Fail startup if unavailable
```

**Development (Light):**
```yaml
# config.yaml (or just use defaults)

reportService:
  enabled: true
  url: 'http://localhost:3010'
  apiKey: 'dev-key'
  mode: 'light'                                       # Auto-detected
  pendingDir: './pending-reports'                     # Dev default (local)
  stopIfUnavailable: false                            # Continue if unavailable
```

**Mode Precedence (Highest to Lowest):**
1. `SPECTIFYR_MODE` environment variable
2. `config.yaml` explicit mode
3. Auto-detected from deployment mode (light/companion/standalone)

**stopIfUnavailable Precedence:**
1. `SPECTIFYR_STOP_IF_UNAVAILABLE` environment variable
2. `config.yaml` explicit value
3. Auto-detected from mode (light=false, companion/standalone=true)

---

## Report Service Configuration

### Support for dotenv

```typescript
// spectify-reports/src/server/index.ts (top of file)
import 'dotenv/config';  // Load .env file

// ... rest of imports and code
```

**Install dotenv:**
```bash
cd spectify-reports
npm install dotenv
```

### Default Database Location

```typescript
// spectify-reports/src/server/config.ts
import os from 'os';
import path from 'path';

// Production default: ~/.spectify/reports/database/reports.db
const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  '.spectify',
  'reports',
  'database',
  'reports.db'
);

// Development default: ./reports.db (local to project)
const DEV_DB_PATH = './reports.db';

function getDefaultDbPath(): string {
  // Environment override
  if (process.env.SPECTIFYR_DB_PATH) {
    return process.env.SPECTIFYR_DB_PATH;
  }
  
  // Use local path in dev/test
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    return DEV_DB_PATH;
  }
  
  // Production: user home directory
  return DEFAULT_DB_PATH;
}
```

### CLI Argument Support (Optional)

```bash
# Report Service server
npm start                                      # Uses .env defaults
npm start -- --db /custom/path/reports.db      # Override via CLI
npm start -- --port 3011                       # Override port

# .env takes precedence over CLI args
```

**Note:** CLI arguments are optional. Most users should use `.env` files for configuration.

### Configuration File (Optional, Advanced)

**For complex deployments, optionally use YAML:**

```yaml
# ~/.spectify/reports/config.yaml (advanced use only)

database:
  path: '~/.spectify/reports/database/reports.db'
  
pendingReports:
  directory: '~/.spectify/reports/pending'
  scanInterval: 300000
  
server:
  port: 3010
  host: '0.0.0.0'
  apiKey: 'production-secret'

logging:
  level: 'info'
  file: '~/.spectify/reports/logs/server.log'
```

**Load config file:**
```bash
npm start -- --config ~/.spectify/reports/config.yaml
```

**Note:** `.env` file is the recommended approach. YAML config is for advanced use cases only.

---

## Integration Updates

### Phase 1: Report Service Updates (v1.3.0)

**1. Add dotenv support**
```bash
npm install dotenv
```

```typescript
// src/server/index.ts
import 'dotenv/config';  // Add at top
```

**2. Create .env.example**
```bash
# .env.example
SPECTIFYR_PORT=3010
SPECTIFYR_HOST=0.0.0.0
SPECTIFYR_API_KEY=change-me-to-a-secure-secret
SPECTIFYR_DB_PATH=~/.spectify/reports/database/reports.db
```

**3. Update .gitignore**
```bash
# .gitignore
.env
.env.local
```

**4. Database migration** (same as before)
```sql
ALTER TABLE reports ADD COLUMN mode TEXT NOT NULL DEFAULT 'unknown';
CREATE INDEX idx_reports_mode ON reports(mode);
```

### Phase 2: Spectify Integration (v0.8.1)

**1. Add dotenv support**
```bash
npm install dotenv
```

```typescript
// src/index.ts
import 'dotenv/config';  // Add at top
```

**2. Create .env.example**
```bash
# .env.example
SPECTIFYR_ENABLED=true
SPECTIFYR_URL=http://localhost:3010
SPECTIFYR_API_KEY=change-me-to-a-secure-secret
```

**3. Update .gitignore**
```bash
# .gitignore
.env
.env.local
```

**4. Update config.ts** (implement getPendingDir() and getStopIfUnavailable() as specified above)

**5. Update README.md**
```markdown
## Report Service Integration

1. Copy .env.example to .env:
   ```bash
   cp .env.example .env
   ```

2. Set the same API key in both .env files:
   - Spectify: `SPECTIFYR_API_KEY=your-secret-key`
   - Report Service: `SPECTIFYR_API_KEY=your-secret-key`

3. Start services:
   ```bash
   cd spectify-reports && npm start
   cd spectify && npm start
   ```
```

---

## Migration Path

### Phase 1: Report Service Updates (v1.3.0)

**Owner:** spectify-reports team

1. **Database Migration**
   - Add `mode` column with default 'unknown'
   - Create index on mode column
   - Test migration on existing database

2. **API Updates**
   - Update payload validation to accept (but not require) `mode` field
   - Store mode in database if provided
   - Backward compatible: if mode missing, use 'unknown'

3. **Client Library Updates**
   - Add `mode` to `ReportServiceClientConfig`
   - Auto-inject mode into payload
   - Update TypeScript types
   - Publish v1.3.0

4. **Viewer Updates**
   - Add `--mode` filter to CLI
   - Update query to filter by mode
   - Default to showing all modes

**Deliverables:**
- spectify-reports v1.3.0 with mode support
- Migration script for existing databases
- Updated documentation

### Phase 2: Spectify Integration (v0.8.1)

**Owner:** Spectify team

1. **Update Dependencies**
   - Upgrade to spectify-reports v1.3.0

2. **Configuration Updates**
   - Add `mode` field to `ReportServiceConfig` type
   - Implement mode auto-detection in config factories
   - Add `SPECTIFYR_MODE` environment variable support

3. **Client Integration**
   - Pass mode to `ReportServiceClient` constructor
   - Test mode injection in payloads

4. **Testing**
   - Test each deployment mode sends correct mode value
   - Test manual mode override
   - Test backward compatibility (Report Service v1.2.0)

**Deliverables:**
- Spectify v0.8.1 with mode support
- Updated configuration examples
- Integration tests

### Phase 3: Rollout

1. **Deploy Report Service v1.3.0**
   - Run database migration
   - Deploy updated server
   - Verify backward compatibility

2. **Deploy Spectify v0.8.1**
   - Update all Spectify instances
   - Verify mode values in reports

3. **User Communication**
   - Document new filtering capability
   - Provide migration guide

---

## Testing Requirements

### Report Service Testing

```typescript
// spectify-reports/tests/integration/mode-filtering.test.ts

describe('Mode Filtering', () => {
  it('should store mode in database', async () => {
    await client.submitReport({
      // ... payload
      mode: 'light'
    });
    
    const reports = await db.all('SELECT * FROM reports WHERE mode = ?', ['light']);
    expect(reports).toHaveLength(1);
    expect(reports[0].mode).toBe('light');
  });

  it('should filter reports by mode', async () => {
    // Submit reports with different modes
    await submitReport({ mode: 'light', documentId: 'doc1' });
    await submitReport({ mode: 'standalone', documentId: 'doc2' });
    await submitReport({ mode: 'companion', documentId: 'doc3' });

    // Filter by mode
    const lightReports = await listReports({ mode: 'light' });
    expect(lightReports).toHaveLength(1);
    expect(lightReports[0].documentId).toBe('doc1');
  });

  it('should default to "unknown" if mode missing (backward compat)', async () => {
    await client.submitReport({
      // ... payload without mode
    });
    
    const reports = await db.all('SELECT * FROM reports');
    expect(reports[0].mode).toBe('unknown');
  });
});
```

### Spectify Integration Testing

```typescript
// spectify/tests/integration/report-service-mode.test.ts

describe('Report Service Mode Integration', () => {
  it('should send correct mode for light deployment', async () => {
    const config = createLightModeConfig();
    expect(config.reportService?.mode).toBe('light');
    
    const orchestrator = new Orchestrator(config);
    await orchestrator.submitJob({ ... });
    
    // Verify mode in submitted report
    const sentPayload = captureReportPayload();
    expect(sentPayload.mode).toBe('light');
  });

  it('should allow mode override via environment', () => {
    process.env.SPECTIFYR_MODE = 'custom';
    
    const config = createStandaloneModeConfig();
    expect(config.reportService?.mode).toBe('custom');
  });

  it('should validate mode value', () => {
    process.env.SPECTIFYR_MODE = 'invalid-mode';
    
    expect(() => createLightModeConfig()).toThrow('Invalid SPECTIFYR_MODE');
  });
});
```

---

## Configuration Examples

### Production Deployment (Recommended)

**1. Setup (One-time):**
```bash
# Spectify
cd spectify
cp .env.example .env
# Edit .env: Set SPECTIFYR_API_KEY=your-secret-key

# Report Service
cd spectify-reports
cp .env.example .env
# Edit .env: Set SPECTIFYR_API_KEY=your-secret-key (same key!)
```

**2. Start Services:**
```bash
# Start Report Service (reads .env)
cd spectify-reports
npm start

# Start Spectify (reads .env)
cd spectify
npm start
```

**3. Verify:**
```bash
# Check Report Service
curl http://localhost:3010/health

# Check Spectify
curl http://localhost:3003/health
```

### Development (Light Mode)

**Setup:**
```bash
# Spectify only (minimal .env)
cd spectify
cp .env.example .env
# Edit .env: Set SPECTIFYR_ENABLED=true and API key

# Start Spectify (Report Service optional)
npm run dev
```

**Behavior:**
```bash
# If Report Service not running:
# ✓ Spectify continues (light mode default)
# ⚠️ Notifications queued in ./pending-reports (dev default)

# Start Report Service later (optional):
cd spectify-reports && npm run dev
# → Pending reports automatically sent
```

### Environment Variables Summary

**Required in .env (both projects):**
| Variable | Value | Notes |
|----------|-------|-------|
| `SPECTIFYR_ENABLED` | `true` | Enable reporting |
| `SPECTIFYR_API_KEY` | `your-secret-key` | **Same key in both .env files** |

**Optional Overrides:**
| Variable | Default | Description |
|----------|---------|-------------|
| `SPECTIFYR_URL` | `http://localhost:3010` | Report Service endpoint |
| `SPECTIFYR_MODE` | Auto-detect | `light`, `companion`, or `standalone` |
| `SPECTIFYR_PENDING_DIR` | `~/.spectify/reports/pending` (prod)<br>`./pending-reports` (dev) | Failed notifications directory |
| `SPECTIFYR_STOP_IF_UNAVAILABLE` | Auto-set per mode | `false` (light), `true` (companion/standalone) |
| `SPECTIFYR_DB_PATH` | `~/.spectify/reports/database/reports.db` | Report Service only |

**Key Insight:** Only need to set 2 variables in .env for both services to work:
```bash
SPECTIFYR_ENABLED=true
SPECTIFYR_API_KEY=your-secret-key
```

### Directory Structure (Production)

```bash
~/.spectify/
├── reports/
│   ├── database/
│   │   └── reports.db              # Report Service database
│   ├── pending/
│   │   ├── 2026-02-05T10-30-00.json
│   │   └── 2026-02-05T10-31-00.json
│   └── logs/
│       └── server.log              # Report Service logs (optional)
└── uploads/                        # Spectify documents (light mode only)
    └── ...
```

---

## Spectify Configuration (All Modes)

---

## Impact Analysis

### Report Service (spectify-reports)

**Changes Required:**
- Database schema: Add mode column + index
- API: Accept mode in payload
- Client library: Add mode to config
- Viewer: Add mode filtering

**Effort:** 2-3 days
**Risk:** Low (backward compatible)

### Spectify

**Changes Required:**
- Type definitions: Add mode to ReportServiceConfig
- Config factories: Auto-detect mode
- Environment variables: Add SPECTIFYR_MODE

**Effort:** 1-2 days
**Risk:** Low (configuration change only)

### No Changes Required

- MCP OpenAPI Analyzer: No changes needed
- Existing Spectify deployments: Continue working (mode='unknown')
- Report Service server: Backward compatible

---

## Success Criteria

1. ✅ Report Service v1.3.0 published with mode support
2. ✅ Database migration script tested and documented
3. ✅ Client library accepts mode in config
4. ✅ Mode automatically injected in payloads
5. ✅ Spectify v0.8.1 uses correct mode per deployment
6. ✅ Viewer filters reports by mode correctly
7. ✅ Backward compatibility maintained (v1.2.0 clients work)
8. ✅ Performance: Mode filtering <50ms (indexed query)

---

## Open Questions

1. **Should we allow custom mode values beyond light/companion/standalone?**
   - **Recommendation:** Yes, via SPECTIFYR_MODE env var (for CI pipelines, etc.)

2. **How to handle existing reports without mode?**
   - **Recommendation:** Mark as 'unknown', optionally infer from timestamp

3. **Should mode be editable after report creation?**
   - **Recommendation:** No, immutable once set

4. **Should we add environment field separately (dev/staging/prod)?**
   - **Recommendation:** Phase 2 - add as orthogonal field

---

## Next Steps

### Immediate (This Week)

1. **Review this design** with spectify-reports team
2. **Approve schema changes** and migration approach
3. **Create implementation tickets**

### Week 1-2 (Report Service v1.3.0)

1. Implement database migration
2. Update API payload validation
3. Update client library
4. Add viewer filtering
5. Write tests
6. Publish v1.3.0

### Week 3 (Spectify v0.8.1)

1. Upgrade to spectify-reports v1.3.0
2. Implement mode auto-detection
3. Test all deployment modes
4. Update documentation
5. Release v0.8.1

### Week 4 (Rollout)

1. Deploy Report Service v1.3.0
2. Run database migration
3. Deploy Spectify v0.8.1
4. Monitor and validate

---

## Appendix: Alternative Considered (Multi-Database)

If single database proves insufficient (compliance, scale), easy migration path:

```yaml
# Report Service configuration (future)
databases:
  light:
    path: './reports-light.db'
    modes: ['light']
  companion:
    path: './reports-companion.db'
    modes: ['companion']
  standalone:
    path: './reports-standalone.db'
    modes: ['standalone']

routing:
  strategy: 'by-mode'  # Route based on payload.mode field
```

**Migration:** No changes to Spectify - just Report Service internal routing.

---

## Document Status

**Ready for:** Implementation by spectify-reports team  
**Requires:** Final approval of schema changes  
**Estimated Timeline:** 3-4 weeks total  
**Risk Level:** Low (backward compatible)  
**Dependencies:** None (standalone feature)

```
┌─────────────────┐      ┌──────────────────────┐
│ Spectify Light  │─────▶│ Report Service Light │──▶ reports-light.db
└─────────────────┘      └──────────────────────┘

┌─────────────────┐      ┌──────────────────────┐
│ Spectify        │─────▶│ Report Service       │──▶ reports-companion.db
│ Companion       │      │ Companion            │
└─────────────────┘      └──────────────────────┘

┌─────────────────┐      ┌──────────────────────┐
│ Spectify        │─────▶│ Report Service       │──▶ reports-standalone.db
│ Standalone      │      │ Standalone           │
└─────────────────┘      └──────────────────────┘
## Rejected Alternatives (For Reference)

### Option 1: Multiple Report Service Instances

Three separate services (ports 3010, 3011, 3012) with separate databases.

**Rejected Because:**
- High operational overhead (3 services to maintain)
- Resource inefficient (3x processes, 3x memory)
- Overkill for mode separation needs

### Option 2: Single Service with Multi-Database Routing

One service that routes to different databases based on API key prefix.

**Rejected Because:**
- Added complexity in service logic
- Harder to do cross-mode analysis
- No significant benefit over Option 3

**Note:** Both alternatives remain viable migration paths if Option 3 proves insufficient in production.


