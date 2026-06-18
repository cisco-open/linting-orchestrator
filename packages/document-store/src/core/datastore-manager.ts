/**
 * DatastoreManager - Persistent storage layer (NO caching)
 * 
 * Responsibilities:
 * - Store documents permanently (no TTL)
 * - Manage metadata and versions
 * - Provide search/query capabilities
 * - Abstract storage backend (file system, future: DB)
 * - Enforce storage quota (10GB default)
 * 
 * Design principle: This is ONLY storage, not cache
 */

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { parse as parseYAML } from 'yaml';
import { getLogger } from '../utils/logger.js';
import { UploadHistoryManager } from './upload-history-manager.js';
import type { StoreResult, UploadHistory } from '../interfaces/types.js';

export interface DocumentMetadata {
  // Core identifiers
  id: string;
  name: string;
  version: string;
  
  // Upload info
  uploadedAt: Date;
  updatedAt: Date;
  filename: string;
  format: 'json' | 'yaml';
  size: number;
  checksum: string;
  
  // Classification
  tags: string[];
  owner?: string;
  organization?: string;
  description?: string;
  uploadedBy?: string;
  source?: string;
  userContext?: Record<string, unknown>;
  
  // Versioning
  previousVersions: string[];
  isLatest: boolean;
  
  // OpenAPI metadata (extracted)
  openApiVersion: string;
  title: string;
  apiVersion: string;
  servers: string[];
  
  // Statistics (cached for performance)
  stats: {
    operationCount: number;
    schemaCount: number;
    securitySchemeCount: number;
    tagCount: number;
  };
}

export interface StoredDocument {
  id: string;
  content: any;
  metadata: DocumentMetadata;
}

interface SearchIndex {
  byName: { [key: string]: string[] };
  byOrg: { [key: string]: string[] };
  byTag: { [key: string]: string[] };
  byVersion: { [key: string]: string[] };
}

export class DatastoreManager {
  private dataDir: string;
  private documentsDir: string;
  private metadataPath: string;
  private searchIndexPath: string;
  private quotaBytes: number;
  private logger = getLogger('persist.');
  private uploadHistoryManager: UploadHistoryManager;
  
  // In-memory caches of metadata and index
  private metadata = new Map<string, DocumentMetadata>();
  private searchIndex: SearchIndex = {
    byName: {},
    byOrg: {},
    byTag: {},
    byVersion: {}
  };

  constructor(dataDir: string = './datastore', quotaGB: number = 10) {
    this.dataDir = dataDir;
    this.documentsDir = path.join(dataDir, 'documents');
    this.metadataPath = path.join(dataDir, 'metadata.json');
    this.searchIndexPath = path.join(dataDir, 'search-index.json');
    this.quotaBytes = quotaGB * 1024 * 1024 * 1024;
    this.uploadHistoryManager = new UploadHistoryManager(dataDir);
    this.logger.debug(`DatastoreManager initialized with quota=${quotaGB}GB`);
  }

  async initialize(): Promise<void> {
    this.logger.debug('Initializing datastore...');
    
    // Create directory structure
    await fs.mkdir(this.documentsDir, { recursive: true });
    
    // Load or create metadata
    await this.loadMetadata();
    
    // Build search index
    await this.loadSearchIndex();
    
    // Initialize upload history manager
    await this.uploadHistoryManager.initialize();
    
    this.logger.info('Datastore initialized', {
      totalDocuments: this.metadata.size,
      dataDir: this.dataDir,
    });
  }

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
    
    // Check storage quota before storing
    const currentSize = this.getCurrentStorageSize();
    const newDocSize = content.length;
    
