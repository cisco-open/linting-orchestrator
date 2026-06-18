/**
 * PassThroughDocumentStore - Pass-through adapter for external document storage
 * 
 * Features:
 * - Reads documents from an external uploads directory (filesystem access)
 * - Zero-copy architecture (passes file paths to workers)
 * - Optional HTTP fallback for missing documents
 * - Read-only (users upload documents to external system)
 * 
 * Use Case: Integration with external document management (e.g., MCP OpenAPI Analyzer)
 * 
 * Note: This adapter is READ-ONLY. Documents must be uploaded to the external system.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type {
  DocumentStoreAdapter,
  MCPStoreConfig,
  DocumentMetadata as InterfaceDocumentMetadata,
  StoredDocument as InterfaceStoredDocument,
  ListOptions,
  StorageStats,
  StoreResult,
  SearchResult,
  UploadHistory
} from '../interfaces/index.js';
import { isValidDocumentId } from '../utils/validation.js';
import { getLogger } from '../utils/logger.js';
import { UploadHistoryManager } from '../core/upload-history-manager.js';

/**
 * PassThroughDocumentStore - Pass-through to external document storage
 */
export class PassThroughDocumentStore implements DocumentStoreAdapter {
  private config: MCPStoreConfig;
  private logger = getLogger('pass....');
  private uploadHistoryManager?: UploadHistoryManager;

  constructor(config: MCPStoreConfig) {
    this.config = config;
    
    this.logger.info('PassThroughDocumentStore initialized', {
      uploadsDir: this.config.uploadsDir,
      httpFallback: !!this.config.httpFallbackUrl
    });
  }

  async initialize(): Promise<void> {
    // Verify external uploads directory exists
    try {
      await fs.access(this.config.uploadsDir);
      const stats = await fs.stat(this.config.uploadsDir);
      
      if (!stats.isDirectory()) {
        throw new Error(`Uploads path is not a directory: ${this.config.uploadsDir}`);
      }
      
      this.logger.info('PassThrough document store ready', { uploadsDir: this.config.uploadsDir });
    } catch (error) {
      const message = `Uploads directory not found: ${this.config.uploadsDir}\n` +
        'Ensure the external document system is configured and the uploadsDir path is correct';
      this.logger.error(message);
      throw new Error(message);
    }
    
    // Optional: Try to load upload history if available
    await this.initializeHistoryAccess();
  }
  
  /**
   * Initialize upload history access (optional, graceful degradation)
   * Attempts to load upload history from conventional location (../datastore)
   */
  private async initializeHistoryAccess(): Promise<void> {
    try {
      // Assume conventional document-store structure: uploads/../datastore
      const datastoreDir = path.resolve(this.config.uploadsDir, '..');
      const historyDir = path.join(datastoreDir, 'upload-history');
      
      // Check if history directory exists
      await fs.access(historyDir);
      
      // Initialize upload history manager (read-only)
      this.uploadHistoryManager = new UploadHistoryManager(datastoreDir);
      await this.uploadHistoryManager.initialize();
      
      this.logger.info('Upload history loaded (read-only)', { historyDir });
    } catch {
      // Not an error - external system may not use document-store library
      this.logger.info('No upload history available (external system may not track it)');
    }
  }

  async storeDocument(): Promise<StoreResult> {
    const message = 
      'PassThroughDocumentStore is read-only. Upload documents via the external system.' +
      (this.config.httpFallbackUrl ? `\n  Example: curl -X POST ${this.config.httpFallbackUrl}/upload ` +
      '-H "Content-Type: application/x-yaml" --data-binary @api.yaml' : '');
    
    this.logger.error('Attempted to store document in read-only pass-through adapter');
    throw new Error(message);
  }

