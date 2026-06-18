-- Report Service Database Schema
-- SQLite schema for storing OpenAPI lint job results received from
-- the linting orchestrator service.

-- Jobs table (main records)
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,                   -- Job ID (UUID)
  document_id TEXT NOT NULL,             -- Document ID
  document_name TEXT,                    -- Document name (for display)
  document_version TEXT,                 -- Document version
  status TEXT NOT NULL,                  -- completed, failed, timeout
  created_at TIMESTAMP NOT NULL,         -- Job start time
  completed_at TIMESTAMP NOT NULL,       -- Job completion time
  duration_ms INTEGER,                   -- Execution time in milliseconds
  spectify_session_id TEXT,              -- Spectify session (for filtering)
  
  -- Constraints
  CHECK (status IN ('completed', 'failed', 'timeout'))
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_jobs_document_id ON jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_completed_at ON jobs(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs(spectify_session_id);

-- Ruleset results (one row per ruleset executed)
CREATE TABLE IF NOT EXISTS ruleset_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,                  -- Foreign key to jobs.id
  ruleset_name TEXT NOT NULL,            -- Ruleset name (pubhub, contract, etc.)
  ruleset_version TEXT,                  -- Ruleset version
  status TEXT NOT NULL,                  -- completed, failed, timeout
  issue_count INTEGER DEFAULT 0,         -- Total issues found
  error_count INTEGER DEFAULT 0,         -- Errors
  warning_count INTEGER DEFAULT 0,       -- Warnings
  info_count INTEGER DEFAULT 0,          -- Info
  hint_count INTEGER DEFAULT 0,          -- Hints
  duration_ms INTEGER,                   -- Ruleset execution time
  results_json TEXT,                     -- Full results (JSON blob)
  
  -- Constraints
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  CHECK (status IN ('completed', 'failed', 'timeout'))
);

-- Indexes for ruleset results
CREATE INDEX IF NOT EXISTS idx_ruleset_job ON ruleset_results(job_id);
CREATE INDEX IF NOT EXISTS idx_ruleset_name ON ruleset_results(ruleset_name);

-- Document metadata cache (avoid re-fetching)
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,                   -- Document ID
  name TEXT NOT NULL,                    -- Document name
  version TEXT,                          -- Document version
  organization TEXT,                     -- Organization
  format TEXT,                           -- openapi, swagger
  last_linted_at TIMESTAMP,              -- Last lint timestamp
  total_lints INTEGER DEFAULT 0,         -- Total times linted
  
  -- Constraints
  CHECK (format IN ('openapi', 'swagger', 'asyncapi', 'unknown'))
);

-- Indexes for documents
CREATE INDEX IF NOT EXISTS idx_documents_name ON documents(name);
CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(organization);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert initial schema version
INSERT OR IGNORE INTO schema_version (version) VALUES (1);