    if (currentSize + newDocSize > this.quotaBytes) {
      const usagePercent = Math.round((currentSize / this.quotaBytes) * 100);
      const errorMsg = `Storage quota exceeded: ${usagePercent}% used (${this.formatBytes(currentSize)} / ${this.formatBytes(this.quotaBytes)}). Cannot store document of size ${this.formatBytes(newDocSize)}.`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    // Warn at 80% capacity
    if (currentSize + newDocSize > this.quotaBytes * 0.8) {
      const usagePercent = Math.round(((currentSize + newDocSize) / this.quotaBytes) * 100);
      this.logger.warn(`Storage quota warning: ${usagePercent}% used. Consider running cleanup script.`);
    }
    
    // Parse the content
    let parsed: any;
    try {
      if (format === 'json') {
        parsed = JSON.parse(content);
      } else {
        parsed = parseYAML(content);
      }
      this.logger.debug('Document parsed successfully');
    } catch (error) {
      this.logger.error(`Failed to parse ${format.toUpperCase()}: ${error}`);
      throw new Error(`Failed to parse ${format.toUpperCase()}: ${error}`);
    }

    // Validate it's an OpenAPI document
    if (!parsed.openapi && !parsed.swagger) {
      this.logger.error('Not a valid OpenAPI/Swagger document');
      throw new Error('Not a valid OpenAPI/Swagger document');
    }

    // Extract metadata from OpenAPI
    const extractedMeta = this.extractOpenAPIMetadata(parsed);
    
    // Generate checksum
    const checksum = this.calculateChecksum(content);
    
    // Check for duplicates
    const existing = this.findByChecksum(checksum);
    const isDuplicate = !!existing;
    const documentId = existing?.id || randomUUID();
    
    // Serialize userContext if provided
    const serializedContext = options.userContext 
      ? JSON.stringify(options.userContext)
      : undefined;
    
    // Record upload in history (even for duplicates)
    const uploadHistory = await this.uploadHistoryManager.recordUpload({
      documentId,
      filename: options.filename,
      format,
      size: content.length,
      uploadedBy: options.uploadedBy,
      source: options.source,
      userContext: serializedContext,
      tags: options.tags,
      organization: options.organization
    });
    
    if (isDuplicate) {
      this.logger.info(`Duplicate document detected: ${documentId}`);
      
      // Get upload statistics
      const uploadCount = await this.uploadHistoryManager.getUploadCount(documentId);
      const firstUpload = await this.uploadHistoryManager.getFirstUploadDate(documentId);
      
      return {
        documentId,
        uploadId: uploadHistory.uploadId,
        created: false,
        isDuplicate: true,
        existingSince: firstUpload,
        uploadCount
      };
    }
    
    // Create document ID (already assigned above)
    const id = documentId;
    
    // Create metadata
    const metadata: DocumentMetadata = {
      id,
      name: options.name || extractedMeta.title || options.filename,
      version: extractedMeta.apiVersion,
      uploadedAt: new Date(),
      updatedAt: new Date(),
      filename: options.filename,
      format,
      size: content.length,
      checksum,
      tags: options.tags || [],
      owner: options.owner,
      organization: options.organization,
      description: options.description,
      previousVersions: [],
      isLatest: true,
      ...extractedMeta,
      stats: this.calculateStats(parsed)
    };
    
    // Save document to disk
    await this.saveDocument(id, parsed);
    
    // Update metadata
    this.metadata.set(id, metadata);
    await this.saveMetadata();
    
    // Update search index
    this.updateSearchIndex(metadata);
    await this.saveSearchIndex();
    
    this.logger.info(`Document stored: ${id} (${options.filename})`);
    
    return {
      documentId: id,
      uploadId: uploadHistory.uploadId,
      created: true,
      isDuplicate: false,
      uploadCount: 1
    };
  }

  async getDocument(id: string): Promise<StoredDocument | undefined> {
    this.logger.debug(`Retrieving document: ${id}`);
    
    const metadata = this.metadata.get(id);
    if (!metadata) {
      this.logger.debug(`Document not found: ${id}`);
      return undefined;
    }

    const content = await this.loadDocument(id);
    if (!content) {
      this.logger.warn(`Document metadata exists but file not found: ${id}`);
      return undefined;
    }

    this.logger.debug(`Document retrieved: ${id}`);
    return { id, content, metadata };
  }

