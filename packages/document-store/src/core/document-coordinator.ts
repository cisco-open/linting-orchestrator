/**
 * DocumentCoordinator - Orchestrates cache and datastore
 * 
 * Responsibilities:
 * - Unified API for document operations
 * - Cache-aside pattern: check cache, fallback to datastore
 * - Write-through: write to datastore, then cache
 * - Invalidation: remove from cache on update/delete
 * 
 * This is the main interface used by HTTP and MCP servers
 */

import { DatastoreManager, DocumentMetadata, StoredDocument } from './datastore-manager.js';
import { DocumentCache } from './document-cache.js';
import { getLogger } from '../utils/logger.js';
import type { StoreResult, UploadHistory } from '../interfaces/types.js';

export class DocumentCoordinator {
  private datastore: DatastoreManager;
  private cache: DocumentCache;
  private logger = getLogger('coord...');

  constructor(datastoreDir: string, quotaGB: number = 10, cacheMaxSize: number = 100) {
    this.datastore = new DatastoreManager(datastoreDir, quotaGB);
    this.cache = new DocumentCache(cacheMaxSize);
    this.logger.debug('DocumentCoordinator initialized');
  }

  async initialize(): Promise<void> {
    await this.datastore.initialize();
    this.logger.info('DocumentCoordinator ready');
  }

  /**
   * Get document - Cache-aside pattern
   * 1. Check cache
   * 2. On miss, load from datastore
   * 3. Populate cache
   */
  async getDocument(id: string): Promise<StoredDocument | undefined> {
    // Try cache first
    let doc = this.cache.get(id);
    if (doc) {
      return doc;
    }

    // Cache miss - load from datastore
    this.logger.debug(`Loading document from datastore: ${id}`);
    doc = await this.datastore.getDocument(id);
    if (!doc) {
      return undefined;
    }

    // Populate cache
    this.cache.set(id, doc);
    return doc;
  }

  /**
   * Store document - Write-through pattern
   * 1. Write to datastore (source of truth)
   * 2. Populate cache
   */
  async storeDocument(
    content: string,
    format: 'json' | 'yaml',
    options: {
      filename: string;
      name?: string;
      tags?: string[];
      owner?: string;
      organization?: string;
      description?: string;
      uploadedBy?: string;
      source?: string;
      userContext?: Record<string, unknown>;
    }
  ): Promise<StoreResult> {
    this.logger.debug(`Storing document: ${options.filename}`);
    
    // Write to datastore first (source of truth)
    const result = await this.datastore.storeDocument(content, format, options);
    
    // Load into cache
    const doc = await this.datastore.getDocument(result.documentId);
    if (doc) {
      this.cache.set(result.documentId, doc);
    }
    
    this.logger.info(`Document stored and cached: ${result.documentId} (uploadId: ${result.uploadId}, isDuplicate: ${result.isDuplicate})`);
    return result;
  }

  /**
   * Update document - Write-through + invalidation
   * 1. Update datastore (creates new version)
   * 2. Invalidate old version in cache
   * 3. Load new version into cache
   */
  async updateDocument(
    id: string,
    content: string,
    format: 'json' | 'yaml',
    options: Partial<DocumentMetadata>
  ): Promise<string> {
    this.logger.debug(`Updating document: ${id}`);
    
    // Update datastore (creates new version)
    const newId = await this.datastore.updateDocument(id, content, format, options);
    
    // Invalidate old version
    this.cache.invalidate(id);
    
    // Load new version into cache
    const doc = await this.datastore.getDocument(newId);
    if (doc) {
      this.cache.set(newId, doc);
    }
    
    this.logger.info(`Document updated: ${id} → ${newId}`);
    return newId;
  }

  /**
   * Delete document - Write-through + invalidation
   * 1. Delete from datastore
   * 2. Invalidate cache
   */
  async deleteDocument(id: string): Promise<void> {
    this.logger.debug(`Deleting document: ${id}`);
    
    // Delete from datastore
    await this.datastore.deleteDocument(id);
    
    // Invalidate cache
    this.cache.invalidate(id);
    
    this.logger.info(`Document deleted: ${id}`);
  }

  /**
   * Search operations - Always query datastore (source of truth)
   * Cache is for document content only, not search
   */
  searchDocuments(query: {
    name?: string;
    tags?: string[];
    organization?: string;
    version?: string;
    isLatest?: boolean;
  }): DocumentMetadata[] {
    return this.datastore.searchDocuments(query);
  }

  /**
   * List documents - Always query datastore
   */
  listDocuments(options: {
    limit?: number;
    offset?: number;
    sortBy?: 'name' | 'uploadedAt' | 'updatedAt';
    sortOrder?: 'asc' | 'desc';
  } = {}): DocumentMetadata[] {
    return this.datastore.listDocuments(options);
  }

  /**
   * Get version history - Always query datastore
   */
  getVersionHistory(id: string): DocumentMetadata[] {
    return this.datastore.getVersionHistory(id);
  }

  /**
   * Get stats - Combined cache + datastore stats
   */
  getStats() {
    return {
      cache: this.cache.getStats(),
      datastore: this.datastore.getStats(),
    };
  }

  /**
   * Get upload history for a document
   */
  async getUploadHistory(documentId: string): Promise<UploadHistory[]> {
    return this.datastore.getUploadHistory(documentId);
  }

  /**
   * Get a specific upload record
   */
  async getUpload(uploadId: string): Promise<UploadHistory | undefined> {
    return this.datastore.getUpload(uploadId);
  }

  /**
   * Get absolute filesystem path for a document.
   * Used by external tools (e.g., oasdiff) that need direct file access.
   * Delegates to DatastoreManager to keep path construction encapsulated.
   * 
   * @param id - Document UUID
   * @returns Absolute path to the document JSON file
   * @throws Error if document not found
   */
  getDocumentPath(id: string): string {
    return this.datastore.getDocumentPath(id);
  }

  /**
   * Cleanup - Clear cache and close resources
   */
  destroy(): void {
    this.cache.destroy();
    this.logger.info('DocumentCoordinator destroyed');
  }
}
