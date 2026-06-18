/**
 * LocalDocumentStore - Filesystem-based storage with caching
 * 
 * Features:
 * - Built-in document storage (no external dependencies)
 * - Persistent datastore with versioning
 * - In-memory caching with LRU eviction and TTL
 * - Rich metadata tracking and search
 * - Quota enforcement
 * 
 * Use Case: Standalone mode - service manages its own documents
 */

import path from 'path';
import type {
  DocumentStoreAdapter,
  LocalStoreConfig,
  DocumentMetadata as InterfaceDocumentMetadata,
  StoredDocument as InterfaceStoredDocument,
  ListOptions,
  StorageStats,
  StoreResult,
  SearchResult,
  UploadHistory
} from '../interfaces/index.js';
import { DocumentCoordinator } from '../core/document-coordinator.js';
import { isValidDocumentId } from '../utils/validation.js';
import { getLogger } from '../utils/logger.js';

export class LocalDocumentStore implements DocumentStoreAdapter {
  private coordinator: DocumentCoordinator;
  private logger = getLogger('store...');
  private config: LocalStoreConfig;

  constructor(config: LocalStoreConfig = {}) {
    // Apply defaults
    const uploadsDir = config.uploadsDir || './uploads';
    const quotaGB = config.quotaGB || 10;
    const cacheMaxSize = config.cacheMaxSize || 100;
    
    this.config = {
      uploadsDir,
      quotaGB,
      cacheMaxSize,
      cacheTTLHours: config.cacheTTLHours || 1,
      enableVersioning: config.enableVersioning || false,
      documentTTLHours: config.documentTTLHours
    };

    this.coordinator = new DocumentCoordinator(
      uploadsDir,
      quotaGB,
      cacheMaxSize
    );

    this.logger.info('LocalDocumentStore initialized', {
      uploadsDir: this.config.uploadsDir,
      quotaGB: this.config.quotaGB,
      cacheMaxSize: this.config.cacheMaxSize
    });
  }

  async initialize(): Promise<void> {
    await this.coordinator.initialize();
    this.logger.info('LocalDocumentStore ready');
  }

  async storeDocument(
    content: string,
    format: 'json' | 'yaml',
    metadata?: Partial<InterfaceDocumentMetadata>
  ): Promise<StoreResult> {
    this.logger.debug('Storing document', { format, filename: metadata?.filename });

    const result = await this.coordinator.storeDocument(content, format, {
      filename: metadata?.filename || 'openapi-spec',
      name: metadata?.name,
      tags: metadata?.tags || [],
      owner: metadata?.owner,
      organization: metadata?.organization,
      description: metadata?.description,
      uploadedBy: metadata?.uploadedBy,
      source: metadata?.source,
      userContext: metadata?.userContext
    });

    this.logger.info('Document stored', { 
      documentId: result.documentId, 
      uploadId: result.uploadId,
      isDuplicate: result.isDuplicate 
    });
    return result;
  }

  async getDocument(documentId: string): Promise<InterfaceStoredDocument | undefined> {
    if (!this.isValidDocumentId(documentId)) {
      throw new Error(`Invalid document ID format: ${documentId}`);
    }

    this.logger.debug('Getting document', { documentId });
    const doc = await this.coordinator.getDocument(documentId);
    
    if (!doc) {
      this.logger.debug('Document not found', { documentId });
      return undefined;
    }

    // Map internal format to interface format
    return {
      id: doc.id,
      content: doc.content,
      metadata: this.mapMetadata(doc.metadata)
    };
  }

  async documentExists(documentId: string): Promise<boolean> {
    if (!this.isValidDocumentId(documentId)) {
      return false;
    }

    const doc = await this.getDocument(documentId);
    return doc !== undefined;
  }

  async getDocumentPath(documentId: string): Promise<string> {
    if (!this.isValidDocumentId(documentId)) {
      throw new Error(`Invalid document ID format: ${documentId}`);
    }

    // Documents are stored as: uploadsDir/documents/{id}.json
    const uploadsDir = this.config.uploadsDir || './uploads';
    const filePath = path.resolve(uploadsDir, 'documents', `${documentId}.json`);
    
    // Verify document exists
    if (!await this.documentExists(documentId)) {
      throw new Error(`Document ${documentId} not found`);
    }

    this.logger.debug('Document path resolved', { documentId, filePath });
    return filePath;
  }

  async listDocuments(options?: ListOptions): Promise<InterfaceDocumentMetadata[]> {
    this.logger.debug('Listing documents', options);

    const results = this.coordinator.listDocuments({
      limit: options?.limit,
      offset: options?.offset,
      sortBy: options?.sortBy as 'name' | 'uploadedAt' | 'updatedAt',
      sortOrder: options?.sortOrder
    });

    // Apply additional filters
    let filtered = results;

    if (options?.tags && options.tags.length > 0) {
      filtered = filtered.filter(doc =>
        options.tags!.some(tag => doc.tags.includes(tag))
      );
    }

    if (options?.organization) {
      const orgLower = options.organization.toLowerCase();
      filtered = filtered.filter(doc =>
        doc.organization?.toLowerCase().includes(orgLower)
      );
    }

    if (options?.name) {
      const nameLower = options.name.toLowerCase();
      filtered = filtered.filter(doc =>
        doc.name.toLowerCase().includes(nameLower) ||
        doc.title.toLowerCase().includes(nameLower)
      );
    }

    return filtered.map(m => this.mapMetadata(m));
  }

