# Upload History Design

## Problem Statement

Current implementation conflates **document identity** (immutable content) with **upload context** (filename, user, timestamp). When duplicate content is uploaded with a different filename, the system silently returns the existing document ID without:
1. Notifying the user it's a duplicate
2. Recording the new upload context (filename, user, timestamp)
3. Providing an audit trail of all uploads

## Proposed Solution

Separate **document storage** (content-based, deduplicated) from **upload history** (context-based, audit trail).

## Architecture

### Core Concepts

**Document** = Immutable content identified by checksum
- Stored once, deduplicated by content hash
- Contains OpenAPI spec and extracted metadata
- Identified by UUID

**Upload History** = Audit trail of upload events
- Every upload is recorded, even duplicates
- Contains upload context: filename, user, timestamp, source
- Links to the document via documentId

### Data Structures

```typescript
// Core document metadata (content-focused)
interface DocumentMetadata {
  id: string;                    // UUID v4
  checksum: string;              // SHA-256 of content
  openApiVersion: string;        // From spec
  title: string;                 // From spec
  version?: string;              // API version
  firstUploadedAt: Date;         // When first uploaded
  uploadCount: number;           // How many times uploaded
  // ... other OpenAPI metadata
}

// Upload event record (context-focused)
interface UploadHistory {
  uploadId: string;              // UUID v4 for this upload event
  documentId: string;            // References the document
  uploadedAt: Date;              // When this upload occurred
  uploadedBy?: string;           // User/system who uploaded
  filename: string;              // What the user called it
  source?: string;               // Where it came from (API, CLI, MCP, etc.)
  userContext?: string;          // User-defined reference (max 1KB)
  format: 'json' | 'yaml';       // Original format uploaded
  size: number;                  // Original size in bytes
}

// Result returned to user
interface StoreResult {
  documentId: string;            // Document ID (same for duplicates)
  uploadId: string;              // Unique ID for this upload event
  created: boolean;              // true = new doc, false = duplicate
  isDuplicate: boolean;          // Explicit duplicate flag
  existingSince?: Date;          // If duplicate, when was it first uploaded
  uploadCount?: number;          // If duplicate, how many times uploaded
}
```

### Storage Layout

```
datastore/
├── documents/                   # Deduplicated content
│   ├── {uuid}.json             # Document content (OpenAPI spec)
│   └── ...
├── upload-history/              # All upload events
│   ├── {upload-uuid}.json      # Each upload event
│   └── ...
├── metadata.json                # Document metadata index
└── upload-history-index.json   # Upload history index
```

### API Changes

#### storeDocument() - Returns StoreResult

**Before:**
```typescript
const docId = await store.storeDocument(content, 'yaml', { 
  filename: 'api.yaml' 
});
// User doesn't know if it's new or duplicate
```

**After:**
```typescript
const result = await store.storeDocument(content, 'yaml', { 
  filename: 'api.yaml',
  userContext: '/path/to/original/file.yaml',  // User reference
  uploadedBy: 'john@example.com',
  source: 'CLI'
});

console.log(result);
// {
//   documentId: 'abc-123',
//   uploadId: 'xyz-789',
//   created: false,           // It's a duplicate!
//   isDuplicate: true,
//   existingSince: '2025-12-01T...',
//   uploadCount: 5
// }
```

#### New API: getUploadHistory()

```typescript
// Get all uploads for a specific document
const history = await store.getUploadHistory('abc-123');
// [
//   { uploadId: '...', filename: 'api.yaml', uploadedAt: '...', userContext: '...' },
//   { uploadId: '...', filename: 'api-v2.yaml', uploadedAt: '...', userContext: '...' },
//   { uploadId: '...', filename: 'openapi.yaml', uploadedAt: '...', userContext: '...' }
// ]

// Get specific upload event
const upload = await store.getUpload('xyz-789');
// { uploadId: 'xyz-789', documentId: 'abc-123', filename: 'api.yaml', ... }
```

### User Context Field

**Purpose**: Allow users to store arbitrary reference information with each upload

**Examples:**
- Original file path: `/workspace/apis/petstore.yaml`
- Git reference: `github.com/org/repo/commit/abc123/api.yaml`
- Ticket reference: `JIRA-1234: Updated auth endpoints`
- Environment: `production-api-v1`

