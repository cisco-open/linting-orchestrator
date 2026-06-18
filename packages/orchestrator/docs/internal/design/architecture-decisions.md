# Architecture Decisions

**Date:** November 18, 2025  
**Updated:** December 18, 2025  
**Project:** Spectify - Quality Assurance for OpenAPI

This document captures the key architectural decisions made during the design phase, along with the rationale and trade-offs considered.

---

## Table of Contents

1. [Worker-Per-Ruleset Architecture](#worker-per-ruleset-architecture)
2. [Document Affinity Caching](#document-affinity-caching)
3. [Zero-Copy File Path References](#zero-copy-file-path-references)
4. [Whole Execution Mode (Default)](#whole-execution-mode-default)
5. [Pluggable Document Store](#pluggable-document-store) ⭐ **NEW**
6. [Shared Filesystem Integration](#shared-filesystem-integration)
7. [LRU Cache Strategy](#lru-cache-strategy)

---

## Worker-Per-Ruleset Architecture

### Decision
Each worker thread is permanently assigned to a **specific ruleset** (not individual rules), with the ruleset pre-loaded at worker initialization.

### Rationale

**Original Design Consideration:** Worker-Per-Rule
- Each worker loads one individual rule
- Jobs broken into 50+ tasks for a 50-rule ruleset
- Workers execute one rule at a time

**Why Worker-Per-Ruleset is Better:**

1. **Spectral Performance Optimization**
   - Spectral is designed to load an entire ruleset once and run all rules in a single document traversal
   - Splitting into individual rules would require:
     - Loading the same ruleset 50 times (once per worker)
     - Complex rule extraction/isolation logic
     - Multiple document traversals instead of one

2. **Memory Efficiency**
   - Worker-Per-Ruleset: 5-6 workers (one per ruleset) = manageable (laptop: max 15, server: max 30)
   - Worker-Per-Rule: 50+ workers per ruleset = memory explosion

3. **Ruleset Integrity**
   - Some rulesets have interdependent rules or shared state
   - Keeping them together preserves this integrity

4. **Simpler Architecture**
   - Worker management becomes straightforward
   - One worker per ruleset, clear identity

5. **Startup Performance**
   - Ruleset load time: 200-500ms (parse YAML, compile functions)
   - Loading once per worker vs. on every task execution is significant

### Trade-offs

| Aspect | Worker-Per-Rule | Worker-Per-Ruleset |
|--------|-----------------|-------------------|
| Memory Usage | Higher (50+ workers) | Lower (5-6 workers) |
| Spectral Efficiency | Poor (multiple parses) | Optimal (single parse) |
| Complexity | High (task distribution) | Low (simple routing) |
| Scalability | Limited by rule count | Limited by ruleset count |

### Impact on Performance

```
Worker-Per-Rule (original):
  Ruleset load: 200ms × 50 rules = 10,000ms overhead
  Execution: 100ms per rule
  Total: 10,100ms for 50 rules

Worker-Per-Ruleset (chosen):
  Ruleset load: 200ms (once at initialization)
  Execution: 100ms for all rules (single pass)
  Total: 300ms for 50 rules
  
Performance improvement: 97% faster! 🚀
```

---

## Document Affinity Caching

### Decision
Workers cache the most recently processed document in memory. The orchestrator tracks which workers have which documents cached and routes subsequent jobs to workers with the target document already loaded.

### Rationale

**Scenario:** Multiple rulesets need to run against the same document

```
Without affinity:
  Worker-pubhub: Load doc-123 (20ms), run ruleset (100ms)
  Worker-oas: Load doc-123 (20ms), run ruleset (150ms)
  Worker-cisco: Load doc-123 (20ms), run ruleset (80ms)
  Total: 60ms loading + 330ms execution = 390ms

With affinity:
  Worker-pubhub: Load doc-123 (20ms), run ruleset (100ms)
  Worker-oas: Load doc-123 (20ms), run ruleset (150ms)
  Worker-cisco: CACHE HIT (0ms), run ruleset (80ms) ⚡
  Total: 40ms loading + 330ms execution = 370ms
```

**For large documents (10MB+):**
```
Without affinity: 5 rulesets × 200ms load = 1000ms loading overhead
With affinity: 200ms + (4 × 0ms cache hits) = 200ms loading overhead
Improvement: 80% faster on subsequent jobs! 🎯
```

### Implementation

```typescript
// Orchestrator tracks document-to-worker mappings
private documentWorkerIndex = new Map<string, Set<string>>();
// documentId -> Set of workerIds that have this doc cached

// Worker caches last document
let cachedDocument: any = null;
let cachedDocumentId: string | null = null;

// Routing logic
if (cachedDocumentId === documentId) {
  return cachedDocument;  // CACHE HIT
} else {
  const content = await fs.readFile(documentPath, 'utf-8');
  cachedDocument = JSON.parse(content);
  cachedDocumentId = documentId;
}
```

### Trade-offs

**Benefits:**
- ✅ 10-200ms saved per cache hit
- ✅ Especially effective for large documents
- ✅ Common use case: AI agent runs multiple rulesets on same doc

**Costs:**
- Memory overhead: ~10-50MB per worker (cached document)
- Complexity: Orchestrator must track affinity

**Mitigation:**
- LRU eviction (keep only 1 document per worker)
- Size limits (50MB max per worker)
- Time-based eviction (5 minutes idle)

---

## Pluggable Document Store

### Decision
Document storage uses a **pluggable adapter pattern** (similar to result storage), allowing Spectify to:
- Operate as a standalone service with built-in document storage
- Integrate with MCP OpenAPI Analyzer as one storage option
- Support cloud storage backends (S3, GCS, Azure) in the future

### Rationale

**Original Design Problem:**
- Result storage was pluggable (`LintResultStorage` interface: memory/Redis/custom)
- Document storage was hardcoded to MCP's filesystem (`DocumentAccessor`)
- This created confusion: Is Spectify standalone or an MCP module?

**Why Pluggable Document Store:**

1. **Consistency**: Matches existing `LintResultStorage` pattern
2. **Independence**: Spectify can run without MCP (truly standalone)
3. **Flexibility**: Users choose deployment model:
   - **Standalone mode**: Built-in document upload and storage
   - **MCP integration mode**: Use MCP as document backend
   - **Cloud mode**: S3/GCS/Azure storage (future)
4. **Backward Compatible**: Default to MCP mode for existing users
5. **Reusability**: Can leverage MCP's proven storage components

### Storage Adapters

```typescript
// Abstract interface (similar to LintResultStorage)
interface DocumentStoreAdapter {
  initialize(): Promise<void>;
  storeDocument(content: string, format: 'json' | 'yaml'): Promise<string>;
  getDocument(documentId: string): Promise<StoredDocument | undefined>;
  getDocumentPath(documentId: string): Promise<string>;  // For workers
  listDocuments(): Promise<DocumentMetadata[]>;
  deleteDocument(documentId: string): Promise<void>;
}

// Implementation 1: LocalDocumentStore (standalone)
class LocalDocumentStore implements DocumentStoreAdapter {
  // Spectify manages own documents
  // Enables POST /documents upload endpoint
  // Uses MCP's DatastoreManager (copied)
}

// Implementation 2: MCPDocumentStore (integration)
class MCPDocumentStore implements DocumentStoreAdapter {
  // Reads from MCP's ./uploads/ directory
  // No upload endpoint (users upload to MCP)
  // Current behavior (backward compatible)
}

// Implementation 3: S3DocumentStore (future)
class S3DocumentStore implements DocumentStoreAdapter {
  // Cloud storage with local cache
}
```

### Configuration Examples

**Standalone Mode:**
```yaml
documentStore:
  type: local
  uploadsDir: ./uploads
  ttlHours: 24
  quotaGB: 10
```

**MCP Integration Mode (default for backward compatibility):**
```yaml
documentStore:
  type: mcp
  uploadsDir: ../mcp-openapi-analysis/uploads
  httpFallbackUrl: http://localhost:3002
```

### Impact

**Benefits:**
- ✅ Spectify is truly standalone (no MCP required)
- ✅ Can integrate with MCP as optional backend
- ✅ Consistent architecture (both storages pluggable)
- ✅ Reuse 600+ lines of battle-tested MCP code

**Trade-offs:**
- ⚠️ More abstraction (but follows existing pattern)
- ⚠️ Need to copy/adapt MCP components for LocalDocumentStore

**See also:** [Pluggable Document Store Design](PLUGGABLE_DOCUMENT_STORE.md) for complete specification

---

## Zero-Copy File Path References

### Decision
Pass **file paths** (not document content) from orchestrator to workers via message passing. Workers load documents directly from the filesystem.

### Rationale

**Worker Thread Message Passing Overhead:**

```typescript
// ❌ BAD: Structured clone copies entire document
worker.postMessage({
  type: 'execute',
  documentContent: hugeOpenAPIObject  // 50MB copied to worker!
});

// ✅ GOOD: Only path string transferred
worker.postMessage({
  type: 'execute',
  documentPath: '/uploads/doc-uuid.json',  // ~100 bytes
  documentId: 'doc-uuid'
});
```

**Performance Impact:**

| Approach | Data Transfer | Memory Copy | Typical Latency |
|----------|--------------|-------------|-----------------|
| Pass content | 50MB document | Yes (structured clone) | 100-200ms |
| Pass path | 100 bytes | No | 1-5ms |

**Additional Benefits:**

1. **OS Filesystem Cache**: Multiple workers reading same file benefit from kernel page cache
2. **Worker Independence**: Each worker loads document into its own heap
3. **Memory Efficiency**: Document not duplicated in orchestrator's memory

### Implementation

```typescript
// Orchestrator (main thread)
const documentPath = this.documentAccessor.getDocumentPath(documentId);
await this.workerPool.assignTask({
  documentPath,  // Pass path, not content
  documentId,
  rulesetName
});

// Worker (worker thread)
const content = await fs.readFile(msg.documentPath, 'utf-8');
const document = JSON.parse(content);
```

---

## Whole Execution Mode (Default)

### Decision
By default, execute entire rulesets in a single pass. Support for "split mode" (executing individual rules separately) is designed but marked as `NOT_IMPLEMENTED` for MVP.

### Rationale

**Spectral's Design Philosophy:**
- Spectral traverses the document once
- Evaluates all rules during that single traversal
- Splitting rules would require multiple traversals

**When Split Mode Would Make Sense:**
- Custom/LLM-based rules that are extremely slow (>30s per rule)
- Rules that are I/O bound (calling external APIs)
- Independent rules with no shared state

**Why Defer Split Mode:**
- Not needed for Spectral rulesets (always run whole)
- Adds significant complexity
- Can be added later if custom rules require it

### Configuration

```yaml
# config/default.yaml
rulesets:
  executionDefaults:
    mode: "whole"  # Default for all rulesets
    
  execution:
    pubhub:
      mode: "whole"  # Spectral ruleset (always whole)
      
    custom-llm-security:
      mode: "split"  # NOT_IMPLEMENTED: throws exception
      # Will be implemented if needed for slow custom rules
```

### Code Pattern

```typescript
if (rulesetConfig.mode === 'split') {
  throw new Error(
    `Split execution mode: NOT_IMPLEMENTED - use mode: 'whole' for MVP. ` +
    `Split mode will be implemented if custom rulesets require it.`
  );
  // NOT_IMPLEMENTED: Requires:
  // - Parse splitStrategy (by-rule, by-category)
  // - Create workers per rule/category
  // - Parallel execution and result aggregation
}
```

---

## Shared Filesystem Integration

### Decision
Orchestrator directly accesses the MCP server's document store via shared filesystem (`../mcp-openapi-analysis/uploads`) instead of HTTP API calls.

### Rationale

**MCP Server Document Store:**
```typescript
// Stores documents on filesystem
storageDir: ./uploads
// Large documents (>1MB) persisted: uploads/{uuid}.json
```

**Three Communication Options:**

**Option A: HTTP API (Discarded)**
```typescript
const response = await fetch(`http://localhost:3002/documents/${documentId}`);
const doc = await response.json();
```
- ❌ HTTP overhead (20-50ms)
- ❌ JSON serialization/deserialization
- ❌ Network stack involvement for local communication

**Option B: Shared Filesystem (Chosen)**
```typescript
const filePath = path.join('../mcp-openapi-analysis/uploads', `${documentId}.json`);
const content = await fs.readFile(filePath, 'utf-8');
const doc = JSON.parse(content);
```
- ✅ No HTTP overhead
- ✅ OS filesystem cache benefits
- ✅ Direct access (10-20ms)

**Option C: Hybrid (Fallback)**
```typescript
// Try filesystem first, fallback to HTTP
try {
  return await fs.readFile(filePath, 'utf-8');
} catch {
  return await fetch(`http://localhost:3002/documents/${documentId}`);
}
```

**Chosen: Option B with fallback configuration**

### Configuration

```yaml
documentStore:
  type: "filesystem"
  baseDir: "../mcp-openapi-analysis/uploads"
  fallbackHttp: "http://localhost:3002"  # Optional fallback
```

### Deployment Assumptions

- Orchestrator and MCP server run on **same machine**
- Shared filesystem accessible to both processes
- Future: Can extend to network filesystems (NFS, S3 via FUSE) for distributed deployment

---

## LRU Cache Strategy

### Decision
Each worker caches **one document** (most recently used). New documents automatically evict the old cached document.

### Rationale

**Cache Eviction Strategies Considered:**

**Option 1: LRU per worker (Chosen)**
```typescript
// Each worker keeps only 1 document
// New document evicts old document automatically
const MAX_DOCUMENTS_PER_WORKER = 1;
```
- ✅ Simplest to implement
- ✅ Predictable memory usage
- ✅ Sufficient for common use case (multiple rulesets on same doc)

**Option 2: Size-based**
```typescript
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB per worker
if (documentSize + cachedSize > MAX_CACHE_SIZE) {
  evictCachedDocument();
}
```
- ⚠️ More complex
- ✅ Better memory control
- ❓ Unclear benefit over Option 1

**Option 3: Time-based**
```typescript
// Evict documents not used in 5 minutes
setInterval(() => {
  if (lastDocumentUse < Date.now() - 5 * 60 * 1000) {
    evictCachedDocument();
  }
}, 60000);
```
- ⚠️ Adds background timers
- ✅ Frees memory when idle
- 🔄 Can be added later if needed

**Chosen Strategy: Option 1 (LRU with max=1) + Option 3 (time-based eviction)**

### Implementation

```typescript
// Worker state
let cachedDocument: any = null;
let cachedDocumentId: string | null = null;
let lastDocumentUse: Date = new Date();

// Task execution
if (cachedDocumentId === documentId) {
  // Cache hit
  lastDocumentUse = new Date();
  return cachedDocument;
} else {
  // Cache miss - evict old, load new
  cachedDocument = await loadDocument(documentPath);
  cachedDocumentId = documentId;
  lastDocumentUse = new Date();
}

// Background eviction (every 60s)
setInterval(() => {
  if (Date.now() - lastDocumentUse.getTime() > 5 * 60 * 1000) {
    cachedDocument = null;
    cachedDocumentId = null;
  }
}, 60000);
```

### Configuration

```yaml
workerPool:
  documentCache:
    enabled: true
    maxDocumentsPerWorker: 1       # LRU limit
    maxCacheSizePerWorker: 52428800  # 50MB (safety limit)
    evictAfterMinutes: 5           # Time-based eviction
```

---

## Performance Summary

**Combined Optimization Stack:**

| Optimization | Time Saved | Use Case |
|--------------|------------|----------|
| Worker-per-ruleset (pre-loaded) | 200-500ms | Every job |
| Document affinity (cache hit) | 10-200ms | Subsequent jobs on same doc |
| File path references (zero-copy) | 50-100ms | Every job |
| **Total Savings** | **260-800ms** | **Per subsequent job** |

**Real-World Scenario:**

```
AI Agent: "Lint petstore.yaml with all 5 rulesets"

Without optimizations:
  5 × (500ms ruleset load + 200ms doc load + 100ms execution) = 4000ms

With optimizations:
  First job: 500ms + 200ms + 100ms = 800ms
  Next 4 jobs: 0ms (ruleset cached) + 0ms (doc cached) + 100ms = 100ms each
  Total: 800ms + (4 × 100ms) = 1200ms
  
Performance improvement: 70% faster! 🚀
```

---

## Future Considerations

### Distributed Deployment
Current design assumes same machine. For distributed:
- Replace filesystem access with object storage (S3, MinIO)
- Use Redis for document cache sharing
- Keep worker-per-ruleset model (still optimal)

### Horizontal Scaling
- Multiple orchestrator instances behind load balancer
- Shared Redis for job state and results
- Shared object storage for documents
- Worker pools per instance (no cross-instance workers)

### Custom Rule Engines
- LLM-based rules: May benefit from split mode
- External API calls: Could use split mode for parallel execution
- Implement when needed, architecture supports it (NOT_IMPLEMENTED markers in place)

---

## Related Documentation

- [AGENTS.md](../AGENTS.md) - AI agent implementation guide
- [LINT_ORCHESTRATOR_DESIGN.md](./LINT_ORCHESTRATOR_DESIGN.md) - Complete design specification
- [API.md](./API.md) - HTTP API reference (to be generated)

---

**Last Updated:** November 18, 2025  
**Next Review:** After Phase 1 implementation
