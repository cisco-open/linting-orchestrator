/**
 * Pending notification storage
 * Stores failed notifications locally as JSON files for retry
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import type { JobNotification, PendingNotification } from './types.js';

export class PendingStorage {
  private pendingDir: string;
  private deadLetterDir: string;

  constructor(pendingDir: string, deadLetterDir?: string) {
    this.pendingDir = pendingDir;
    this.deadLetterDir = deadLetterDir ?? join(pendingDir, '..', 'dead-letter-reports');
  }

  /**
   * Initialize storage directories (pending + dead-letter)
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.pendingDir, { recursive: true });
      await fs.mkdir(this.deadLetterDir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create storage directories: ${error}`);
    }
  }

  /**
   * Store a pending notification
   */
  async store(notification: JobNotification): Promise<void> {
    const pending: PendingNotification = {
      notification,
      attempts: 0,
      lastAttempt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const filename = `${notification.jobId}.json`;
    const filepath = join(this.pendingDir, filename);

    try {
      await fs.writeFile(filepath, JSON.stringify(pending, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to store pending notification: ${error}`);
    }
  }

  /**
   * List all pending notifications
   */
  async list(): Promise<PendingNotification[]> {
    try {
      const files = await fs.readdir(this.pendingDir);
      const pending: PendingNotification[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filepath = join(this.pendingDir, file);
          const content = await fs.readFile(filepath, 'utf-8');
          const notification = JSON.parse(content) as PendingNotification;
          pending.push(notification);
        } catch (error) {
          // Skip invalid JSON files - they shouldn't be there
          console.warn(`Skipping invalid pending notification file: ${file}`, error);
          continue;
        }
      }

      return pending;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to list pending notifications: ${error}`);
    }
  }

  /**
   * Update a pending notification's attempt count
   */
  async updateAttempt(jobId: string): Promise<void> {
    const filepath = join(this.pendingDir, `${jobId}.json`);

    try {
      const content = await fs.readFile(filepath, 'utf-8');
      const pending = JSON.parse(content) as PendingNotification;

      pending.attempts += 1;
      pending.lastAttempt = new Date().toISOString();

      await fs.writeFile(filepath, JSON.stringify(pending, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to update pending notification: ${error}`);
    }
  }

  /**
   * Remove a pending notification (after successful retry)
   */
  async remove(jobId: string): Promise<void> {
    const filepath = join(this.pendingDir, `${jobId}.json`);

    try {
      await fs.unlink(filepath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Failed to remove pending notification: ${error}`);
      }
    }
  }

  /**
   * Get count of pending notifications
   */
  async count(): Promise<number> {
    const pending = await this.list();
    return pending.length;
  }

  /**
   * Clear all pending notifications
   */
  async clear(): Promise<number> {
    const pending = await this.list();
    
    for (const item of pending) {
      await this.remove(item.notification.jobId);
    }

    return pending.length;
  }

  /**
   * Move a notification to the dead-letter directory
   * Used for permanently failed notifications (e.g., 413, 400, 422)
   */
  async moveToDeadLetter(jobId: string, reason: string): Promise<void> {
    const srcPath = join(this.pendingDir, `${jobId}.json`);
    const dstPath = join(this.deadLetterDir, `${jobId}.json`);

    try {
      const content = await fs.readFile(srcPath, 'utf-8');
      const pending = JSON.parse(content) as PendingNotification & { deadLetterReason?: string; movedAt?: string };

      // Annotate with dead-letter metadata
      pending.deadLetterReason = reason;
      pending.movedAt = new Date().toISOString();

      await fs.writeFile(dstPath, JSON.stringify(pending, null, 2), 'utf-8');
      await fs.unlink(srcPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return; // Source file already gone, nothing to move
      }
      throw new Error(`Failed to move notification to dead-letter: ${error}`);
    }
  }

  /**
   * Count dead-letter notifications
   */
  async deadLetterCount(): Promise<number> {
    try {
      const files = await fs.readdir(this.deadLetterDir);
      return files.filter(f => f.endsWith('.json')).length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return 0;
      }
      throw new Error(`Failed to count dead-letter notifications: ${error}`);
    }
  }

  /**
   * List all dead-letter notifications
   */
  async listDeadLetter(): Promise<PendingNotification[]> {
    try {
      const files = await fs.readdir(this.deadLetterDir);
      const items: PendingNotification[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filepath = join(this.deadLetterDir, file);
          const content = await fs.readFile(filepath, 'utf-8');
          items.push(JSON.parse(content) as PendingNotification);
        } catch {
          continue;
        }
      }

      return items;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to list dead-letter notifications: ${error}`);
    }
  }
}