  async getDocument(documentId: string): Promise<InterfaceStoredDocument | undefined> {
    if (!this.isValidDocumentId(documentId)) {
      throw new Error(`Invalid document ID format: ${documentId}`);
    }

    this.logger.debug('Getting document', { documentId });

    // Try filesystem first (primary path)
    const filePath = this.getDocumentPathSync(documentId);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      const stats = await fs.stat(filePath);
      
      return {
        id: documentId,
        content: parsed,
        metadata: {
          id: documentId,
          filename: 'unknown',
          format: 'json',
          size: stats.size,
          uploadedAt: stats.birthtime,
          updatedAt: stats.mtime,
          openApiVersion: parsed.openapi || parsed.swagger,
          title: parsed.info?.title,
          serverCount: parsed.servers?.length,
          operationCount: this.countOperations(parsed)
        }
      };
    } catch (error) {
      // TODO: Fallback to HTTP if configured
      this.logger.debug('Document not found', { documentId, error });
      return undefined;
    }
  }

  async documentExists(documentId: string): Promise<boolean> {
    if (!this.isValidDocumentId(documentId)) {
      return false;
    }

    const filePath = this.getDocumentPathSync(documentId);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getDocumentPath(documentId: string): Promise<string> {
    if (!this.isValidDocumentId(documentId)) {
      throw new Error(`Invalid document ID format: ${documentId}`);
    }

    const filePath = this.getDocumentPathSync(documentId);
    
    // Verify file exists
    try {
      await fs.access(filePath);
      this.logger.debug('Document path resolved', { documentId, filePath });
      return filePath;
    } catch {
      throw new Error(`Document ${documentId} not found at ${filePath}`);
    }
  }

  async listDocuments(options?: ListOptions): Promise<InterfaceDocumentMetadata[]> {
    this.logger.debug('Listing documents', options);

    try {
      const files = await fs.readdir(this.config.uploadsDir);
      const documentIds = files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
      
      // Load metadata for each document
      const metadata: InterfaceDocumentMetadata[] = [];
      for (const id of documentIds) {
        const doc = await this.getDocument(id);
        if (doc) {
          metadata.push(doc.metadata);
        }
      }

      // Apply filters and pagination
      let filtered = metadata;

      if (options?.tags && options.tags.length > 0) {
        filtered = filtered.filter(m =>
          m.tags && options.tags!.some(tag => m.tags!.includes(tag))
        );
      }

      if (options?.organization) {
        const orgLower = options.organization.toLowerCase();
        filtered = filtered.filter(m =>
          m.organization?.toLowerCase().includes(orgLower)
        );
      }

      if (options?.name) {
        const nameLower = options.name.toLowerCase();
        filtered = filtered.filter(m =>
          m.name?.toLowerCase().includes(nameLower) ||
          m.title?.toLowerCase().includes(nameLower)
        );
      }

      // Sort
      if (options?.sortBy) {
        filtered.sort((a, b) => {
          let cmp = 0;
          if (options.sortBy === 'uploadedAt') {
            cmp = a.uploadedAt.getTime() - b.uploadedAt.getTime();
          } else if (options.sortBy === 'name') {
            cmp = (a.name || '').localeCompare(b.name || '');
          } else if (options.sortBy === 'size') {
            cmp = a.size - b.size;
          }
          return options.sortOrder === 'desc' ? -cmp : cmp;
        });
      }

      // Paginate
      const offset = options?.offset || 0;
      const limit = options?.limit || filtered.length;
      
      return filtered.slice(offset, offset + limit);
    } catch (error) {
      this.logger.error('Failed to list documents', { error });
      throw new Error(`Failed to list documents: ${error}`);
    }
  }

  async searchDocuments(query: string, options?: ListOptions): Promise<SearchResult[]> {
    this.logger.debug('Searching documents', { query, options });

    const allDocs = await this.listDocuments(options);
    const queryLower = query.toLowerCase();

    return allDocs
      .filter(doc =>
        doc.name?.toLowerCase().includes(queryLower) ||
        doc.title?.toLowerCase().includes(queryLower) ||
        doc.description?.toLowerCase().includes(queryLower) ||
        doc.tags?.some(t => t.toLowerCase().includes(queryLower))
      )
      .map(doc => ({
        ...doc,
        score: this.calculateScore(doc, query),
        matchedFields: this.getMatchedFields(doc, query)
      }));
  }

  async updateDocument(): Promise<StoreResult> {
    throw new Error(
      'PassThroughDocumentStore is read-only. Update documents via the external system.'
    );
  }

  async deleteDocument(): Promise<void> {
    throw new Error(
      'PassThroughDocumentStore is read-only. Delete documents via the external system.'
    );
  }

  async getStats(): Promise<StorageStats> {
    const documents = await this.listDocuments();
    const totalSize = documents.reduce((sum, doc) => sum + doc.size, 0);

    return {
      totalDocuments: documents.length,
      totalSize,
      quotaUsedPercent: undefined, // External system manages quota
      cacheHitRate: undefined,
      cachedDocuments: undefined
    };
  }
  
  /**
   * Get upload history for a document (optional feature)
   * Returns empty array if history not available
   */
  async getUploadHistory(documentId: string): Promise<UploadHistory[]> {
    if (!this.uploadHistoryManager) {
      return []; // Graceful degradation
    }
    return this.uploadHistoryManager.getUploadHistory(documentId);
  }
  
  /**
   * Get specific upload event details (optional feature)
   * Returns undefined if history not available
   */
  async getUpload(uploadId: string): Promise<UploadHistory | undefined> {
    if (!this.uploadHistoryManager) {
      return undefined; // Graceful degradation
    }
    return this.uploadHistoryManager.getUpload(uploadId);
  }

  isValidDocumentId(documentId: string): boolean {
    return isValidDocumentId(documentId);
  }

  // Private helper methods

  private getDocumentPathSync(documentId: string): string {
    // External system stores as: uploads/{uuid}.json
    return path.resolve(this.config.uploadsDir, `${documentId}.json`);
  }

  private countOperations(doc: any): number {
    const paths = doc.paths || {};
    let count = 0;
    
    for (const path in paths) {
      for (const method in paths[path]) {
        if (['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].includes(method)) {
          count++;
        }
      }
    }
    
    return count;
  }

  private calculateScore(metadata: InterfaceDocumentMetadata, query: string): number {
    const queryLower = query.toLowerCase();
    let score = 0;

    if (metadata.name?.toLowerCase().includes(queryLower)) score += 0.8;
    if (metadata.title?.toLowerCase().includes(queryLower)) score += 0.6;
    if (metadata.description?.toLowerCase().includes(queryLower)) score += 0.4;
    if (metadata.tags?.some(t => t.toLowerCase().includes(queryLower))) score += 0.4;

    return Math.min(score, 1.0);
  }

  private getMatchedFields(metadata: InterfaceDocumentMetadata, query: string): string[] {
    const queryLower = query.toLowerCase();
    const matched: string[] = [];

    if (metadata.name?.toLowerCase().includes(queryLower)) matched.push('name');
    if (metadata.title?.toLowerCase().includes(queryLower)) matched.push('title');
    if (metadata.description?.toLowerCase().includes(queryLower)) matched.push('description');
    if (metadata.tags?.some(t => t.toLowerCase().includes(queryLower))) matched.push('tags');

    return matched;
  }
}
