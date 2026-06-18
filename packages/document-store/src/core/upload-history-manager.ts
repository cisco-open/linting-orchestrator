/**
 * UploadHistoryManager - Manages audit trail of upload events
 * 
 * Responsibilities:
 * - Record every upload event (even duplicates)
 * - Track filename, user, timestamp, source for each upload
 * - Provide upload history queries
 * - Maintain upload-history index
 */

import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { UploadHistory } from '../interfaces/types.js';
import { getLogger } from '../utils/logger.js';

const MAX_USER_CONTEXT_BYTES = 1024; // 1KB limit

export class UploadHistoryManager {
  private historyDir: string;
  private indexPath: string;
  private uploadIndex = new Map<string, UploadHistory>(); // uploadId -> UploadHistory
  private documentUploads = new Map<string, string[]>(); // documentId -> uploadId[]
  private logger = getLogger('history.');

  constructor(datastoreDir: string) {
    this.historyDir = path.join(datastoreDir, 'upload-history');
    this.indexPath = path.join(datastoreDir, 'upload-history-index.json');
    
    this.logger.debug('UploadHistoryManager initialized', { historyDir: this.historyDir });
  }

  async initialize(): Promise<void> {
    // Create upload-history directory
    await fs.mkdir(this.historyDir, { recursive: true });
    
    // Load existing upload history index
    try {
      const indexData = await fs.readFile(this.indexPath, 'utf-8');
      const index: Record<string, UploadHistory> = JSON.parse(indexData);
      
      // Restore index
      for (const [uploadId, upload] of Object.entries(index)) {
        // Parse dates
        const uploadHistory: UploadHistory = {
          ...upload,
          uploadedAt: new Date(upload.uploadedAt)
        };
        
        this.uploadIndex.set(uploadId, uploadHistory);
        
        // Build documentId -> uploadId mapping
        const documentUploads = this.documentUploads.get(upload.documentId) || [];
        documentUploads.push(uploadId);
        this.documentUploads.set(upload.documentId, documentUploads);
      }
      
      this.logger.info('Upload history index loaded', { 
        totalUploads: this.uploadIndex.size,
        uniqueDocuments: this.documentUploads.size
      });
    } catch (error) {
      this.logger.debug('No existing upload history index, starting fresh');
    }
  }

  /**
   * Record a new upload event
   */
  async recordUpload(options: {
    documentId: string;
    filename: string;
    format: 'json' | 'yaml';
    size: number;
    uploadedBy?: string;
    source?: string;
    userContext?: string;
    tags?: string[];
    organization?: string;
  }): Promise<UploadHistory> {
    // Validate userContext size
    if (options.userContext) {
      const contextBytes = Buffer.byteLength(options.userContext, 'utf-8');
      if (contextBytes > MAX_USER_CONTEXT_BYTES) {
        throw new Error(
          `userContext exceeds maximum size of ${MAX_USER_CONTEXT_BYTES} bytes ` +
          `(provided: ${contextBytes} bytes)`
        );
      }
    }

    const uploadId = randomUUID();
    const uploadHistory: UploadHistory = {
      uploadId,
      documentId: options.documentId,
      uploadedAt: new Date(),
      filename: options.filename,
      format: options.format,
      size: options.size,
      uploadedBy: options.uploadedBy,
      source: options.source,
      userContext: options.userContext,
      tags: options.tags,
      organization: options.organization
    };

    // Save upload history entry
    await this.saveUploadHistory(uploadId, uploadHistory);
    
    // Update in-memory index
    this.uploadIndex.set(uploadId, uploadHistory);
    
    // Update documentId -> uploadId mapping
    const documentUploads = this.documentUploads.get(options.documentId) || [];
    documentUploads.push(uploadId);
    this.documentUploads.set(options.documentId, documentUploads);
    
    // Save index
    await this.saveIndex();
    
    this.logger.info('Upload recorded', {
      uploadId,
      documentId: options.documentId,
      filename: options.filename
    });
    
    return uploadHistory;
  }

  /**
   * Get all uploads for a document
   */
  getUploadHistory(documentId: string): UploadHistory[] {
    const uploadIds = this.documentUploads.get(documentId) || [];
    return uploadIds
      .map(id => this.uploadIndex.get(id))
      .filter((u): u is UploadHistory => u !== undefined)
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()); // Newest first
  }

  /**
   * Get specific upload event
   */
  getUpload(uploadId: string): UploadHistory | undefined {
    return this.uploadIndex.get(uploadId);
  }

  /**
   * Get upload count for a document
   */
  getUploadCount(documentId: string): number {
    return this.documentUploads.get(documentId)?.length || 0;
  }

  /**
   * Get first upload date for a document
   */
  getFirstUploadDate(documentId: string): Date | undefined {
    const uploads = this.getUploadHistory(documentId);
    if (uploads.length === 0) return undefined;
    
    // Sort by oldest first
    const sorted = uploads.sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime());
    return sorted[0].uploadedAt;
  }

  private async saveUploadHistory(uploadId: string, upload: UploadHistory): Promise<void> {
    const filePath = path.join(this.historyDir, `${uploadId}.json`);
    await fs.writeFile(filePath, JSON.stringify(upload, null, 2));
    this.logger.debug('Upload history saved', { uploadId, filePath });
  }

  private async saveIndex(): Promise<void> {
    const index: Record<string, UploadHistory> = {};
    for (const [uploadId, upload] of this.uploadIndex.entries()) {
      index[uploadId] = upload;
    }
    
    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2));
    this.logger.debug('Upload history index saved', { 
      totalUploads: this.uploadIndex.size 
    });
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalUploads: this.uploadIndex.size,
      uniqueDocuments: this.documentUploads.size,
      averageUploadsPerDocument: this.uploadIndex.size / (this.documentUploads.size || 1)
    };
  }
}