  async updateDocument(
    id: string,
    content: string,
    format: 'json' | 'yaml',
    options: Partial<DocumentMetadata>
  ): Promise<string> {
    this.logger.debug(`Updating document: ${id}`);
    
    const oldMeta = this.metadata.get(id);
    if (!oldMeta) {
      throw new Error(`Document not found: ${id}`);
    }
    
    // Create new version
    const result = await this.storeDocument(content, format, {
      filename: options.filename || oldMeta.filename,
      name: options.name || oldMeta.name,
      tags: options.tags || oldMeta.tags,
      owner: options.owner || oldMeta.owner,
      organization: options.organization || oldMeta.organization,
      description: options.description || oldMeta.description,
      uploadedBy: options.uploadedBy,
      source: options.source,
      userContext: options.userContext
    });
    
    // Link as new version
    const newMeta = this.metadata.get(result.documentId)!;
    newMeta.previousVersions = [id, ...oldMeta.previousVersions];
    
    // Mark old version as not latest
    oldMeta.isLatest = false;
    
    await this.saveMetadata();
    
    this.logger.info(`Document updated: ${id} → ${result.documentId}`);
    return result.documentId;
  }

  async deleteDocument(id: string): Promise<void> {
    this.logger.debug(`Deleting document: ${id}`);
    
    const meta = this.metadata.get(id);
    if (!meta) {
      throw new Error(`Document not found: ${id}`);
    }
    
    // Remove document file
    const docPath = path.join(this.documentsDir, `${id}.json`);
    try {
      await fs.unlink(docPath);
      this.logger.debug(`Deleted document file: ${docPath}`);
    } catch (error) {
      this.logger.warn(`Failed to delete document file: ${error}`);
    }
    
    // Remove from metadata
    this.metadata.delete(id);
    await this.saveMetadata();
    
    // Update search index
    this.removeFromSearchIndex(meta);
    await this.saveSearchIndex();
    
    this.logger.info(`Document deleted: ${id}`);
  }

  searchDocuments(query: {
    name?: string;
    tags?: string[];
    organization?: string;
    version?: string;
    isLatest?: boolean;
  }): DocumentMetadata[] {
    let results = Array.from(this.metadata.values());
    
    if (query.name) {
      const lowerName = query.name.toLowerCase();
      results = results.filter(m => 
        m.name.toLowerCase().includes(lowerName) ||
        m.title.toLowerCase().includes(lowerName)
      );
    }
    
    if (query.tags && query.tags.length > 0) {
      results = results.filter(m =>
        query.tags!.some(tag => m.tags.includes(tag))
      );
    }
    
    if (query.organization) {
      results = results.filter(m =>
        m.organization?.toLowerCase().includes(query.organization!.toLowerCase())
      );
    }
    
    if (query.version) {
      results = results.filter(m => m.version === query.version);
    }
    
    if (query.isLatest !== undefined) {
      results = results.filter(m => m.isLatest === query.isLatest);
    }
    
    return results;
  }

  listDocuments(options: {
    limit?: number;
    offset?: number;
    sortBy?: 'name' | 'uploadedAt' | 'updatedAt';
    sortOrder?: 'asc' | 'desc';
  } = {}): DocumentMetadata[] {
    let docs = Array.from(this.metadata.values());
    
    // Sort
    const sortBy = options.sortBy || 'uploadedAt';
    const sortOrder = options.sortOrder || 'desc';
    docs.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortBy === 'uploadedAt') {
        cmp = a.uploadedAt.getTime() - b.uploadedAt.getTime();
      } else if (sortBy === 'updatedAt') {
        cmp = a.updatedAt.getTime() - b.updatedAt.getTime();
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    
    // Paginate
    const offset = options.offset || 0;
    const limit = options.limit || docs.length;
    return docs.slice(offset, offset + limit);
  }

  getVersionHistory(id: string): DocumentMetadata[] {
    const meta = this.metadata.get(id);
    if (!meta) return [];
    
    const versions = [meta];
    for (const prevId of meta.previousVersions) {
      const prevMeta = this.metadata.get(prevId);
      if (prevMeta) versions.push(prevMeta);
    }
    
    return versions;
  }

  // Helper methods
  private extractOpenAPIMetadata(doc: any) {
    return {
      openApiVersion: doc.openapi || doc.swagger || 'unknown',
      title: doc.info?.title || 'Untitled API',
      apiVersion: doc.info?.version || '0.0.0',
      servers: (doc.servers || []).map((s: any) => s.url)
    };
  }

