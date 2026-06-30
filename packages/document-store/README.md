# @cisco_open/linting-document-store

**Pluggable document storage library for API specifications**

This package provides a unified interface for storing and retrieving API specification documents, with multiple backend implementations. It is shared by [`@cisco_open/linting-orchestrator`](https://github.com/cisco-open/linting-orchestrator) and the [MCP Analysis](https://github.com/cisco-open/mcp-openapi-analysis) server.

> Inside the orchestrator repo this package is an npm workspace at
> `packages/document-store/`. It is consumed by the orchestrator and
> reports packages via the workspace dependency `"@cisco_open/linting-document-store": "*"`.
> Until it is published to an npm registry, downstream consumers should
> use either an npm workspace, `file:` dependency, or `npm pack` tarball.

## Features

- 🔌 **Pluggable Architecture** - Abstract interface with multiple implementations
- 📦 **LocalDocumentStore** - Filesystem-based storage with caching and metadata
- 🔗 **PassThroughDocumentStore** - Pass-through to external document storage (e.g., MCP uploads)
- 🚀 **Zero-Copy Design** - Workers receive file paths, not document content
- 💾 **Persistent Storage** - Datastore with versioning, search, and quota management
- ⚡ **High Performance** - In-memory caching with LRU eviction and TTL
- 🔍 **Rich Metadata** - Document classification, tags, organization tracking

## Installation

### npm workspace (current, in this monorepo)

Inside the `linting-orchestrator` monorepo this package is
already linked as a workspace. From the repo root:

```bash
npm install        # links every packages/* together
npm run build      # builds document-store -> reports -> orchestrator
```

In a sibling workspace package, declare a dep and import normally:

```jsonc
// packages/<your-package>/package.json
{
  "dependencies": {
    "@cisco_open/linting-document-store": "*"
  }
}
```

```ts
import { LocalDocumentStore, PassThroughDocumentStore } from '@cisco_open/linting-document-store';
```

### NPM (future)

Once published to a registry:

```bash
npm install @cisco_open/linting-document-store
```

```ts
import { LocalDocumentStore } from '@cisco_open/linting-document-store/adapters/local';
import { PassThroughDocumentStore } from '@cisco_open/linting-document-store/adapters/pass-through';
```

## Quick Start

### Local Document Store (Standalone)

```typescript
import { LocalDocumentStore } from '@cisco_open/linting-document-store/adapters/local';

const store = new LocalDocumentStore({
  uploadsDir: './uploads',
  quotaGB: 10,
  cacheMaxSize: 100,
  cacheTTLHours: 1
});

await store.initialize();

// Store document
const documentId = await store.storeDocument(
  yamlContent,
  'yaml',
  {
    filename: 'petstore.yaml',
    name: 'Pet Store API',
    tags: ['retail', 'public'],
    organization: 'CN'
  }
);

// Retrieve document
const doc = await store.getDocument(documentId);
console.log(doc.content.info.title);

// Get file path for workers (zero-copy)
const path = await store.getDocumentPath(documentId);
// Workers read from path directly
```

### PassThrough Document Store (Integration)

```typescript
import { PassThroughDocumentStore } from '@cisco_open/linting-document-store/adapters/pass-through';

const store = new PassThroughDocumentStore({
  uploadsDir: '../mcp-openapi-analysis/uploads',
  httpFallbackUrl: 'http://localhost:3002'
});

await store.initialize();

// Note: PassThroughDocumentStore is READ-ONLY
// Upload documents via external system (e.g., MCP server API)

// Retrieve document from external storage
const doc = await store.getDocument(documentId);

// Get file path for workers
const path = await store.getDocumentPath(documentId);
```

## Architecture

### Layer Responsibilities

The library follows a clear separation of concerns with three distinct layers:

| Layer | Component | Logger | Responsibility |
|-------|-----------|--------|----------------|
| **Adapter** | LocalDocumentStore | `store...` | High-level user-facing API. Entry point for all operations. Combines coordination + caching + persistence. |
| **Adapter** | PassThroughDocumentStore | `pass....` | Read-only adapter. Direct filesystem access to external document systems. |
| **Orchestration** | DocumentCoordinator | `coord...` | Orchestrates cache-aside and write-through patterns. Coordinates between cache and datastore. |
| **Caching** | DocumentCache | `cache...` | In-memory LRU cache with TTL. Performance optimization layer. |
| **Persistence** | DatastoreManager | `persist.` | Low-level storage engine. Manages disk I/O, metadata, quota, search index. NO caching. |
| **Audit** | UploadHistoryManager | `history.` | Tracks upload events. Records every upload (even duplicates) with filename, user, timestamp. |

**Key Distinction:**
- **`persist.`** (DatastoreManager) = Internal storage engine. Direct disk operations, metadata management, search indexing.
- **`store...`** (LocalDocumentStore) = External API. User-facing adapter that orchestrates the full stack (coordinator → cache → datastore).

### Two Implementations of DocumentStoreAdapter

**LocalDocumentStore** (Full-featured with caching & persistence)
```
LocalDocumentStore (store...)
  │
  ├─→ DocumentCoordinator (coord...) ─┬─→ DocumentCache (cache...) [in-memory LRU]
  │                                   └─→ DatastoreManager (persist.) [persistent filesystem]
  │
  └─→ UploadHistoryManager (history.) [audit trail]
  
Handles: storage, retrieval, versioning, search, quota, caching
```

**PassThroughDocumentStore** (Simple read-only filesystem access)
```
PassThroughDocumentStore (pass....)
  │
  └─→ Direct filesystem reads from external uploads directory
      (optional HTTP fallback)
      
Read-only: Users upload via external system
```

Both implement the same interface:
- `storeDocument()`, `getDocument()`, `getDocumentPath()`, `documentExists()`, `listDocuments()`, `deleteDocument()`

### Logger Names (8 characters)

All loggers use standardized 8-character names with dot padding for alignment:

```typescript
getLogger('persist.')  // DatastoreManager - persistent storage layer
getLogger('coord...')  // DocumentCoordinator - orchestration layer
getLogger('cache...')  // DocumentCache - in-memory cache
getLogger('history.')  // UploadHistoryManager - audit trail
getLogger('store...')  // LocalDocumentStore - user-facing adapter
getLogger('pass....')  // PassThroughDocumentStore - read-only adapter
```

### LocalDocumentStore Components

**DocumentCoordinator (`coord...`)** - Orchestrates cache and datastore
- Cache-aside pattern (read through cache)
- Write-through pattern (update cache + datastore)
- Invalidation on update/delete

**DatastoreManager (`persist.`)** - Persistent filesystem storage
- Quota management (configurable GB limit)
- Version tracking (multiple versions per document)
- Search index (by name, tags, organization)
- Metadata management
- **NO caching** (pure persistence layer)

**DocumentCache (`cache...`)** - In-memory performance layer
- LRU eviction (configurable max documents)
- TTL expiry (configurable hours)
- Automatic reloading from datastore on miss

**UploadHistoryManager (`history.`)** - Audit trail
- Records every upload event (even duplicates)
- Tracks filename, user, timestamp, source for each upload
- SHA-256 deduplication tracking
- Upload history queries

### PassThroughDocumentStore Components

**PassThroughDocumentStore (`pass....`)** - Read-only adapter
- Direct filesystem access to external uploads directory
- Zero-copy architecture (file path references)
- Optional HTTP fallback for missing documents
- Read-only (users upload via external system)

## API Reference

### DocumentStoreAdapter Interface

```typescript
interface DocumentStoreAdapter {
  initialize(): Promise<void>;
  
  storeDocument(
    content: string,
    format: 'json' | 'yaml',
    metadata?: Partial<DocumentMetadata>
  ): Promise<string>;
  
  getDocument(documentId: string): Promise<StoredDocument | undefined>;
  
  getDocumentPath(documentId: string): Promise<string>;
  
  documentExists(documentId: string): Promise<boolean>;
  
  listDocuments(options?: ListOptions): Promise<DocumentMetadata[]>;
  
  deleteDocument(documentId: string): Promise<void>;
  
  getStats(): Promise<StorageStats>;
}
```


## Configuration

### LocalDocumentStore Options

```typescript
interface LocalStoreConfig {
  uploadsDir: string;        // Storage directory (default: ./uploads)
  quotaGB: number;           // Storage quota in GB (default: 10)
  cacheMaxSize: number;      // Max cached documents (default: 100)
  cacheTTLHours: number;     // Cache TTL in hours (default: 1)
}
```

### PassThroughDocumentStore Options

```typescript
interface MCPStoreConfig {
  uploadsDir: string;        // Path to external uploads dir (required)
  httpFallbackUrl?: string;  // External server URL for HTTP fallback (optional)
}
```

## Use Cases

### Linting orchestrator

The orchestrator uses `DocumentStoreAdapter` for flexible document storage:

**Standalone Mode** - Uses `LocalDocumentStore`
- the orchestrator manages its own documents
- Users upload via `POST /documents` endpoint
- No external dependencies

**External Integration Mode** - Uses `PassThroughDocumentStore`
- Reads from external upload directory (e.g., MCP)
- Users upload via external server
- Leverages external system's metadata tracking

### MCP OpenAPI Analysis Server

MCP uses `LocalDocumentStore` internally for:
- Document upload API (`POST /upload`)
- Document persistence (datastore/)
- MCP protocol tools (get_document_info, search, etc.)

## Development

### Local Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode (development)
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Testing as Submodule

When used as a submodule in the orchestrator or MCP:

```bash
# In the parent project
cd document-store
npm run build
cd ..

# Parent project will import from ./document-store/build/
```

### Updating Submodule in Parent Projects

```bash
# Update to latest
git submodule update --remote document-store

# Commit the submodule reference update
git add document-store
git commit -m "chore: update document-store submodule"
```

## Testing

```bash
# Unit tests
npm test

# Integration tests (requires both Spectify and MCP running)
npm run test:integration
```

## Migration Guide

### From the orchestrator's DocumentAccessor

```typescript
// Before
import { DocumentAccessor } from './document-accessor.js';
const accessor = new DocumentAccessor({ documentStorePath: './uploads' });
const path = accessor.getDocumentPath(documentId);

// After
import { PassThroughDocumentStore } from '@cisco_open/linting-document-store/adapters/pass-through';
const store = new PassThroughDocumentStore({ uploadsDir: './uploads' });
await store.initialize();
const path = await store.getDocumentPath(documentId);
```

### From MCP's DocumentCoordinator

```typescript
// Before
import { DocumentCoordinator } from './document-coordinator.js';
const coordinator = new DocumentCoordinator('./datastore', 10, 100);
await coordinator.initialize();

// After
import { LocalDocumentStore } from '@cisco_open/linting-document-store/adapters/local';
const store = new LocalDocumentStore({
  uploadsDir: './datastore',
  quotaGB: 10,
  cacheMaxSize: 100
});
await store.initialize();
```

## Documentation

- [AGENTS.md](./AGENTS.md) - AI agent development guide
- [UPLOAD-HISTORY-DESIGN.md](./docs/UPLOAD-HISTORY-DESIGN.md) - Upload history & deduplication design (v2.0 planned)
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) - Architecture deep dive (planned)
- [DESIGN.md](./docs/DESIGN.md) - Design decisions and rationale (planned)


## Related Projects

- [the orchestrator](https://github.com/cisco-open/linting-orchestrator) - the linting orchestrator service and CLI (uses as submodule)
- [MCP OpenAPI Analysis](https://github.com/cisco-open/mcp-openapi-analysis) - Model Context Protocol server for OpenAPI documents analysis (uses as submodule)

Both projects use document-store as a git submodule. Future migration to npm package planned once corporate registry is available.
