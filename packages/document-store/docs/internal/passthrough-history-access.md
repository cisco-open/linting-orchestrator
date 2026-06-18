# PassThrough History Access Design

**Version**: 2.2.0  
**Date**: December 18, 2025  
**Status**: Implemented

## Problem Statement

When `PassThroughDocumentStore` is used in integration scenarios (e.g., Spectify reading from MCP's uploads), upload history is unavailable even though the underlying system (MCP) uses `LocalDocumentStore` and tracks full upload history.

This creates a **feature gap**:
- **Standalone mode** (`LocalDocumentStore`): Full upload history, duplicate detection, audit trail
- **Integration mode** (`PassThroughDocumentStore`): No history access, can't detect duplicates, no audit trail

## Real-World Scenario

**Setup:**
1. MCP OpenAPI Analyzer runs on port 3002 using `LocalDocumentStore`
   - Users upload documents via MCP's HTTP API
   - MCP tracks upload history in `./datastore/upload-history/`
2. Spectify runs on port 3003 using `PassThroughDocumentStore`
   - Points to MCP's `./datastore/documents/` for read-only access
   - Cannot access `./datastore/upload-history/` (different adapter)

**User Impact:**
- User uploads `api.yaml` to MCP (upload #1)
- MCP records: `{documentId: abc-123, uploadId: xyz-1, filename: 'api.yaml', isDuplicate: false}`
- User uploads same content as `openapi.yaml` to MCP (upload #2)
- MCP records: `{documentId: abc-123, uploadId: xyz-2, filename: 'openapi.yaml', isDuplicate: true, uploadCount: 2}`
- User lints document via Spectify:
  - ❌ Spectify can't tell it's been uploaded twice
  - ❌ Spectify can't show original filename was `api.yaml`
  - ❌ Spectify can't show upload count for audit

## Design Options Considered

### Option 1: No History Access (Current State)

**Description:** PassThroughDocumentStore remains purely read-only for documents, no history access.

**Pros:**
- Simple, clean separation
- True "pass-through" - no assumptions about external system
- Works with any document source (not just document-store-based systems)

**Cons:**
- Feature gap between standalone and integration modes
- Lost opportunity for audit/compliance visibility
- Can't leverage existing history infrastructure

**Verdict:** ❌ Rejected - Creates poor user experience when both systems use document-store

### Option 2: Require History Access (Strict)

**Description:** PassThroughDocumentStore always expects upload-history directory to exist.

**Pros:**
- Feature parity with LocalDocumentStore
- Simple implementation (no conditionals)

**Cons:**
- Breaks when external system doesn't use document-store library
- Limits reusability (can't point at arbitrary upload directories)
- Fails if external system structured differently

**Verdict:** ❌ Rejected - Too rigid, breaks compatibility

### Option 3: Optional History Access (Chosen) ✅

**Description:** PassThroughDocumentStore **attempts** to load upload history if available, gracefully degrades if not.

**Implementation:**
```typescript
class PassThroughDocumentStore {
  private uploadHistoryManager?: UploadHistoryManager;
  
  constructor(config: MCPStoreConfig) {
    // Primary: document access (required)
    this.config = config;
    
    // Optional: upload history access
    this.initializeHistoryAccess();
  }
  
  private async initializeHistoryAccess(): Promise<void> {
    // Try conventional location (sibling to uploads directory)
    const historyDir = path.join(this.config.uploadsDir, '../upload-history');
    
    try {
      await fs.access(historyDir);
      this.uploadHistoryManager = new UploadHistoryManager({
        historyDir,
        enablePersistence: true
      });
      await this.uploadHistoryManager.initialize();
      this.logger.info('Upload history loaded (read-only)', { historyDir });
    } catch {
      this.logger.info('No upload history available (external system may not track it)');
      // Continue without history - not an error
    }
  }
  
  async getUploadHistory(documentId: string): Promise<UploadHistory[]> {
    if (!this.uploadHistoryManager) {
      return []; // Graceful degradation
    }
    return this.uploadHistoryManager.getUploadHistory(documentId);
  }
  
  async getUpload(uploadId: string): Promise<UploadHistory | undefined> {
    if (!this.uploadHistoryManager) {
      return undefined; // Graceful degradation
    }
    return this.uploadHistoryManager.getUpload(uploadId);
  }
}
```

**Behavior Matrix:**

| External System | History Directory | Behavior |
|----------------|-------------------|----------|
| MCP (document-store) | `./datastore/upload-history/` exists | ✅ Full history access |
| Custom upload system | No history directory | ⚠️ No history, returns empty array |
| Legacy system | Different structure | ⚠️ No history, logs warning |

**Pros:**
- ✅ Feature parity when possible (MCP + Spectify integration)
- ✅ Graceful degradation when not available
- ✅ No breaking changes to existing behavior
- ✅ Clear logging for debugging
- ✅ Best of both worlds

**Cons:**
- Slightly more complex initialization
- Assumes conventional directory structure (`../upload-history`)

**Verdict:** ✅ **CHOSEN** - Optimal balance of functionality and compatibility

## Design Rationale

### Why Optional is Better Than Required

**Scenario 1: Both use document-store** (e.g., MCP + Spectify)
```
mcp-openapi-analysis/
├── datastore/
│   ├── documents/        ← PassThrough points here
│   └── upload-history/   ← PassThrough finds this automatically
```
**Result:** Full feature parity, best user experience

**Scenario 2: External system without document-store**
```
external-api-gateway/
└── uploads/              ← PassThrough points here
    (no upload-history)
```
**Result:** Works fine, just no history available (expected)

### Graceful Degradation Pattern

```typescript
// Consumer code works identically in both cases
const history = await store.getUploadHistory(documentId);

// Case 1: History available
console.log(`Found ${history.length} uploads`); // "Found 5 uploads"

// Case 2: No history
console.log(`Found ${history.length} uploads`); // "Found 0 uploads"
// Not an error - just means no history tracked
```

## Implementation Checklist

- [x] Add optional `UploadHistoryManager` to PassThroughDocumentStore
- [x] Implement `initializeHistoryAccess()` with try-catch
- [x] Add `getUploadHistory()` with graceful return
- [x] Add `getUpload()` with graceful return
- [x] Update logging to distinguish "not found" vs "not available"
- [x] Add tests for both with-history and without-history scenarios
- [x] Update README with integration examples
- [x] Document in CHANGELOG

## Testing Strategy

```typescript
describe('PassThroughDocumentStore with history', () => {
  it('loads history if available', async () => {
    // Setup: Create uploads dir + upload-history dir
    const history = await store.getUploadHistory(documentId);
    expect(history.length).toBeGreaterThan(0);
  });
  
  it('returns empty array if history not available', async () => {
    // Setup: Only uploads dir, no upload-history
    const history = await store.getUploadHistory(documentId);
    expect(history).toEqual([]); // Not an error
  });
  
  it('logs appropriate message based on history availability', async () => {
    // Verify logging reflects actual state
  });
});
```

## Migration Impact

### For Spectify
**Before:**
```typescript
// Integration mode - no history access
const store = new PassThroughDocumentStore({
  uploadsDir: '../mcp-openapi-analysis/datastore/documents'
});
// getUploadHistory() not available
```

**After:**
```typescript
// Integration mode - automatic history access
const store = new PassThroughDocumentStore({
  uploadsDir: '../mcp-openapi-analysis/datastore/documents'
});
await store.initialize();
const history = await store.getUploadHistory(documentId); // ✅ Works!
```

### For MCP
**No changes required** - MCP continues using LocalDocumentStore as before

### For Custom Integrations
**No changes required** - Existing PassThroughDocumentStore usage continues working, just gains optional history capability

## Future Enhancements

### Configurable History Location
```typescript
interface MCPStoreConfig {
  uploadsDir: string;
  historyDir?: string; // Override default '../upload-history'
}
```

### Cross-System History Sync
If multiple systems need to share history, implement history replication or shared storage backend.

## Conclusion

**Optional history access** provides the best user experience without breaking compatibility. When both systems use document-store library (like MCP + Spectify), users automatically get full audit trail and duplicate detection across the integration boundary. When external systems don't provide history, the system gracefully degrades without errors.

This design follows the **principle of least surprise**: features work when infrastructure supports them, degrade gracefully when not available, and never break existing functionality.
