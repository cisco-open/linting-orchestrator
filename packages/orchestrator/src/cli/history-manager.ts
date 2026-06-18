/**
 * History Manager for orchestrator CLI
 * Manages ~/.spectify/history.json for tracking lint operations
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { LintJobResult } from '../types.js';

export interface HistoryEntry {
  jobId: string;
  documentId: string;
  filePath: string;
  rulesetName: string;
  rulesetVersion: string;
  timestamp: string;
  status: 'completed' | 'failed';
  serverUrl: string;       // NEW: Server URL for this entry
  sessionId: string;       // NEW: Runtime session ID from server
  summary: {
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    hintCount: number;
  };
}

export interface History {
  version: string;
  entries: HistoryEntry[];
}

export interface HistoryMetadata {
  version: string;
  lastServerUrl: string;   // Current server configuration
  lastSessionId: string;   // Current session ID from server
}

export class HistoryManager {
  private historyDir: string;
  private historyFile: string;
  private metadataFile: string;

  constructor() {
    this.historyDir = path.join(os.homedir(), '.spectify');
    this.historyFile = path.join(this.historyDir, 'history.json');
    this.metadataFile = path.join(this.historyDir, 'history-metadata.json');
  }

  /**
   * Ensure history directory exists
   */
  private async ensureHistoryDir(): Promise<void> {
    try {
      await fs.mkdir(this.historyDir, { recursive: true });
    } catch (error) {
      // Ignore if already exists
    }
  }

  /**
   * Load history from file
   */
  private async loadHistory(): Promise<History> {
    try {
      const content = await fs.readFile(this.historyFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      // Return empty history if file doesn't exist
      return {
        version: '1.0',
        entries: [],
      };
    }
  }

  /**
   * Save history to file
   */
  private async saveHistory(history: History): Promise<void> {
    await this.ensureHistoryDir();
    await fs.writeFile(this.historyFile, JSON.stringify(history, null, 2));
  }

  /**
   * Add a new entry to history
   * Auto-clears history if server URL or session ID changed
   */
  async addEntry(
    entry: Omit<HistoryEntry, 'timestamp' | 'serverUrl' | 'sessionId'>,
    serverUrl: string,
    sessionId: string
  ): Promise<void> {
    const metadata = await this.loadMetadata();
    
    // Check for server configuration or session change
    const serverChanged = serverUrl !== metadata.lastServerUrl;
    const sessionChanged = sessionId !== metadata.lastSessionId;
    
    if (serverChanged || sessionChanged) {
      // Clear history - fresh start
      await this.clearHistory();
      
      // Show notification (clear user feedback)
      if (serverChanged) {
        if (metadata.lastServerUrl) {
          console.log(`📝 History cleared (server changed from ${metadata.lastServerUrl} to ${serverUrl})`);
        }
      } else {
        console.log('📝 History cleared (server restarted)');
      }
      
      // Update metadata (new server/session = new history)
      metadata.lastServerUrl = serverUrl;
      metadata.lastSessionId = sessionId;
      await this.saveMetadata(metadata);
    }
    
    // Load current history (may be empty if just cleared)
    const history = await this.loadHistory();
    
    const newEntry: HistoryEntry = {
      ...entry,
      serverUrl,
      sessionId,
      timestamp: new Date().toISOString(),
    };

    // Add to beginning of list
    history.entries.unshift(newEntry);

    // Keep only last 100 entries
    history.entries = history.entries.slice(0, 100);

    await this.saveHistory(history);
  }

  /**
   * Load history metadata
   */
  private async loadMetadata(): Promise<HistoryMetadata> {
    try {
      const content = await fs.readFile(this.metadataFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      // First run or old version - return empty metadata
      return {
        version: '1.0',
        lastServerUrl: '',
        lastSessionId: ''
      };
    }
  }

  /**
   * Save history metadata
   */
  private async saveMetadata(metadata: HistoryMetadata): Promise<void> {
    await this.ensureHistoryDir();
    await fs.writeFile(this.metadataFile, JSON.stringify(metadata, null, 2));
  }

  /**
   * Clear all history entries
   */
  async clearHistory(): Promise<void> {
    const emptyHistory: History = {
      version: '1.0',
      entries: []
    };
    await this.saveHistory(emptyHistory);
  }

  /**
   * Called when user explicitly changes CLI configuration
   * Clears history immediately on server URL change
   */
  async onConfigChange(newServerUrl: string): Promise<void> {
    const metadata = await this.loadMetadata();
    
    if (newServerUrl !== metadata.lastServerUrl) {
      // Clear history immediately on config change
      await this.clearHistory();
      console.log('📝 History cleared (server configuration changed)');
      
      // Reset metadata (session will be captured on next API call)
      metadata.lastServerUrl = newServerUrl;
      metadata.lastSessionId = '';  // Unknown until first API call
      await this.saveMetadata(metadata);
    }
  }

  /**
   * Get recent entries
   */
  async getRecent(limit: number = 10): Promise<HistoryEntry[]> {
    const history = await this.loadHistory();
    return history.entries.slice(0, limit);
  }

  /**
   * Get entry by job ID
   */
  async getById(jobId: string): Promise<HistoryEntry | undefined> {
    const history = await this.loadHistory();
    return history.entries.find(entry => entry.jobId === jobId);
  }

  /**
   * Search history by file path
   */
  async searchByFile(filePath: string): Promise<HistoryEntry[]> {
    const history = await this.loadHistory();
    const normalizedPath = path.resolve(filePath);
    return history.entries.filter(entry => 
      path.resolve(entry.filePath) === normalizedPath
    );
  }

  /**
   * Search history by ruleset
   */
  async searchByRuleset(rulesetName: string): Promise<HistoryEntry[]> {
    const history = await this.loadHistory();
    return history.entries.filter(entry => entry.rulesetName === rulesetName);
  }

  /**
   * Clear all history
   */
  async clear(): Promise<void> {
    const history: History = {
      version: '1.0',
      entries: [],
    };
    await this.saveHistory(history);
  }

  /**
   * Create history entry from lint result
   */
  static createEntry(
    result: LintJobResult,
    filePath: string
  ): Omit<HistoryEntry, 'timestamp' | 'serverUrl' | 'sessionId'> {
    return {
      jobId: result.jobId,
      documentId: result.documentId,
      filePath,
      rulesetName: result.rulesetName,
      rulesetVersion: result.rulesetVersion,
      status: result.status === 'completed' || result.status === 'failed' ? result.status : 'completed',
      summary: {
        totalIssues: result.summary.totalIssues,
        errorCount: result.summary.errorCount,
        warningCount: result.summary.warningCount,
        infoCount: result.summary.infoCount,
        hintCount: result.summary.hintCount,
      },
    };
  }
}