  private calculateChecksum(content: string): string {
    return 'sha256:' + createHash('sha256').update(content).digest('hex');
  }

  private calculateStats(doc: any): DocumentMetadata['stats'] {
    const paths = doc.paths || {};
    let operationCount = 0;
    
    for (const path in paths) {
      for (const method in paths[path]) {
        if (['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].includes(method)) {
          operationCount++;
        }
      }
    }
    
    const schemas = doc.components?.schemas || doc.definitions || {};
    const securitySchemes = doc.components?.securitySchemes || doc.securityDefinitions || {};
    const tags = doc.tags || [];
    
    return {
      operationCount,
      schemaCount: Object.keys(schemas).length,
      securitySchemeCount: Object.keys(securitySchemes).length,
      tagCount: tags.length
    };
  }

  private findByChecksum(checksum: string): DocumentMetadata | undefined {
    return Array.from(this.metadata.values()).find(m => m.checksum === checksum);
  }

  /**
   * Get the absolute filesystem path for a document.
   * Used by external tools (e.g., oasdiff) that need direct file access.
   * 
   * @param id - Document UUID
   * @returns Absolute path to the document JSON file
   * @throws Error if document not found
   */
  getDocumentPath(id: string): string {
    const meta = this.metadata.get(id);
    if (!meta) {
      throw new Error(`Document not found: ${id}`);
    }
    return path.join(this.documentsDir, `${id}.json`);
  }

  private async saveDocument(id: string, content: any): Promise<void> {
    const filePath = path.join(this.documentsDir, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(content, null, 2));
    this.logger.debug(`Saved document to: ${filePath}`);
  }

  private async loadDocument(id: string): Promise<any> {
    try {
      const filePath = path.join(this.documentsDir, `${id}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      this.logger.error(`Failed to load document ${id}: ${error}`);
      return undefined;
    }
  }

  private async loadMetadata(): Promise<void> {
    try {
      const content = await fs.readFile(this.metadataPath, 'utf-8');
      const data = JSON.parse(content);
      
      // Convert date strings back to Date objects
      for (const [id, meta] of Object.entries(data)) {
        const m = meta as any;
        m.uploadedAt = new Date(m.uploadedAt);
        m.updatedAt = new Date(m.updatedAt);
        this.metadata.set(id, m as DocumentMetadata);
      }
      
      this.logger.debug(`Loaded metadata: ${this.metadata.size} documents`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error(`Failed to load metadata: ${error}`);
        throw error;
      }
      this.logger.debug('No existing metadata file, starting fresh');
    }
  }

  private async saveMetadata(): Promise<void> {
    const data = Object.fromEntries(this.metadata);
    await fs.writeFile(this.metadataPath, JSON.stringify(data, null, 2));
    this.logger.debug('Metadata saved');
  }

  private async loadSearchIndex(): Promise<void> {
    try {
      const content = await fs.readFile(this.searchIndexPath, 'utf-8');
      this.searchIndex = JSON.parse(content);
      this.logger.debug('Search index loaded');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.debug('No existing search index, building from metadata');
        this.rebuildSearchIndex();
      } else {
        this.logger.error(`Failed to load search index: ${error}`);
        throw error;
      }
    }
  }

  private async saveSearchIndex(): Promise<void> {
    await fs.writeFile(this.searchIndexPath, JSON.stringify(this.searchIndex, null, 2));
    this.logger.debug('Search index saved');
  }

  private updateSearchIndex(meta: DocumentMetadata): void {
    // Index by name
    const nameKey = meta.name.toLowerCase();
    if (!this.searchIndex.byName[nameKey]) {
      this.searchIndex.byName[nameKey] = [];
    }
    if (!this.searchIndex.byName[nameKey].includes(meta.id)) {
      this.searchIndex.byName[nameKey].push(meta.id);
    }
    
    // Index by organization
    if (meta.organization) {
      const orgKey = meta.organization.toLowerCase();
      if (!this.searchIndex.byOrg[orgKey]) {
        this.searchIndex.byOrg[orgKey] = [];
      }
      if (!this.searchIndex.byOrg[orgKey].includes(meta.id)) {
        this.searchIndex.byOrg[orgKey].push(meta.id);
      }
    }
    
    // Index by tags
    for (const tag of meta.tags) {
      const tagKey = tag.toLowerCase();
      if (!this.searchIndex.byTag[tagKey]) {
        this.searchIndex.byTag[tagKey] = [];
      }
      if (!this.searchIndex.byTag[tagKey].includes(meta.id)) {
        this.searchIndex.byTag[tagKey].push(meta.id);
      }
    }
    
    // Index by version
    const versionKey = meta.version.toLowerCase();
    if (!this.searchIndex.byVersion[versionKey]) {
      this.searchIndex.byVersion[versionKey] = [];
    }
    if (!this.searchIndex.byVersion[versionKey].includes(meta.id)) {
      this.searchIndex.byVersion[versionKey].push(meta.id);
    }
  }

  private removeFromSearchIndex(meta: DocumentMetadata): void {
    // Remove from all indexes
    const nameKey = meta.name.toLowerCase();
    if (this.searchIndex.byName[nameKey]) {
      this.searchIndex.byName[nameKey] = this.searchIndex.byName[nameKey].filter(id => id !== meta.id);
      if (this.searchIndex.byName[nameKey].length === 0) {
        delete this.searchIndex.byName[nameKey];
      }
    }
    
    if (meta.organization) {
      const orgKey = meta.organization.toLowerCase();
      if (this.searchIndex.byOrg[orgKey]) {
        this.searchIndex.byOrg[orgKey] = this.searchIndex.byOrg[orgKey].filter(id => id !== meta.id);
        if (this.searchIndex.byOrg[orgKey].length === 0) {
          delete this.searchIndex.byOrg[orgKey];
        }
      }
    }
    
    for (const tag of meta.tags) {
      const tagKey = tag.toLowerCase();
      if (this.searchIndex.byTag[tagKey]) {
        this.searchIndex.byTag[tagKey] = this.searchIndex.byTag[tagKey].filter(id => id !== meta.id);
        if (this.searchIndex.byTag[tagKey].length === 0) {
          delete this.searchIndex.byTag[tagKey];
        }
      }
    }
    
    const versionKey = meta.version.toLowerCase();
    if (this.searchIndex.byVersion[versionKey]) {
      this.searchIndex.byVersion[versionKey] = this.searchIndex.byVersion[versionKey].filter(id => id !== meta.id);
      if (this.searchIndex.byVersion[versionKey].length === 0) {
        delete this.searchIndex.byVersion[versionKey];
      }
    }
  }

  private rebuildSearchIndex(): void {
    this.searchIndex = { byName: {}, byOrg: {}, byTag: {}, byVersion: {} };
    for (const meta of this.metadata.values()) {
      this.updateSearchIndex(meta);
    }
    this.logger.debug('Search index rebuilt');
  }

  private getCurrentStorageSize(): number {
    let totalSize = 0;
    for (const meta of this.metadata.values()) {
      totalSize += meta.size;
    }
    return totalSize;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
  }

  getStats() {
    const currentSize = this.getCurrentStorageSize();
    const usagePercent = Math.round((currentSize / this.quotaBytes) * 100);
    
    return {
      totalDocuments: this.metadata.size,
      totalSizeBytes: currentSize,
      totalSizeGB: parseFloat((currentSize / (1024 * 1024 * 1024)).toFixed(3)),
      quotaBytes: this.quotaBytes,
      quotaGB: this.quotaBytes / (1024 * 1024 * 1024),
      usagePercent,
      availableBytes: this.quotaBytes - currentSize,
      availableGB: parseFloat(((this.quotaBytes - currentSize) / (1024 * 1024 * 1024)).toFixed(3)),
    };
  }

  /**
   * Get upload history for a document
   */
  async getUploadHistory(documentId: string): Promise<UploadHistory[]> {
    return this.uploadHistoryManager.getUploadHistory(documentId);
  }

  /**
   * Get a specific upload record
   */
  async getUpload(uploadId: string): Promise<UploadHistory | undefined> {
    return this.uploadHistoryManager.getUpload(uploadId);
  }
}