**Constraints:**
- Max size: 1024 bytes (1KB)
- Optional field
- Stored as plain string
- No validation beyond size limit
- Not indexed/searchable (just stored for retrieval)

```typescript
interface UploadMetadata {
  filename: string;
  userContext?: string;      // User-defined reference (max 1KB)
  uploadedBy?: string;
  source?: string;
  tags?: string[];
  organization?: string;
}
```

## Implementation Plan

### Phase 1: Data Structures & Storage
1. ✅ Define TypeScript interfaces
2. Add `UploadHistory` type to `src/interfaces/types.ts`
3. Update `StoreResult` interface
4. Create `UploadHistoryManager` class in `src/core/upload-history-manager.ts`

### Phase 2: Core Logic
1. Update `DatastoreManager.storeDocument()` to:
   - Create upload history entry for every upload
   - Return `StoreResult` instead of just string
   - Increment `uploadCount` on documents
2. Validate `userContext` size limit (1KB)

### Phase 3: Interface Updates (Breaking Change)
1. Update `DocumentStoreAdapter.storeDocument()` signature:
   - Return type: `Promise<string>` → `Promise<StoreResult>`
2. Update all adapters:
   - `LocalDocumentStore`
   - `PassThroughDocumentStore` (read-only, throws on store)

### Phase 4: New APIs
1. Add `getUploadHistory(documentId)` to interface
2. Add `getUpload(uploadId)` to interface
3. Implement in adapters

### Phase 5: Tests
1. Test deduplication with `created` flag
2. Test upload history recording
3. Test `userContext` storage and retrieval
4. Test `userContext` size limit enforcement
5. Test duplicate detection with proper result

### Phase 6: Documentation
1. Update README with new API
2. Update AGENTS.md with new patterns
3. Add migration guide to CHANGELOG

## Breaking Changes

### Version 2.0.0

**Interface Change:**
```typescript
// Before (1.x)
storeDocument(content, format, metadata?): Promise<string>

// After (2.0.0)
storeDocument(content, format, metadata?): Promise<StoreResult>
```

**Migration:**
```typescript
// Before
const docId = await store.storeDocument(content, 'yaml', { filename: 'api.yaml' });

// After - Simple (just need ID)
const { documentId } = await store.storeDocument(content, 'yaml', { 
  filename: 'api.yaml' 
});

// After - Full (check if duplicate)
const result = await store.storeDocument(content, 'yaml', { 
  filename: 'api.yaml',
  userContext: '/workspace/api.yaml'
});
if (result.isDuplicate) {
  console.log(`Duplicate found, first uploaded ${result.existingSince}`);
  console.log(`This is upload #${result.uploadCount}`);
}
```

## Benefits

1. ✅ **Audit Trail**: Complete history of all uploads, even duplicates
2. ✅ **User Awareness**: Users know immediately if content is duplicate
3. ✅ **Context Preservation**: All upload contexts preserved (filename, user, etc.)
4. ✅ **Deduplication**: Still efficient storage (content stored once)
5. ✅ **Traceability**: Can answer "who uploaded this and when?"
6. ✅ **Flexibility**: User context field for arbitrary references

## Alternatives Considered

### Alternative A: Update filename on duplicate
**Rejected**: Loses original filename, keeps changing

### Alternative B: Array of filenames in metadata
**Rejected**: Mixes content metadata with upload context, no timestamps per filename

### Alternative C: Keep current behavior
**Rejected**: Users have no way to know it's a duplicate, filename mismatch

## Open Questions

1. **Retention**: Should old upload history be pruned? If so, when?
2. **Indexing**: Should we index userContext for search?
3. **Quota**: Should upload history count toward storage quota?
4. **Backward Compat**: Provide shim for 1.x interface?

## Timeline

- **Version 1.1.0** (Current): PassThroughDocumentStore rename
- **Version 2.0.0** (Next): Upload history implementation
- **Estimated**: 2-3 days development + testing

## References

- Original issue: Test failures with duplicate content
- Related: [AGENTS.md](../AGENTS.md) - AI development guide
- Related: [CHANGELOG.md](../CHANGELOG.md) - Version history
