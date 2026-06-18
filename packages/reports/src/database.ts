/**
 * Database adapter for SQLite
 * Handles all database operations for the Report Service
 */

import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type {
  JobNotification,
  JobListQuery,
  JobListItem,
  JobDetailsResponse,
  RulesetResult,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DatabaseAdapter {
  db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;

    // Ensure the database directory exists
    const dbDir = dirname(dbPath);
    mkdirSync(dbDir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
  }

  /**
   * Initialize database schema from schema.sql
   */
  private initializeSchema(): void {
    const schemaPath = join(__dirname, '..', 'schema', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
  }

  /**
   * Store a job notification from the linting orchestrator.
   *
   * NOTE: The orchestrator currently sends only ONE ruleset per job, but the
   * schema supports multiple for future flexibility. We log a warning if
   * multiple rulesets are detected.
   */
  storeJob(notification: JobNotification): void {
    // Log warning if multiple rulesets detected (unexpected)
    if (notification.results.length > 1) {
      console.warn(`[Database] Job ${notification.jobId} has ${notification.results.length} rulesets - the linting orchestrator typically sends only one. Web UI will show first ruleset only.`);
    }

    const transaction = this.db.transaction(() => {
      // Insert or update document metadata
      this.upsertDocument(notification);

      // Insert job record
      this.insertJob(notification);

      // Insert ruleset results
      for (const result of notification.results) {
        this.insertRulesetResult(notification.jobId, result);
      }
    });

    transaction();
  }

  /**
   * Insert or update document metadata
   */
  private upsertDocument(notification: JobNotification): void {
    const stmt = this.db.prepare(`
      INSERT INTO documents (id, name, version, organization, format, last_linted_at, total_lints)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        organization = excluded.organization,
        format = excluded.format,
        last_linted_at = excluded.last_linted_at,
        total_lints = total_lints + 1
    `);

    stmt.run(
      notification.documentId,
      notification.metadata.name,
      notification.metadata.version || null,
      notification.metadata.organization || null,
      notification.metadata.format || 'unknown',
      notification.timestamp
    );
  }

  /**
   * Insert job record
   */
  private insertJob(notification: JobNotification): void {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        id, document_id, document_name, document_version, status,
        created_at, completed_at, duration_ms, spectify_session_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      notification.jobId,
      notification.documentId,
      notification.metadata.name,
      notification.metadata.version || null,
      notification.status,
      notification.createdAt || notification.timestamp,
      notification.timestamp,
      notification.summary.durationMs || null,
      notification.spectifySessionId || null
    );
  }

  /**
   * Insert ruleset result
   */
  private insertRulesetResult(jobId: string, result: RulesetResult): void {
    const stmt = this.db.prepare(`
      INSERT INTO ruleset_results (
        job_id, ruleset_name, ruleset_version, status,
        issue_count, error_count, warning_count, info_count, hint_count,
        duration_ms, results_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      jobId,
      result.rulesetName,
      result.rulesetVersion || null,
      result.status,
      result.summary.totalIssues,
      result.summary.errorCount,
      result.summary.warningCount,
      result.summary.infoCount,
      result.summary.hintCount,
      result.durationMs || null,
      JSON.stringify(result)
    );
  }

  /**
   * List jobs with optional filtering and pagination
   */
  listJobs(query: JobListQuery = {}): { jobs: JobListItem[]; total: number } {
    const {
      status,
      documentId,
      search,
      rulesetName,
      limit = 50,
      offset = 0,
      sortBy = 'completed_at',
      sortOrder = 'desc',
    } = query;

    // Build WHERE clause
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      conditions.push('j.status = ?');
      params.push(status);
    }

    if (documentId) {
      conditions.push('j.document_id = ?');
      params.push(documentId);
    }

    if (search) {
      // Partial match on document name or ID (starts with)
      conditions.push('(j.document_name LIKE ? OR j.document_id LIKE ?)');
      params.push(`${search}%`, `${search}%`);
    }

    if (rulesetName) {
      conditions.push(`EXISTS (
        SELECT 1 FROM ruleset_results rr 
        WHERE rr.job_id = j.id AND rr.ruleset_name = ?
      )`);
      params.push(rulesetName);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM jobs j ${whereClause}
    `);
    const { count } = countStmt.get(...params) as { count: number };

    // Get paginated jobs
    // NOTE: We fetch only the FIRST ruleset per job (the linting orchestrator sends only one)
    const listStmt = this.db.prepare(`
      SELECT 
        j.id,
        j.document_id as documentId,
        j.document_name as documentName,
        j.document_version as documentVersion,
        j.status,
        j.completed_at as completedAt,
        j.duration_ms as durationMs,
        COALESCE(SUM(rr.issue_count), 0) as totalIssues,
        COALESCE(SUM(rr.error_count), 0) as errorCount,
        COALESCE(SUM(rr.warning_count), 0) as warningCount,
        (
          SELECT rr2.ruleset_name 
          FROM ruleset_results rr2 
          WHERE rr2.job_id = j.id 
          ORDER BY rr2.id ASC 
          LIMIT 1
        ) as rulesetName,
        (
          SELECT rr2.ruleset_version 
          FROM ruleset_results rr2 
          WHERE rr2.job_id = j.id 
          ORDER BY rr2.id ASC 
          LIMIT 1
        ) as rulesetVersion
      FROM jobs j
      LEFT JOIN ruleset_results rr ON j.id = rr.job_id
      ${whereClause}
      GROUP BY j.id
      ORDER BY j.${sortBy} ${sortOrder.toUpperCase()}
      LIMIT ? OFFSET ?
    `);

    const jobs = listStmt.all(...params, limit, offset) as JobListItem[];

    return { jobs, total: count };
  }

  /**
   * Get job details by ID
   */
  getJobById(jobId: string): JobDetailsResponse | null {
    // Get job record
    const jobStmt = this.db.prepare(`
      SELECT 
        id as jobId,
        document_id as documentId,
        document_name as documentName,
        document_version as documentVersion,
        status,
        created_at as createdAt,
        completed_at as completedAt,
        duration_ms as durationMs
      FROM jobs
      WHERE id = ?
    `);

    const job = jobStmt.get(jobId) as Omit<JobDetailsResponse, 'results' | 'summary' | 'metadata'> | undefined;
    if (!job) {
      return null;
    }

    // Get ruleset results
    const resultsStmt = this.db.prepare(`
      SELECT results_json
      FROM ruleset_results
      WHERE job_id = ?
    `);

    const resultRows = resultsStmt.all(jobId) as { results_json: string }[];
    const results: RulesetResult[] = resultRows.map(row => JSON.parse(row.results_json));

    // Calculate summary
    const summary = {
      totalIssues: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      hintCount: 0,
      durationMs: job.durationMs || 0,
    };

    for (const result of results) {
      summary.totalIssues += result.summary.totalIssues;
      summary.errorCount += result.summary.errorCount;
      summary.warningCount += result.summary.warningCount;
      summary.infoCount += result.summary.infoCount;
      summary.hintCount += result.summary.hintCount;
    }

    // Get metadata
    const metadata = {
      name: job.documentName || 'Unknown',
      version: job.documentVersion || undefined,
    };

    return {
      ...job,
      results,
      summary,
      metadata,
    };
  }

  /**
   * Get total job count
   */
  getTotalJobs(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM jobs');
    const { count } = stmt.get() as { count: number };
    return count;
  }

  /**
   * Health check - verify database is accessible
   */
  healthCheck(): boolean {
    try {
      const stmt = this.db.prepare('SELECT 1');
      stmt.get();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get database file size in bytes (includes WAL and SHM files)
   */
  getDatabaseSize(): number {
    try {
      let totalSize = 0;
      // Main database file
      totalSize += statSync(this.dbPath).size;
      // WAL journal file (used in WAL mode)
      try { totalSize += statSync(`${this.dbPath}-wal`).size; } catch { /* may not exist */ }
      // Shared-memory file
      try { totalSize += statSync(`${this.dbPath}-shm`).size; } catch { /* may not exist */ }
      return totalSize;
    } catch {
      return 0;
    }
  }

  /**
   * Get the absolute path to the database file
   */
  getDatabasePath(): string {
    return this.dbPath;
  }

  /**
   * Get oldest and newest job timestamps
   */
  getJobTimestamps(): { oldest: string | null; newest: string | null } {
    try {
      const result = this.db.prepare(`
        SELECT 
          MIN(created_at) as oldest,
          MAX(created_at) as newest
        FROM jobs
      `).get() as { oldest: string | null; newest: string | null };
      return result;
    } catch {
      return { oldest: null, newest: null };
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Delete jobs older than specified days (for cleanup)
   */
  deleteOldJobs(days: number): number {
    const stmt = this.db.prepare(`
      DELETE FROM jobs 
      WHERE completed_at < datetime('now', '-' || ? || ' days')
    `);

    const result = stmt.run(days);
    return result.changes;
  }
}