  async searchDocuments(query: string, options?: ListOptions): Promise<SearchResult[]> {
    this.logger.debug('Searching documents', { query, options });

    // Use coordinator's search functionality
    const results = this.coordinator.searchDocuments({
      name: query,
      tags: options?.tags,
      organization: options?.organization
    });

    return results.map(m => ({
      ...this.mapMetadata(m),
      score: this.calculateRelevanceScore(m, query),
      matchedFields: this.getMatchedFields(m, query)
    }));
  }

  async updateDocument(
    documentId: string,
    content: string,
    format: 'json' | 'yaml',
    metadata?: Partial<InterfaceDocumentMetadata>
  ): Promise<StoreResult> {
    if (!this.isValidDocumentId(documentId)) {
      throw new Error(`Invalid document ID format: ${documentId}`);
    }

    this.logger.debug('Updating document', { documentId, format });

    const newId = await this.coordinator.updateDocument(documentId, content, format, {
      filename: metadata?.filename,
      name: metadata?.name,
      tags: metadata?.tags,
      owner: metadata?.owner,
      organization: metadata?.organization,
      description: metadata?.description,
      uploadedBy: metadata?.uploadedBy,
      source: metadata?.source,
      userContext: metadata?.userContext
    });

    this.logger.info('Document updated', { oldId: documentId, newId });

    // updateDocument returns the new document ID (string), so we need to construct StoreResult
    // Note: This is an update, not a new upload, so we return created: true
    return {
      documentId: newId,
      uploadId: '', // Updates don't have uploadId in current design
      created: true,
      isDuplicate: false,
      uploadCount: 1
    };
  }

  async deleteDocument(documentId: string): Promise<void> {
    if (!this.isValidDocumentId(documentId)) {
      throw new Error(`Invalid document ID format: ${documentId}`);
    }

    this.logger.debug('Deleting document', { documentId });
    await this.coordinator.deleteDocument(documentId);
    this.logger.info('Document deleted', { documentId });
  }

  async getStats(): Promise<StorageStats> {
    const stats = this.coordinator.getStats();

    return {
      totalDocuments: stats.datastore.totalDocuments,
      totalSize: stats.datastore.totalSizeBytes,
      quotaUsedPercent: stats.datastore.usagePercent,
      cacheHitRate: undefined, // Would need to track hits/misses
      cachedDocuments: stats.cache.size
    };
  }

  async cleanup(): Promise<number> {
    // TODO: Implement TTL-based cleanup if documentTTLHours is set
    this.logger.debug('Cleanup requested (not yet implemented)');
    return 0;
  }

  isValidDocumentId(documentId: string): boolean {
    return isValidDocumentId(documentId);
  }

  /**
   * Map internal metadata format to interface format
   */
  private mapMetadata(internal: any): InterfaceDocumentMetadata {
    return {
      id: internal.id,
      filename: internal.filename,
      format: internal.format,
      size: internal.size,
      uploadedAt: internal.uploadedAt,
      updatedAt: internal.updatedAt,
      name: internal.name,
      version: internal.version,
      tags: internal.tags,
      organization: internal.organization,
      description: internal.description,
      owner: internal.owner,
      openApiVersion: internal.openApiVersion,
      title: internal.title,
      serverCount: internal.servers?.length,
      operationCount: internal.stats?.operationCount
    };
  }

  /**
   * Calculate relevance score for search results
   */
  private calculateRelevanceScore(metadata: any, query: string): number {
    const queryLower = query.toLowerCase();
    let score = 0;

    // Exact name match
    if (metadata.name.toLowerCase() === queryLower) {
      score += 1.0;
    } else if (metadata.name.toLowerCase().includes(queryLower)) {
      score += 0.8;
    }

    // Title match
    if (metadata.title.toLowerCase().includes(queryLower)) {
      score += 0.6;
    }

    // Tag match
    if (metadata.tags.some((t: string) => t.toLowerCase().includes(queryLower))) {
      score += 0.4;
    }

    // Description match
    if (metadata.description?.toLowerCase().includes(queryLower)) {
      score += 0.3;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Get matched fields for search results
   */
  private getMatchedFields(metadata: any, query: string): string[] {
    const queryLower = query.toLowerCase();
    const matched: string[] = [];

    if (metadata.name.toLowerCase().includes(queryLower)) {
      matched.push('name');
    }
    if (metadata.title.toLowerCase().includes(queryLower)) {
      matched.push('title');
    }
    if (metadata.tags.some((t: string) => t.toLowerCase().includes(queryLower))) {
      matched.push('tags');
    }
    if (metadata.description?.toLowerCase().includes(queryLower)) {
      matched.push('description');
    }
    if (metadata.organization?.toLowerCase().includes(queryLower)) {
      matched.push('organization');
    }

    return matched;
  }

  /**
   * Get upload history for a document
   */
  async getUploadHistory(documentId: string): Promise<UploadHistory[]> {
    if (!this.isValidDocumentId(documentId)) {
      throw new Error(`Invalid document ID format: ${documentId}`);
    }
    return this.coordinator.getUploadHistory(documentId);
  }

  /**
   * Get a specific upload record
   */
  async getUpload(uploadId: string): Promise<UploadHistory | undefined> {
    return this.coordinator.getUpload(uploadId);
  }

  /**
   * Destroy coordinator and cleanup resources
   */
  destroy(): void {
    this.coordinator.destroy();
    this.logger.info('LocalDocumentStore destroyed');
  }
}
