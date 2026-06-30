# Pluggable Document Store Architecture

**Version:** 1.0.0  
**Date:** December 18, 2025  
**Status:** Design Proposal

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architectural Options Analysis](#architectural-options-analysis)
3. [Pluggable Document Store Design](#pluggable-document-store-design)
4. [MCP Document Store Reusability Analysis](#mcp-document-store-reusability-analysis)
5. [Implementation Plan](#implementation-plan)
6. [Configuration Examples](#configuration-examples)
7. [Migration Path](#migration-path)

---

## Executive Summary

### Problem Statement

Spectify currently has an **architectural inconsistency**:
- **Result storage** is pluggable (memory/Redis/custom) via `LintResultStorage` interface
- **Document storage** is hardcoded to MCP's filesystem (`DocumentAccessor`)

This creates confusion about whether Spectify is:
1. A **standalone service** with MCP as an optional integration
2. A **module/feature of MCP** with a hard dependency

### Proposed Solution: **Option 3 - Pluggable Document Store Adapter**

Make document storage pluggable like result storage, allowing Spectify to:
- ✅ **Be truly standalone** - no MCP required by default
- ✅ **Integrate with MCP** - use MCP as one storage backend option
- ✅ **Support cloud storage** - S3, GCS, Azure Blob (future)
- ✅ **Match existing patterns** - consistent with `LintResultStorage` design
- ✅ **Maintain flexibility** - users choose deployment model

**Design Principle:**
> Spectify is a standalone linting orchestrator with pluggable document storage. MCP integration is ONE storage option, not a requirement.

---

## Architectural Options Analysis

### Current State (Problematic)

```
Spectify Service
├── HTTP API + CLI
├── Worker Pool + Orchestrator
├── DocumentAccessor (HARDCODED to MCP filesystem) ❌
│   └── Reads: ../mcp-openapi-analysis/uploads/
└── LintResultStorage (PLUGGABLE) ✅
    ├── MemoryLintStorage
    └── RedisLintStorage
```

**Problems:**
- Hard dependency on MCP server running
- Can't upload documents directly to Spectify
- Inconsistent with result storage pattern
- Confusing positioning (standalone vs. module)

---

### Option 1: Spectify as Standalone (Not Chosen)

```
Spectify Service
├── Built-in document upload API
├── Own document storage
├── Worker pool
└── No MCP integration
```

**Issues:**
- ❌ Duplicates MCP functionality completely
- ❌ Existing MCP users can't integrate
- ❌ Forces choice: Spectify OR MCP (not both)

---

### Option 2: Spectify as MCP Module (Not Chosen)

```
MCP Server (monolithic)
├── Document Upload API
├── Document Store
├── MCP Protocol Tools
└── Spectify Linting Module (integrated)
    ├── POST /lint endpoint
    ├── Worker Pool
    └── Orchestrator
```

**Issues:**
- ❌ Couples linting to MCP codebase
- ❌ Harder to scale independently
- ❌ Loses "standalone" positioning vs API Insights
- ❌ MCP becomes heavier

---

### Option 3: Pluggable Document Store (CHOSEN) ✅

```
Spectify Service
├── HTTP API + CLI
├── Worker Pool + Orchestrator
├── DocumentStoreAdapter (ABSTRACT INTERFACE) ✅
│   ├── LocalDocumentStore (built-in, standalone)
│   ├── MCPDocumentStore (integration with MCP)
│   ├── S3DocumentStore (future)
│   └── Custom implementations
└── LintResultStorage (already pluggable)
    ├── MemoryLintStorage
    └── RedisLintStorage
```

**Benefits:**
- ✅ **Flexibility:** Standalone OR integrated (user choice)
- ✅ **Consistency:** Matches result storage pattern
- ✅ **Backward compatible:** Default to MCP mode for existing users
- ✅ **Future-proof:** Easy to add cloud storage
- ✅ **Clear positioning:** Standalone by default, MCP optional

**Trade-offs:**
- ⚠️ Slightly more code (abstraction layer)
- ⚠️ But follows established patterns!

---

## Pluggable Document Store Design

### Abstract Interface

```typescript
/**
 * DocumentStoreAdapter - Abstract interface for document storage
 * 
 * Provides pluggable storage for OpenAPI documents.
 * Implementations can use local filesystem, MCP integration,
 * cloud storage, or custom backends.
 */
export interface DocumentStoreAdapter {
  /**
   * Initialize the document store
   */
  initialize(): Promise<void>;

  /**
   * Store a new OpenAPI document
   * 
   * @param content - Raw document content (JSON or YAML string)
   * @param format - Document format
   * @param metadata - Optional metadata
   * @returns Document ID (UUID)
   */
  storeDocument(
    content: string,
    format: 'json' | 'yaml',
    metadata?: DocumentMetadata
  ): Promise<string>;

  /**
   * Get document by ID
   * 
   * @param documentId - UUID of the document
   * @returns Stored document with content and metadata
   */
  getDocument(documentId: string): Promise<StoredDocument | undefined>;

  /**
   * Check if document exists
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
   * @param documentId - UUID of the document
   * @returns Absolute file path to JSON document
   */
  getDocumentPath(documentId: string): Promise<string>;

  /**
   * List all documents (paginated)
   * 
   * @param options - Pagination and filtering options
   * @returns Array of document metadata
   */
  listDocuments(options?: ListOptions): Promise<DocumentMetadata[]>;

  /**
   * Delete document
   * 
   * @param documentId - UUID of the document
   */
  deleteDocument(documentId: string): Promise<void>;

  /**
   * Get storage statistics
   * 
   * @returns Storage stats (size, count, etc.)
   */
  getStats(): Promise<StorageStats>;

  /**
   * Cleanup expired documents (if TTL enabled)
   */
  cleanup?(): Promise<void>;
}

export interface DocumentMetadata {
  id: string;
  filename: string;
  format: 'json' | 'yaml';
  size: number;
  uploadedAt: Date;
  updatedAt?: Date;
  
  // Optional classification
  name?: string;
  version?: string;
  tags?: string[];
  organization?: string;
  description?: string;
  
  // OpenAPI metadata (extracted from document)
  openApiVersion?: string;
  title?: string;
  serverCount?: number;
  operationCount?: number;
}

export interface StoredDocument {
  id: string;
  content: any; // Parsed OpenAPI document (JSON object)
  metadata: DocumentMetadata;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  tags?: string[];
  organization?: string;
  sortBy?: 'uploadedAt' | 'name' | 'size';
  sortOrder?: 'asc' | 'desc';
}

export interface StorageStats {
  totalDocuments: number;
  totalSize: number;
  quotaUsedPercent?: number;
}
```

---

### Implementation 1: LocalDocumentStore (Built-in, Standalone)

**Use Case:** Spectify as standalone service without MCP

```typescript
/**
 * LocalDocumentStore - Spectify manages its own documents
 * 
 * Features:
 * - Accepts uploads via Spectify's POST /documents endpoint
 * - Stores documents in ./uploads/ (configurable)
 * - Filesystem-based with optional TTL cleanup
 * - Simple metadata tracking (no versioning)
 */
export class LocalDocumentStore implements DocumentStoreAdapter {
  private uploadsDir: string;
  private metadata = new Map<string, DocumentMetadata>();
  private ttlMs?: number;

  constructor(config: LocalStoreConfig) {
    this.uploadsDir = config.uploadsDir || './uploads';
    this.ttlMs = config.ttlHours ? config.ttlHours * 60 * 60 * 1000 : undefined;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.uploadsDir, { recursive: true });
    // Load existing metadata if present
    await this.loadMetadata();
  }

  async storeDocument(
    content: string,
    format: 'json' | 'yaml',
    metadata?: Partial<DocumentMetadata>
  ): Promise<string> {
    const id = randomUUID();
    
    // Parse document
    const parsed = format === 'json' ? JSON.parse(content) : parseYAML(content);
    
    // Validate OpenAPI
    if (!parsed.openapi && !parsed.swagger) {
      throw new Error('Not a valid OpenAPI document');
    }
    
    // Store to disk as JSON
    const filePath = path.join(this.uploadsDir, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(parsed, null, 2));
    
    // Store metadata
    const docMetadata: DocumentMetadata = {
      id,
      filename: metadata?.filename || 'openapi-spec',
      format,
      size: content.length,
      uploadedAt: new Date(),
      name: metadata?.name,
      version: metadata?.version,
      tags: metadata?.tags,
      organization: metadata?.organization,
      openApiVersion: parsed.openapi || parsed.swagger,
      title: parsed.info?.title,
      operationCount: this.countOperations(parsed),
    };
    
    this.metadata.set(id, docMetadata);
    await this.saveMetadata();
    
    // Schedule cleanup if TTL enabled
    if (this.ttlMs) {
      setTimeout(() => this.deleteDocument(id), this.ttlMs);
    }
    
    return id;
  }

  async getDocument(documentId: string): Promise<StoredDocument | undefined> {
    const metadata = this.metadata.get(documentId);
    if (!metadata) return undefined;
    
    const filePath = path.join(this.uploadsDir, `${documentId}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return {
        id: documentId,
        content: JSON.parse(content),
        metadata,
      };
    } catch {
      return undefined;
    }
  }

  async getDocumentPath(documentId: string): Promise<string> {
    const filePath = path.join(this.uploadsDir, `${documentId}.json`);
    if (!await this.documentExists(documentId)) {
      throw new Error(`Document ${documentId} not found`);
    }
    return path.resolve(filePath);
  }
  
  // ... implement remaining interface methods
}
```

**Configuration:**
```yaml
documentStore:
  type: local
  uploadsDir: ./uploads
  ttlHours: 24
  quotaMB: 1000
```

---

### Implementation 2: MCPDocumentStore (Integration with MCP)

**Use Case:** Use MCP as document storage backend (current behavior)

```typescript
/**
 * MCPDocumentStore - Integrates with MCP OpenAPI Analyzer
 * 
 * Features:
 * - Reads documents from MCP's upload directory (filesystem access)
 * - Zero-copy architecture (passes file paths to workers)
 * - Optional HTTP fallback via MCP's API
 * - No document upload (users upload to MCP directly)
 * 
 * Note: This adapter is READ-ONLY. Users must upload to MCP server.
 */
export class MCPDocumentStore implements DocumentStoreAdapter {
  private mcpUploadsDir: string;
  private mcpHttpUrl?: string;

  constructor(config: MCPStoreConfig) {
    this.mcpUploadsDir = config.uploadsDir; // ../mcp-openapi-analysis/uploads
    this.mcpHttpUrl = config.httpFallbackUrl; // http://localhost:3002
  }

  async initialize(): Promise<void> {
    // Verify MCP uploads directory exists
    try {
      await fs.access(this.mcpUploadsDir);
      logger.info(`MCP document store ready: ${this.mcpUploadsDir}`);
    } catch {
      throw new Error(
        `MCP uploads directory not found: ${this.mcpUploadsDir}\n` +
        `Ensure MCP server is installed and configure path in documentStore.uploadsDir`
      );
    }
  }

  async storeDocument(): Promise<string> {
    throw new Error(
      'MCPDocumentStore is read-only. Upload documents via MCP server:\n' +
      '  curl -X POST http://localhost:3002/upload -H "Content-Type: application/x-yaml" --data-binary @api.yaml'
    );
  }

  async getDocument(documentId: string): Promise<StoredDocument | undefined> {
    // Try filesystem first (primary)
    const filePath = this.getDocumentPathSync(documentId);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      
      return {
        id: documentId,
        content: parsed,
        metadata: {
          id: documentId,
          filename: 'unknown',
          format: 'json',
          size: content.length,
          uploadedAt: new Date(), // File mtime would be better
          openApiVersion: parsed.openapi || parsed.swagger,
          title: parsed.info?.title,
        },
      };
    } catch {
      // Fallback to HTTP if configured
      if (this.mcpHttpUrl) {
        return await this.getDocumentViaHttp(documentId);
      }
      return undefined;
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
      return filePath;
    } catch {
      throw new Error(`Document ${documentId} not found at ${filePath}`);
    }
  }

  private getDocumentPathSync(documentId: string): string {
    // MCP stores as: uploads/{uuid}.json
    return path.resolve(this.mcpUploadsDir, `${documentId}.json`);
  }

  private isValidDocumentId(id: string): boolean {
    // UUID v4 format only (MCP's format)
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
  }
  
  // ... implement remaining interface methods
}
```

**Configuration:**
```yaml
documentStore:
  type: mcp
  uploadsDir: ../mcp-openapi-analysis/uploads
  httpFallbackUrl: http://localhost:3002  # Optional
```

---

### Implementation 3: S3DocumentStore (Future)

**Use Case:** Cloud-native deployment

```typescript
/**
 * S3DocumentStore - AWS S3 backend
 * 
 * Features:
 * - Store documents in S3 bucket
 * - Materialize to local filesystem for workers
 * - Support for presigned URLs
 * - Automatic cleanup of local cache
 */
export class S3DocumentStore implements DocumentStoreAdapter {
  // Implementation using AWS SDK
  // NOT_IMPLEMENTED - Future feature
}
```

**Configuration:**
```yaml
documentStore:
  type: s3
  bucket: my-openapi-docs
  region: us-west-2
  localCacheDir: /tmp/spectify-cache
  cacheTTL: 3600
```

---

## MCP Document Store Reusability Analysis

### MCP Components Analyzed

From `mcp-openapi-analysis/src/`:

1. **`document-store.ts`** (Original, Simple)
   - In-memory Map storage with optional disk persistence
   - TTL-based expiration
   - **Reusability: LOW** - Too simple for production

2. **`datastore-manager.ts`** (Production-grade) ✅
   - Persistent filesystem storage
   - Metadata management with versioning
   - Search indexing (by name, org, tags, version)
   - Storage quota enforcement (10GB default)
   - **Reusability: HIGH**

3. **`document-cache.ts`** (Performance layer) ✅
   - LRU cache with 1-hour TTL
   - Access tracking and statistics
   - Automatic cleanup
   - **Reusability: HIGH**

4. **`document-coordinator.ts`** (Orchestration) ✅
   - Cache-aside pattern
   - Write-through cache
   - Unified API
   - **Reusability: HIGH**

5. **`upload-server.ts`** (HTTP API)
   - Fastify endpoints for upload/list/get/delete
   - Multi-format support (JSON/YAML)
   - Metadata extraction from headers
   - **Reusability: MEDIUM** - Need to adapt for Spectify

---

### Reuse Recommendation

**For `LocalDocumentStore` implementation, REUSE:**

```typescript
// Option A: Copy and adapt MCP's components (RECOMMENDED)
src/document-store/
├── local-document-store.ts      // Implements DocumentStoreAdapter
│   └── Uses DatastoreManager (copied from MCP)
├── mcp-document-store.ts        // Implements DocumentStoreAdapter
│   └── Filesystem access only
├── datastore-manager.ts         // COPIED from MCP ✅
│   └── Persistent storage logic
├── document-cache.ts            // COPIED from MCP ✅
│   └── LRU caching
└── document-coordinator.ts      // COPIED from MCP ✅
    └── Cache-aside orchestration

// Option B: Import as dependency (if MCP publishes as npm package)
dependencies:
  "@cisco-devnet/mcp-document-store": "^1.0.0"
```

**Estimated Reuse:**
- **DatastoreManager:** 80% reusable (adapt paths/config)
- **DocumentCache:** 95% reusable (minimal changes)
- **DocumentCoordinator:** 85% reusable (adapt interface)
- **Total Code Reuse:** ~600 lines from MCP (80% of local storage implementation)

**Benefits:**
- ✅ Battle-tested code (used in production MCP)
- ✅ Consistent behavior between MCP and standalone modes
- ✅ Features: versioning, search, quotas, caching
- ✅ Fast implementation (copy > rewrite)

**Adaptation Needed:**
```typescript
// Wrap MCP's DatastoreManager to match DocumentStoreAdapter interface
export class LocalDocumentStore implements DocumentStoreAdapter {
  private coordinator: DocumentCoordinator; // From MCP

  constructor(config: LocalStoreConfig) {
    this.coordinator = new DocumentCoordinator(
      config.uploadsDir,
      config.quotaGB,
      config.cacheMaxSize
    );
  }

  async storeDocument(content: string, format: 'json' | 'yaml', metadata?: DocumentMetadata): Promise<string> {
    // Map our interface to MCP's coordinator interface
    return this.coordinator.storeDocument(content, format, {
      filename: metadata?.filename || 'openapi-spec',
      name: metadata?.name,
      tags: metadata?.tags,
      organization: metadata?.organization,
      description: metadata?.description,
    });
  }

  async getDocumentPath(documentId: string): Promise<string> {
    // MCP stores at: {dataDir}/documents/{documentId}.json
    const doc = await this.coordinator.getDocument(documentId);
    if (!doc) throw new Error(`Document ${documentId} not found`);
    
    // Return path to persisted file
    return path.resolve(this.uploadsDir, 'documents', `${documentId}.json`);
  }
  
  // ... delegate other methods to coordinator
}
```

---

## Implementation Plan

### Phase 1: Define Abstract Interface (Week 1)
- [ ] Create `src/document-store/document-store-adapter.ts`
- [ ] Define `DocumentStoreAdapter` interface
- [ ] Define supporting types (`DocumentMetadata`, `StoredDocument`, etc.)
- [ ] Update `types.ts` with document store config types
- [ ] Write interface documentation

### Phase 2: Implement MCPDocumentStore (Week 1)
- [ ] Rename `DocumentAccessor` → `MCPDocumentStore`
- [ ] Implement `DocumentStoreAdapter` interface
- [ ] Maintain backward compatibility
- [ ] Add validation and error messages
- [ ] Write unit tests

### Phase 3: Copy MCP Components (Week 2)
- [ ] Copy `datastore-manager.ts` from MCP
- [ ] Copy `document-cache.ts` from MCP
- [ ] Copy `document-coordinator.ts` from MCP
- [ ] Adapt imports and dependencies
- [ ] Update configuration for Spectify

### Phase 4: Implement LocalDocumentStore (Week 2)
- [ ] Create `LocalDocumentStore` class
- [ ] Wrap `DocumentCoordinator` from MCP
- [ ] Implement adapter interface methods
- [ ] Add upload endpoint: `POST /documents`
- [ ] Write unit tests

### Phase 5: Update Orchestrator (Week 3)
- [ ] Accept `DocumentStoreAdapter` in constructor
- [ ] Remove hardcoded `DocumentAccessor` usage
- [ ] Update worker pool to use adapter
- [ ] Update configuration loading
- [ ] Integration tests

### Phase 6: Configuration & CLI (Week 3)
- [ ] Update `config/default.yaml` with examples
- [ ] Add `--document-store` CLI option
- [ ] Environment variable support
- [ ] Document store selection logic
- [ ] Validation and error messages

### Phase 7: Documentation (Week 4)
- [ ] Update `README.md` with both modes
- [ ] Update `AGENTS.md` with new architecture
- [ ] Create migration guide
- [ ] Update API documentation
- [ ] Add deployment examples

### Phase 8: S3DocumentStore (Future)
- [ ] AWS SDK integration
- [ ] Local cache management
- [ ] Presigned URL support
- [ ] Configuration and testing

---

## Configuration Examples

### Standalone Mode (LocalDocumentStore)

```yaml
# config/default.yaml
documentStore:
  type: local
  uploadsDir: ./uploads
  ttlHours: 24
  quotaGB: 10
  cacheMaxSize: 100

# Enable upload endpoint
httpServer:
  port: 3003
  enableDocumentUpload: true
```

**Usage:**
```bash
# 1. Start Spectify (no MCP needed!)
npm start

# 2. Upload document directly to Spectify
curl -X POST http://localhost:3003/documents \
  -H "Content-Type: application/x-yaml" \
  --data-binary @api.yaml
# Returns: {"documentId": "550e8400-e29b-..."}

# 3. Submit lint job
curl -X POST http://localhost:3003/lint \
  -d '{"documentId": "550e8400-e29b-...", "rulesetName": "pubhub"}'
```

---

### MCP Integration Mode (MCPDocumentStore)

```yaml
# config/default.yaml
documentStore:
  type: mcp
  uploadsDir: ../mcp-openapi-analysis/uploads
  httpFallbackUrl: http://localhost:3002

# Document upload is disabled (use MCP)
httpServer:
  port: 3003
  enableDocumentUpload: false
```

**Usage:**
```bash
# 1. Start MCP server (external)
cd ../mcp-openapi-analysis && npm start

# 2. Start Spectify
npm start

# 3. Upload document to MCP
curl -X POST http://localhost:3002/upload \
  -H "Content-Type: application/x-yaml" \
  --data-binary @api.yaml
# Returns: {"documentId": "550e8400-e29b-..."}

# 4. Submit lint job to Spectify
curl -X POST http://localhost:3003/lint \
  -d '{"documentId": "550e8400-e29b-...", "rulesetName": "pubhub"}'
```

---

### Cloud Mode (S3DocumentStore, Future)

```yaml
# config/default.yaml
documentStore:
  type: s3
  bucket: my-openapi-docs
  region: us-west-2
  localCacheDir: /tmp/spectify-cache
  cacheTTL: 3600
  
  # AWS credentials via environment or IAM role
  awsAccessKeyId: ${AWS_ACCESS_KEY_ID}
  awsSecretAccessKey: ${AWS_SECRET_ACCESS_KEY}

httpServer:
  port: 3003
  enableDocumentUpload: true
```

---

## Migration Path

### For Existing Users (Currently using MCP)

**No breaking changes!** Default to MCP mode:

```yaml
# config/default.yaml - Backward compatible default
documentStore:
  type: mcp  # Default if not specified
  uploadsDir: ../mcp-openapi-analysis/uploads
```

**Environment variable override:**
```bash
# Keep existing behavior
SPECTIFYD_DOCUMENT_STORE_TYPE=mcp
SPECTIFYD_DOCUMENT_STORE_DIR=../mcp-openapi-analysis/uploads

# Or switch to standalone
SPECTIFYD_DOCUMENT_STORE_TYPE=local
SPECTIFYD_DOCUMENT_STORE_DIR=./uploads
```

---

### For New Users

**Recommended:** Start with standalone mode

```bash
# 1. Install Spectify
npm install -g @cisco_open/linting-orchestrator

# 2. Initialize (creates config with local store)
spectify init

# 3. Start
spectify start

# 4. Upload and lint
spectify upload api.yaml
spectify lint <documentId> --ruleset pubhub
```

---

### For Production Deployments

**Option 1: Standalone with S3** (Recommended for cloud)
```yaml
documentStore:
  type: s3
  bucket: prod-openapi-docs
  region: us-west-2
```

**Option 2: MCP Integration** (Recommended for on-prem)
```yaml
documentStore:
  type: mcp
  uploadsDir: /var/lib/mcp-openapi-analysis/uploads
```

---

## Summary

### Key Design Decisions

1. **Pluggable by Default:** Document storage follows same pattern as result storage
2. **Reuse MCP Components:** Copy proven production code (DatastoreManager, DocumentCache, DocumentCoordinator)
3. **Zero-Copy Architecture:** All adapters must support `getDocumentPath()` for workers
4. **Backward Compatible:** Default to MCP mode for existing users
5. **Future-Proof:** Easy to add S3, GCS, Azure, database backends

### Benefits

- ✅ **True Independence:** Spectify can run without MCP
- ✅ **Flexibility:** Users choose deployment model
- ✅ **Consistency:** Matches result storage pattern
- ✅ **Reusability:** Leverage 600+ lines of battle-tested MCP code
- ✅ **Extensibility:** Easy to add new storage backends

### Next Steps

1. Review and approve this design
2. Begin Phase 1 (interface definition)
3. Implement Phase 2 (MCPDocumentStore refactor)
4. Copy MCP components (Phase 3)
5. Build LocalDocumentStore (Phase 4)

---

**Questions or feedback?** Review sections:
- [Architectural Options](#architectural-options-analysis) - Why Option 3?
- [MCP Reusability](#mcp-document-store-reusability-analysis) - What to copy?
- [Implementation Plan](#implementation-plan) - Timeline?
- [Configuration Examples](#configuration-examples) - How to use?
