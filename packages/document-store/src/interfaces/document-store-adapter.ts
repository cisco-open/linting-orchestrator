/**
 * DocumentStoreAdapter - Abstract interface for document storage
 * 
 * Provides pluggable storage for OpenAPI documents.
 * Implementations can use local filesystem, MCP integration,
 * cloud storage, or custom backends.
 * 
 * Design Principles:
 * - Zero-copy: Workers receive file paths, not document content
 * - Async: All operations are asynchronous
 * - Validation: Document IDs must be validated to prevent path traversal
 * - Metadata: Rich tracking for classification and search
 */

import type {
  DocumentMetadata,
  StoredDocument,
  ListOptions,
  StorageStats,
  StoreResult,
  SearchResult,
  UploadHistory
} from './types.js';

export interface DocumentStoreAdapter {
  /**
   * Initialize the document store
   * 
   * Called once before any other operations.
   * Should verify/create storage directories, load metadata, etc.
   * 
   * @throws {Error} If initialization fails
   */
  initialize(): Promise<void>;

  /**
   * Store a new OpenAPI document
   * 
   * Returns information about whether the document is new or a duplicate.
   * Even for duplicates, the upload event is recorded in history.
   * 
   * @param content - Raw document content (JSON or YAML string)
   * @param format - Document format ('json' or 'yaml')
   * @param metadata - Optional metadata for classification and upload context
   * @returns StoreResult with document ID, upload ID, and duplicate information
   * @throws {Error} If document is invalid or storage fails
   */
  storeDocument(
    content: string,
    format: 'json' | 'yaml',
    metadata?: Partial<DocumentMetadata> & {
      uploadedBy?: string;
      source?: string;
      userContext?: string;
    }
  ): Promise<StoreResult>;

  /**
   * Get document by ID
   * 
   * Returns document with parsed content and metadata.
   * Implementations may use caching for performance.
   * 
   * @param documentId - UUID of the document
   * @returns Stored document or undefined if not found
   */
  getDocument(documentId: string): Promise<StoredDocument | undefined>;

  /**
   * Check if document exists
   * 
   * Lightweight check without loading document content.
   * 
   * @param documentId - UUID of the document
   * @returns True if document exists
   */
  documentExists(documentId: string): Promise<boolean>;

  /**
   * Get file path for document (for worker threads)
   * 
   * Workers need file paths (not content) for zero-copy architecture.
   * Implementation may need to materialize document to filesystem.
   * 
   * Document must be in JSON format at the returned path.
   * 
   * @param documentId - UUID of the document
   * @returns Absolute file path to JSON document
   * @throws {Error} If document not found
   */
  getDocumentPath(documentId: string): Promise<string>;

  /**
   * List all documents (paginated)
   * 
   * @param options - Pagination and filtering options
   * @returns Array of document metadata (not full content)
   */
  listDocuments(options?: ListOptions): Promise<DocumentMetadata[]>;

  /**
   * Search documents by metadata
   * 
   * Search across name, tags, organization, description.
   * Returns ranked results with match scores.
   * 
   * @param query - Search query string
   * @param options - Filter and pagination options
   * @returns Array of search results with scores
   */
  searchDocuments(query: string, options?: ListOptions): Promise<SearchResult[]>;

  /**
   * Update document
   * 
   * Implementations may support versioning or replace existing document.
   * 
   * @param documentId - UUID of document to update
   * @param content - New document content
   * @param format - Document format
   * @param metadata - Updated metadata (partial update)
   * @returns Store result with version info
   * @throws {Error} If document not found or update fails
   */
  updateDocument(
    documentId: string,
    content: string,
    format: 'json' | 'yaml',
    metadata?: Partial<DocumentMetadata>
  ): Promise<StoreResult>;

  /**
   * Delete document
   * 
   * Permanently removes document and metadata.
   * Implementations with versioning may archive instead of delete.
   * 
   * @param documentId - UUID of the document
   * @throws {Error} If document not found
   */
  deleteDocument(documentId: string): Promise<void>;

  /**
   * Get storage statistics
   * 
   * @returns Storage stats (size, count, quota, cache stats)
   */
  getStats(): Promise<StorageStats>;

  /**
   * Get upload history for a document
   * 
   * Returns all upload events for this document, even duplicates.
   * Sorted by uploadedAt descending (newest first).
   * 
   * @param documentId - UUID of the document
   * @returns Array of upload history records
   */
  getUploadHistory?(documentId: string): Promise<UploadHistory[]>;

  /**
   * Get specific upload event
   * 
   * @param uploadId - UUID of the upload event
   * @returns Upload history record or undefined if not found
   */
  getUpload?(uploadId: string): Promise<UploadHistory | undefined>;

  /**
   * Cleanup expired documents (optional)
   * 
   * Implementations with TTL support should implement this.
   * Called periodically to remove expired documents.
   * 
   * @returns Number of documents cleaned up
   */
  cleanup?(): Promise<number>;

  /**
   * Validate document ID format
   * 
   * Prevents path traversal attacks.
   * Default implementation checks for UUID v4 format.
   * 
   * @param documentId - Document ID to validate
   * @returns True if valid
   */
  isValidDocumentId?(documentId: string): boolean;
}

/**
 * Configuration for LocalDocumentStore
 */
export interface LocalStoreConfig {
  /** Storage directory for uploads (default: ./uploads) */
  uploadsDir?: string;
  
  /** Storage quota in GB (default: 10) */
  quotaGB?: number;
  
  /** Max documents in cache (default: 100) */
  cacheMaxSize?: number;
  
  /** Cache TTL in hours (default: 1) */
  cacheTTLHours?: number;
  
  /** Enable document versioning (default: false) */
  enableVersioning?: boolean;
  
  /** Document TTL in hours (default: none) */
  documentTTLHours?: number;
}

/**
 * Configuration for MCPDocumentStore
 */
export interface MCPStoreConfig {
  /** Path to MCP uploads directory (required) */
  uploadsDir: string;
  
  /** MCP server URL for HTTP fallback (optional) */
  httpFallbackUrl?: string;
  
  /** Request timeout in ms (default: 5000) */
  httpTimeout?: number;
}

/**
 * Configuration for S3DocumentStore (future)
 */
export interface S3StoreConfig {
  /** S3 bucket name */
  bucket: string;
  
  /** AWS region */
  region: string;
  
  /** Local cache directory */
  localCacheDir?: string;
  
  /** Cache TTL in seconds */
  cacheTTL?: number;
  
  /** AWS credentials (optional, can use IAM role) */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}
