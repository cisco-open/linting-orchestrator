# AGENTS.md

AI agent development guide for Document Store library.

## Critical Concepts

**Zero-Copy Pattern**: Workers receive file paths, NOT document content
**Cache-Aside**: Check cache → miss → load from datastore  
**Write-Through**: Write to datastore → populate cache  
**Path Traversal Prevention**: Always validate UUIDs before constructing paths

## Code Requirements

### TypeScript Strict Mode
- Target: ES2022, ES modules  
- **ESM imports require `.js` extensions** even for `.ts` files:
  ```typescript
  import { DocumentStoreAdapter } from './interfaces/document-store-adapter.js'; // ✅
  ```

### Naming
- camelCase: variables, functions  
- PascalCase: classes, interfaces, types  
- UPPER_CASE: constants

### Logger Naming Convention
All loggers use **8-character names** with dot padding for alignment:
- `persist.` = DatastoreManager (core persistence layer)
- `coord...` = DocumentCoordinator (orchestration layer)
- `cache...` = DocumentCache (LRU cache)
- `history.` = UploadHistoryManager (audit trail)
- `store...` = LocalDocumentStore (local adapter)
- `pass....` = PassThroughDocumentStore (pass-through adapter)

**Architecture Clarity:**
- `persist` = Low-level storage engine (internal)
- `store` = High-level user-facing adapter (external API)

### Error Handling
```typescript
// ✅ Descriptive with context
if (!isValidDocumentId(documentId)) {
  throw new Error(`Invalid document ID format: ${documentId}. Expected UUID v4.`);
}
```

## Critical Pitfalls

### Worker Thread Message Passing
```typescript
// ✅ GOOD: Pass file path (zero-copy)
const documentPath = await store.getDocumentPath(documentId);
workerPool.executeTask({ documentPath, rulesetName });

// ❌ BAD: Pass document content (copies entire object)
const doc = await store.getDocument(documentId);
workerPool.executeTask({ documentContent: doc.content, rulesetName });
```

### Async Initialization
```typescript
const store = new LocalDocumentStore(config);
await store.initialize(); // ✅ REQUIRED before use
```

### Path Traversal Prevention
```typescript
// ✅ Validate UUIDs before path construction
function isValidDocumentId(id: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
}
```

## Testing

```bash
npm test                  # Run all tests
npm test:watch            # Watch mode
npm test -- --coverage    # With coverage
npm test local-document-store.test.ts  # Specific file
```

**Key Test Areas:**
- LocalDocumentStore: storage, retrieval, cache hits/misses, quota, eviction
- PassThroughDocumentStore: file resolution, read-only enforcement, HTTP fallback
- DocumentCoordinator: cache-aside/write-through patterns
- DatastoreManager: quota, versioning, search
- DocumentCache: LRU, TTL, statistics

## Adding New Adapters

```typescript
// src/adapters/s3-document-store.ts
import { DocumentStoreAdapter, DocumentMetadata, StoredDocument } from '../interfaces/index.js';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

export class S3DocumentStore implements DocumentStoreAdapter {
  private s3Client: S3Client;
  private bucket: string;
  private localCacheDir: string;

  async initialize(): Promise<void> {
    await fs.mkdir(this.localCacheDir, { recursive: true });
    await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async getDocumentPath(documentId: string): Promise<string> {
    const localPath = join(this.localCacheDir, `${documentId}.json`);
    if (!await fileExists(localPath)) {
      const response = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: `${documentId}.json`
      }));
      await fs.writeFile(localPath, await streamToString(response.Body));
    }
    return localPath;
  }
  // ... implement remaining interface methods
}
```

## Environment Variables

```bash
# LocalDocumentStore
UPLOADS_DIR=./uploads
DATASTORE_DIR=./datastore
QUOTA_GB=10
CACHE_MAX_SIZE=100
CACHE_TTL_HOURS=1

# PassThroughDocumentStore
MCP_UPLOADS_DIR=../mcp-openapi-analysis/uploads
MCP_HTTP_URL=http://localhost:3002

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
```

## Git Workflow

- Main branch: `main`
- Feature branches: `feature/feature-name`
- Bug fixes: `fix/issue-description`

### Before Committing

```bash
npm run build    # Ensure it compiles
npm test         # Run all tests
git status       # Check changes
```

### Commit Message Format

```
<type>: <description>

Types: feat, fix, docs, refactor, test, chore
```

Examples:
- `feat: add S3DocumentStore adapter`
- `fix: prevent path traversal in document ID validation`
- `docs: add S3 adapter usage examples`
- `refactor: extract cache eviction logic`

## Versioning and Changelog

Follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**MAJOR (x.0.0)** - Breaking changes:
- Removing or renaming interface methods
- Changing method signatures incompatibly
- Changing return types

**MINOR (0.x.0)** - New features:
- Adding new adapter implementations
- Adding optional parameters
- Adding new methods to interface (with defaults)

**PATCH (0.0.x)** - Bug fixes:
- Fixing bugs without changing API
- Documentation updates
- Performance improvements

## Related Projects

- [the orchestrator](https://github.com/cisco-open/linting-orchestrator) - Uses this library for document storage (git submodule)
- [MCP OpenAPI Analysis](https://github.com/cisco-open/mcp-openapi-analysis) - Uses this library for document management (git submodule)

## Integration Workflow

### Current: Git Submodule Approach

```bash
# In parent project (e.g., spectify or mcp-openapi-analysis)
cd document-store
npm install
npm run build
cd ..

# Import from compiled output
import { LocalDocumentStore } from '../document-store/build/adapters/local-document-store.js';
```

**Important:**
- Always import from `../document-store/build/` (compiled output), NOT `src/`
- The submodule must be built before the parent project
- After updating the submodule, rebuild it before building the parent

### Future: NPM Package

Once published to corporate registry:
```bash
npm install @cisco-open/linting-document-store
import { LocalDocumentStore } from '@cisco-open/linting-document-store/adapters/local';
```
