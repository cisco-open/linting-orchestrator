/**
 * Shared types for document storage
 */

/**
 * Document metadata - classification and tracking info
 */
export interface DocumentMetadata {
  /** UUID v4 document identifier */
  id: string;
  
  /** Original filename (from first upload) */
  filename: string;
  
  /** Document format as stored */
  format: 'json' | 'yaml';
  
  /** Document size in bytes */
  size: number;
  
  /** First upload timestamp */
  uploadedAt: Date;
  
  /** Last update timestamp */
  updatedAt?: Date;
  
  /** Content checksum (SHA-256) for deduplication */
  checksum?: string;
  
  /** Number of times this content has been uploaded */
  uploadCount?: number;
  
  // Optional classification metadata
  /** Human-readable API name */
  name?: string;
  
  /** API version */
  version?: string;
  
  /** Tags for categorization */
  tags?: string[];
  
  /** Organization code (e.g., 'CN', 'SBG', 'CTG') */
  organization?: string;
  
  /** API description */
  description?: string;
  
  /** Document owner/uploader */
  owner?: string;
  
  /** User who uploaded this specific version (for audit trail) */
  uploadedBy?: string;
  
  /** Source system/application that uploaded the document */
  source?: string;
  
  /** Optional user-provided context object (max 1KB serialized) */
  userContext?: Record<string, unknown>;
  
  // OpenAPI metadata (extracted from document)
  /** OpenAPI/Swagger version */
  openApiVersion?: string;
  
  /** API title from info.title */
  title?: string;
  
  /** Number of server entries */
  serverCount?: number;
  
  /** Number of operations (endpoints) */
  operationCount?: number;
}

/**
 * Stored document with content and metadata
 */
export interface StoredDocument {
  /** Document UUID */
  id: string;
  
  /** Parsed OpenAPI document (JSON object) */
  content: any;
  
  /** Document metadata */
  metadata: DocumentMetadata;
}

/**
 * List options for querying documents
 */
export interface ListOptions {
  /** Maximum results to return */
  limit?: number;
  
  /** Pagination offset */
  offset?: number;
  
  /** Filter by tags (any match) */
  tags?: string[];
  
  /** Filter by organization */
  organization?: string;
  
  /** Filter by name (partial match) */
  name?: string;
  
  /** Sort field */
  sortBy?: 'uploadedAt' | 'updatedAt' | 'name' | 'size';
  
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Storage statistics
 */
export interface StorageStats {
  /** Total number of documents */
  totalDocuments: number;
  
  /** Total size in bytes */
  totalSize: number;
  
  /** Quota used percentage (if quota enabled) */
  quotaUsedPercent?: number;
  
  /** Cache hit rate (if caching enabled) */
  cacheHitRate?: number;
  
  /** Number of documents in cache */
  cachedDocuments?: number;
}

/**
 * Store operation result
 */
export interface StoreResult {
  /** Document ID (same ID returned for duplicate content) */
  documentId: string;
  
  /** Upload event ID (unique for each upload) */
  uploadId: string;
  
  /** Whether document was newly created */
  created: boolean;
  
  /** Whether this upload is a duplicate of existing content */
  isDuplicate: boolean;
  
  /** If duplicate, when was content first uploaded */
  existingSince?: Date;
  
  /** If duplicate, how many times has this content been uploaded */
  uploadCount?: number;
  
  /** Version number (if versioning enabled) */
  version?: number;
}

/**
 * Upload history record - audit trail of upload events
 */
export interface UploadHistory {
  /** Unique ID for this upload event */
  uploadId: string;
  
  /** Document ID this upload references */
  documentId: string;
  
  /** When this upload occurred */
  uploadedAt: Date;
  
  /** Filename provided by user */
  filename: string;
  
  /** Original format uploaded (json or yaml) */
  format: 'json' | 'yaml';
  
  /** Size in bytes */
  size: number;
  
  /** User/system who uploaded (optional) */
  uploadedBy?: string;
  
  /** Source of upload (API, CLI, MCP, etc.) (optional) */
  source?: string;
  
  /** User-defined reference string (max 1KB) (optional) */
  userContext?: string;
  
  /** Additional metadata */
  tags?: string[];
  organization?: string;
}

/**
 * Search result with highlighted matches
 */
export interface SearchResult extends DocumentMetadata {
  /** Match score (0-1) */
  score?: number;
  
  /** Matched fields */
  matchedFields?: string[];
}
