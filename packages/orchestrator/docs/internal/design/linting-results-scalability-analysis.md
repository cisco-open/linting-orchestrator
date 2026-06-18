# Linting Results Scalability Analysis

> **Status**: Implemented (Layer 1 + Layer 2 complete, Layer 3 via tool descriptions)  
> **Date**: 2026-03-14  
> **Scope**: Spectify server, MCP OpenAPI Analyzer, MCP clients  

---

## Table of Contents

- [1. Problem Statement](#1-problem-statement)
- [2. Current Architecture](#2-current-architecture)
  - [2.1 Data Structures](#21-data-structures)
  - [2.2 Result Flow](#22-result-flow)
  - [2.3 Existing Capabilities](#23-existing-capabilities)
- [3. Scale Analysis](#3-scale-analysis)
  - [3.1 Per-Issue Size](#31-per-issue-size)
  - [3.2 Payload Projections](#32-payload-projections)
  - [3.3 Issue Duplication Problem](#33-issue-duplication-problem)
  - [3.4 Multi-Ruleset Amplification](#34-multi-ruleset-amplification)
- [4. Proposed Strategy: Three-Layer Approach](#4-proposed-strategy-three-layer-approach)
  - [4.1 Layer 1 — Spectify: Safety Limit](#41-layer-1--spectify-safety-limit)
  - [4.2 Layer 2 — MCP Server: Intelligent Navigation](#42-layer-2--mcp-server-intelligent-navigation)
  - [4.3 Layer 3 — MCP Client: Result Budget](#43-layer-3--mcp-client-result-budget)
- [5. Detailed Design: MCP Server Lint Result Navigation](#5-detailed-design-mcp-server-lint-result-navigation)
  - [5.1 Enhanced `get_lint_results` Tool](#51-enhanced-get_lint_results-tool)
  - [5.2 New `browse_lint_results` Tool](#52-new-browse_lint_results-tool)
  - [5.3 Statefulness Considerations](#53-statefulness-considerations)
- [6. Filtering Dimensions](#6-filtering-dimensions)
- [7. Approach Comparison](#7-approach-comparison)
- [8. Recommendations](#8-recommendations)

---

## 1. Problem Statement

A large or poorly-structured OpenAPI document can generate **thousands of lint issues** across multiple rulesets. For example, linting a 100K-line document against all 4 configured rulesets (pubhub, contract, documentation, oas — totaling ~43 rules) could realistically produce 2,000–10,000+ issues.

**Current behavior**: Spectify returns ALL issues in a single JSON response via `GET /lint/:jobId/results` with **zero pagination, zero size limits, and zero truncation**. The MCP server's `get_lint_results` tool forwards this entire payload to the LLM.

**Problems at scale**:

| Concern | Impact |
|---------|--------|
| **HTTP payload size** | 8,000 issues ≈ 2.4–4.8 MB JSON (see [Section 3](#3-scale-analysis)) |
| **LLM context window** | 8,000 issues at ~300 bytes each ≈ 2.4M chars ≈ ~600K tokens — exceeds most context windows |
| **LLM processing quality** | Even if it fits, analysis quality degrades significantly on very long outputs |
| **Memory pressure** | Spectify in-memory storage holds full results indefinitely (no eviction) |
| **Usefulness** | A human or LLM rarely needs to inspect all 8,000 issues at once — they need patterns, summaries, and the ability to drill down |

---

## 2. Current Architecture

### 2.1 Data Structures

**`LintIssue`** — the atomic unit of a lint finding:

```typescript
interface LintIssue {
  ruleId: string;              // e.g., "typed-enum"
  code: string;                // e.g., "typed-enum" (usually same as ruleId)
  message: string;             // e.g., "Enum values must be typed"
  severity: 0 | 1 | 2 | 3;    // 0=error, 1=warn, 2=info, 3=hint
  path: (string | number)[];   // e.g., ['paths', '/pets', 'get', 'responses', '200']
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  suggestions?: string[];
}
```

**`LintJobResult`** — the complete result for one job (one ruleset × one document):

```typescript
interface LintJobResult {
  jobId: string;
  documentId: string;
  rulesetName: string;
  rulesetVersion: string;
  status: JobStatus;
  timestamp: Date;
  totalExecutionTime: number;
  summary: {
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    hintCount: number;
  };
  results: LintIssue[];                    // ← ALL issues flat array
  executionDetails: RulesetExecutionResult; // ← contains issues[] AGAIN (duplication!)
}
```

**Key observation**: The `executionDetails.issues` field contains the **same issues** as `results`, effectively doubling the payload size on the wire.

### 2.2 Result Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CURRENT FLOW (no limits)                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  Spectral Engine          Spectify Worker         Spectify Storage               │
│  ┌──────────────┐        ┌──────────────┐        ┌──────────────┐               │
│  │ Run rules    │───────►│ Format diags │───────►│ Store all    │               │
│  │ against doc  │ N diags│ to LintIssue │ N items│ issues in    │               │
│  │ (all rules)  │        │ postMessage()│        │ memory Map   │               │
│  └──────────────┘        └──────────────┘        └──────┬───────┘               │
│                                                         │                       │
│  GET /lint/:jobId/results                               │ no pagination         │
│  ┌──────────────┐        ┌──────────────┐               │ no size limit         │
│  │ MCP server   │◄───────│ Spectify HTTP│◄──────────────┘                       │
│  │get_lint_rslt │ full   │ returns full │ full LintJobResult                    │
│  │              │ JSON   │ LintJobResult│ with ALL issues                       │
│  └──────┬───────┘        └──────────────┘                                       │
│         │                                                                       │
│         │ full JSON (possibly MB)                                               │
│         ▼                                                                       │
│  ┌──────────────┐                                                               │
│  │ LLM (client) │  Must process entire payload in one shot                      │
│  └──────────────┘                                                               │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Existing Capabilities

**What already exists** to partially address this:

| Capability | Where | What it does |
|---|---|---|
| `format` parameter | MCP `get_lint_results` tool | Supports `full`, `summary`, `issues-only` — but `summary` drops ALL issues, and `issues-only`/`full` return ALL issues |
| Job listing pagination | Spectify `GET /lint/jobs` | Paginated with `limit`/`offset` — but this paginates **jobs**, not **issues within a job** |
| `extract_operations` pagination | MCP server | Precedent for page-based pagination with envelope — uses `page`/`page_size` with filtering |

**What does NOT exist**:
- No pagination on `GET /lint/:jobId/results` issues array
- No `maxResults` parameter anywhere in the lint pipeline
- No issue filtering by severity, rule, or path
- No result size or count limits in Spectify config
- No eviction or cap in memory storage for result count per job
- No aggregated statistics (e.g., "top 5 most frequent rules") on lint results

---

## 3. Scale Analysis

### 3.1 Per-Issue Size

Based on the `LintIssue` structure, typical serialized sizes:

| Field | Typical Size | Notes |
|---|---|---|
| `ruleId` | 20–40 bytes | e.g., `"description-for-every-attribute"` |
| `code` | 20–40 bytes | Usually same as ruleId |
| `message` | 30–100 bytes | Human-readable description |
| `severity` | 1 byte | Integer 0–3 |
| `path` | 50–200 bytes | Array of 3–10 segments, deep paths in large docs |
| `range` | ~60 bytes | 4 numbers (optional) |
| `suggestions` | 0–100 bytes | Usually absent |
| JSON overhead | ~50 bytes | Keys, quotes, commas, braces |

**Conservative estimate: ~300 bytes per issue in JSON.**

### 3.2 Payload Projections

| Issue Count | Issues Array | With Duplication (2×) | As LLM Tokens (~4 chars/token) |
|---|---|---|---|
| 100 | ~30 KB | ~60 KB | ~15K tokens |
| 500 | ~150 KB | ~300 KB | ~75K tokens |
| 1,000 | ~300 KB | ~600 KB | ~150K tokens |
| 5,000 | ~1.5 MB | ~3 MB | ~750K tokens |
| **8,000** | **~2.4 MB** | **~4.8 MB** | **~1.2M tokens** |
| 50,000 | ~15 MB | ~30 MB | ~7.5M tokens |

**Context**: Most current LLM context windows are 128K–200K tokens. At 8,000 issues, even `issues-only` format produces ~600K tokens — **3–5× larger than typical context windows**.

### 3.3 Issue Duplication Problem

The current `LintJobResult` stores issues in **two places**:
1. `results: LintIssue[]` — the flat array used for summary counts
2. `executionDetails.issues: LintIssue[]` — the worker's raw output

This is a structural bug independent of scalability, but it **doubles** the wire payload. Any solution should address this regardless.

**Quick fix**: Exclude `executionDetails.issues` from the API response (or stop storing the duplicate). The `executionDetails` metadata (ruleEngine, executionTime, etc.) is still valuable without re-embedding the issues.

### 3.4 Multi-Ruleset Amplification

Currently Spectify runs **one ruleset per job**. If a user lints against all 4 rulesets, that's 4 separate jobs, each with potentially thousands of issues. The MCP workflow requires fetching results for each job separately.

**Current rulesets and rule counts**:

| Ruleset | Display Name | Rules | Category |
|---|---|---|---|
| `pubhub` | PubHub Readiness | ~12 | publishing |
| `contract` | Contract Completeness | ~13 | contract |
| `documentation` | Documentation Quality | ~13 | documentation |
| `oas` | OAS Validation | ~5 | validation |
| **Total** | | **~43** | |

A document that triggers just 200 issues per rule would produce 200 × 43 = 8,600 issues across all rulesets. Real-world documents with systematic problems (e.g., missing descriptions on every attribute) can easily trigger one issue per path, reaching thousands from a single rule.

---

## 4. Proposed Strategy: Three-Layer Approach

The scalability problem exists at three architectural layers, and each should handle it appropriately:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     THREE-LAYER APPROACH                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 3: MCP Client (LLM)                                         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ • Requests summary first, then drills down                  │   │
│  │ • Specifies maxResults budget per request                   │   │
│  │ • Navigates by severity/rule/path as needed                 │   │
│  │ • Makes informed decisions based on statistics              │   │
│  └─────────────────────────────────┬───────────────────────────┘   │
│                                    │                                │
│  Layer 2: MCP Server (intelligence layer)                          │
│  ┌─────────────────────────────────┴───────────────────────────┐   │
│  │ • Paginated result browsing tool                            │   │
│  │ • Filtering by severity, rule, path prefix                  │   │
│  │ • Statistics/aggregation (top rules, severity distribution) │   │
│  │ • Always returns total counts so client can plan            │   │
│  └─────────────────────────────────┬───────────────────────────┘   │
│                                    │                                │
│  Layer 1: Spectify (raw engine)                                    │
│  ┌─────────────────────────────────┴───────────────────────────┐   │
│  │ • Safety limit: max issues per job (e.g., 100,000)          │   │
│  │ • Stores complete results (no intelligence, no filtering)   │   │
│  │ • Supports paginated result retrieval API                   │   │
│  │ • Reports truncation in response if limit was hit           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.1 Layer 1 — Spectify: Safety Limit

**Philosophy**: Spectify is a raw linting engine. It should not filter or truncate results for semantic reasons. However, it MUST have a safety limit to prevent pathological cases (malformed documents, recursive rule triggers, etc.).

**Proposed changes**:

#### A. Maximum Issues Per Job

Add a configurable `maxIssuesPerJob` (default: 100,000):

```yaml
# config example
orchestrator:
  maxIssuesPerJob: 100000  # safety limit
```

**When the limit is reached**:
- The worker **stops collecting** after hitting the limit
- The result is marked with `truncated: true`
- The summary still reflects the **actual** counts discovered before truncation
- The response includes `truncationInfo: { limit: 100000, actualCount: 143267 }`

**Why 100,000?** At ~300 bytes/issue, that's ~30 MB — large but not unreasonable for a server-to-server HTTP response on localhost. This is a safety net, not an operational target.

#### B. Paginated Result Retrieval API

Add query parameters to `GET /lint/:jobId/results`:

```
GET /lint/:jobId/results?offset=0&limit=100&severity=0&rule=typed-enum
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `offset` | integer | 0 | Skip first N issues |
| `limit` | integer | (all) | Max issues to return |
| `severity` | integer | (all) | Filter: 0=error, 1=warn, 2=info, 3=hint |
| `rule` | string | (all) | Filter by ruleId (exact match) |

**When pagination is used**, the response shape changes slightly:

```json
{
  "jobId": "...",
  "summary": { "totalIssues": 8000, "errorCount": 120, "warningCount": 7880, ... },
  "results": [ /* paginated subset */ ],
  "pagination": {
    "offset": 0,
    "limit": 100,
    "returned": 100,
    "totalMatching": 8000,
    "hasMore": true
  },
  "filters": {
    "severity": null,
    "rule": null
  }
}
```

**When NO pagination params are provided**, the behavior is unchanged — full results returned (backward compatible).

**Key principle**: The `summary` object is ALWAYS returned with full counts regardless of pagination. This allows clients to understand the scope before drilling in.

#### C. Fix Issue Duplication

Remove `executionDetails.issues` from the API response — include only the metadata fields, not the redundant issues copy. This is a separate fix but reduces wire payload by ~50%.

### 4.2 Layer 2 — MCP Server: Intelligent Navigation

The MCP server is the **intelligence layer** between the raw Spectify engine and the LLM. This is where the most impactful improvements belong.

**Design principle**: The MCP server should give the LLM enough information to make **informed navigational decisions** without overwhelming it with data.

Two complementary approaches:

#### Approach A: Enhance `get_lint_results` with Pagination + Stats

Modify the existing tool to support pagination and always return statistics:

```typescript
// Enhanced inputSchema
{
  jobId: z.string(),
  format: z.enum(['full', 'summary', 'issues-only', 'stats']).optional(),
  page: z.number().optional(),
  pageSize: z.number().optional(),     // default: 50, max: 200
  severity: z.enum(['error', 'warn', 'info', 'hint']).optional(),
  rule: z.string().optional(),
}
```

When `format: 'stats'` — return only aggregated statistics (no issues):

```json
{
  "jobId": "abc-123",
  "status": "completed",
  "summary": {
    "totalIssues": 8000,
    "errorCount": 120,
    "warningCount": 6500,
    "infoCount": 1200,
    "hintCount": 180
  },
  "ruleBreakdown": [
    { "rule": "description-for-every-attribute", "count": 3200, "severity": 1 },
    { "rule": "examples-for-every-schema", "count": 2100, "severity": 1 },
    { "rule": "info-contact", "count": 1, "severity": 1 },
    ...
  ],
  "topPaths": [
    { "pathPrefix": "paths./pets", "count": 450 },
    { "pathPrefix": "paths./users", "count": 380 },
    ...
  ]
}
```

#### Approach B: New Dedicated `browse_lint_results` Tool

Create a separate navigation tool optimized for exploration:

```typescript
// New tool: browse_lint_results
{
  jobId: z.string(),
  page: z.number().optional(),
  pageSize: z.number().optional(),
  severity: z.enum(['error', 'warn', 'info', 'hint']).optional(),
  rule: z.string().optional(),
  pathPrefix: z.string().optional(),
}
```

This separates concerns:
- `get_lint_results` remains the "get the answer" tool (summary or full)
- `browse_lint_results` is the "explore details" tool with navigation controls

See [Section 5](#5-detailed-design-mcp-server-lint-result-navigation) for detailed design of both approaches.

### 4.3 Layer 3 — MCP Client: Result Budget

The MCP client (LLM) should be guided to:

1. **Always request `summary` or `stats` first** — understand the scope
2. **Drill down by severity** — errors first, then warnings if needed
3. **Drill down by rule** — focus on one rule pattern at a time
4. **Use pagination** — request small pages (50–100 issues) and decide whether to continue

This is achieved through the **tool descriptions** (which guide the LLM's behavior) and the **response metadata** (which informs the LLM's next action).

**Guiding the LLM via tool description**:

```
Purpose: Retrieve lint results for a completed job.

IMPORTANT: For jobs with many issues (100+), ALWAYS start with format="stats" 
to understand the scope. Then drill down by severity or rule using pagination.
Do NOT request format="full" or "issues-only" for large result sets.

Workflow for large results:
1. Call with format="stats" → see total counts and rule breakdown
2. Call with severity="error" + page=1 → review errors first
3. Call with rule="specific-rule" + page=1 → deep-dive into a pattern
4. Summarize findings for the user based on sampled pages
```

**Response metadata that enables navigation**:

Every paginated response MUST include:

```json
{
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "totalMatching": 3200,
    "totalPages": 64,
    "hasMore": true
  },
  "summary": {
    "totalIssues": 8000,
    "errorCount": 120,
    "warningCount": 6500,
    "infoCount": 1200,
    "hintCount": 180
  },
  "guidance": "Showing 50 of 3200 warning issues. Use pagination to see more, or filter by rule for patterns."
}
```

The `summary` is always the complete job summary (not the filtered subset), so the LLM always knows the full picture.

---

## 5. Detailed Design: MCP Server Lint Result Navigation

### 5.1 Enhanced `get_lint_results` Tool

**Minimal changes to existing tool** — add pagination + filters + stats format:

```typescript
server.registerTool('get_lint_results', {
  description: `Purpose: Retrieve lint findings for a completed lint job.

IMPORTANT - Scalability workflow:
- For any job, start with format="stats" to see total counts and rule breakdown
- If totalIssues > 100, do NOT use format="full" — use pagination instead
- Filter by severity (errors first) or by specific rule to focus analysis
- Each page returns up to pageSize issues with navigation metadata

Formats:
- "stats": Aggregated statistics only — rule breakdown, severity counts (recommended first call)
- "summary": Job summary with counts (no individual issues)
- "issues-only": Paginated issues array (supports page, pageSize, severity, rule filters)
- "full": Complete result — ONLY use for small result sets (<100 issues)

Filtering:
- severity: Filter issues by severity level (error, warn, info, hint)
- rule: Filter issues by exact rule ID (e.g., "description-for-every-attribute")
- pathPrefix: Filter issues whose path starts with this prefix (e.g., "paths./pets")
- Filters can be combined (AND logic)

Returns pagination metadata: page, pageSize, totalMatching, totalPages, hasMore`,

  inputSchema: {
    jobId: z.string().describe('The job ID returned from lint_document'),
    format: z.enum(['full', 'summary', 'issues-only', 'stats']).optional()
      .describe('Result format. Default: "full". Use "stats" first for large results.'),
    page: z.number().optional()
      .describe('Page number (1-indexed). Only for "issues-only" and "full" formats.'),
    pageSize: z.number().optional()
      .describe('Issues per page (default: 50, max: 200). Only for paginated requests.'),
    severity: z.enum(['error', 'warn', 'info', 'hint']).optional()
      .describe('Filter issues by severity level'),
    rule: z.string().optional()
      .describe('Filter issues by exact rule ID'),
    pathPrefix: z.string().optional()
      .describe('Filter issues whose path starts with this prefix'),
  },
});
```

**Behavior matrix**:

| format | page/pageSize | Result |
|---|---|---|
| `stats` | ignored | Aggregated statistics, rule breakdown, zero issues |
| `summary` | ignored | Job summary counts only |
| `issues-only` | not set | ALL matching issues (backward compat, capped by Spectify limit) |
| `issues-only` | set | Paginated subset of matching issues |
| `full` | not set | Full LintJobResult (backward compat) |
| `full` | set | Full metadata + paginated issues |

### 5.2 New `browse_lint_results` Tool

**Alternative approach** — dedicated navigation tool:

```typescript
server.registerTool('browse_lint_results', {
  description: `Purpose: Navigate and explore lint results page by page with filtering.

Use this tool to drill down into specific categories of lint issues.
Always call get_lint_results with format="stats" first to understand the scope,
then use this tool to browse specific subsets.

Supports filtering by:
- severity: Focus on errors, warnings, info, or hints
- rule: Focus on a specific rule ID (from stats rule breakdown)
- pathPrefix: Focus on issues in a specific API path

Always returns pagination metadata so you can navigate through results.`,

  inputSchema: {
    jobId: z.string().describe('The job ID returned from lint_document'),
    page: z.number().optional().describe('Page number, 1-indexed (default: 1)'),
    pageSize: z.number().optional().describe('Issues per page (default: 50, max: 200)'),
    severity: z.enum(['error', 'warn', 'info', 'hint']).optional()
      .describe('Filter by severity level'),
    rule: z.string().optional()
      .describe('Filter by rule ID (exact match)'),
    pathPrefix: z.string().optional()
      .describe('Filter issues whose path starts with this prefix'),
  },
});
```

**Response shape** (consistent paginated envelope):

```json
{
  "jobId": "abc-123",
  "documentId": "doc-456",
  "rulesetName": "documentation",

  "issues": [
    {
      "ruleId": "description-for-every-attribute",
      "code": "description-for-every-attribute",
      "message": "Every attribute should have a description",
      "severity": 1,
      "path": ["paths", "/pets", "get", "responses", "200", "content", "application/json", "schema", "properties", "name"],
      "range": { "start": { "line": 42, "character": 8 }, "end": { "line": 42, "character": 20 } }
    }
  ],

  "pagination": {
    "page": 1,
    "pageSize": 50,
    "totalMatching": 3200,
    "totalPages": 64,
    "hasMore": true
  },

  "filters": {
    "severity": "warn",
    "rule": null,
    "pathPrefix": null
  },

  "jobSummary": {
    "totalIssues": 8000,
    "errorCount": 120,
    "warningCount": 6500,
    "infoCount": 1200,
    "hintCount": 180
  }
}
```

### 5.3 Statefulness Considerations

**Critical question**: Where does pagination state live?

#### Option A: Stateless (Recommended)

Pagination is based on the **jobId** — results are already stored in Spectify's storage. Each paginated request simply calls Spectify with `offset` and `limit` parameters:

```
MCP browse_lint_results(jobId, page=3, pageSize=50, severity="error")
  └─► GET http://spectify:3003/lint/{jobId}/results?offset=100&limit=50&severity=0
       └─► Spectify filters in-memory, slices, returns page
```

**Advantages**:
- No state management in MCP server
- Spectify already stores results by jobId
- Multiple clients can browse same results concurrently
- Works with current stateless MCP transport (StreamableHTTP)

**Requirements on Spectify**:
- `GET /lint/:jobId/results` must support `offset`, `limit`, `severity`, `rule` query params
- Filtering happens on the stored `results` array (in-memory for MemoryStorage)
- For in-memory storage, this is a simple `Array.filter().slice()` — very fast

#### Option B: Cursor-Based (Future consideration)

If results were too large for in-memory filtering, a cursor approach could be used:

```
GET /lint/{jobId}/results?cursor=abc123&limit=50
```

This is unnecessary for the current MemoryStorage implementation where filtering an 8,000-element array is sub-millisecond. Only relevant if results are moved to external storage (Redis, PostgreSQL) where offset-based pagination becomes expensive at high offsets.

**Recommendation**: Start with **stateless offset-based** pagination. The jobId is the natural result identifier — no additional state is needed. Cursor-based can be added later if needed for external storage backends.

---

## 6. Filtering Dimensions

Based on the `LintIssue` structure, these are the practical filtering/grouping dimensions:

### By Severity

| Severity | Value | Typical Use Case |
|---|---|---|
| Error | 0 | **Always review first** — spec violations, schema errors |
| Warning | 1 | Quality issues — most common, highest volume |
| Info | 2 | Suggestions and best practices |
| Hint | 3 | Minor style recommendations |

**Why this matters**: In a document with 8,000 issues, the severity distribution is typically heavily skewed. A common pattern is 50–200 errors and 7,000+ warnings. The LLM should address errors first.

### By Rule

Each `LintIssue` has a `ruleId` identifying which rule triggered it. In our current rulesets:

**High-volume rules** (can trigger once per API path/schema/attribute):
- `description-for-every-attribute` — triggers for EVERY schema property missing a description
- `examples-for-every-schema` — triggers for EVERY schema missing examples
- `short-summaries` — triggers for EVERY operation with a long summary

**Low-volume rules** (trigger at most once per document):
- `info-contact` — triggered 0 or 1 time
- `info-license` — triggered 0 or 1 time
- `multi-versions` — triggered 0 or 1 time

**Why this matters**: The `stats` format should include a rule breakdown so the LLM can see that 3,200 of 8,000 issues come from one rule (e.g., `description-for-every-attribute`). The LLM can then:
1. Report "3,200 attributes are missing descriptions" without listing each one
2. Sample a few pages of that rule to understand the pattern
3. Move on to the next rule

### By Path Prefix

The `path` field contains the JSON path to the issue location, e.g.:
- `["paths", "/pets", "get", "responses", "200", ...]`
- `["paths", "/users/{id}", "put", "requestBody", ...]`
- `["components", "schemas", "Pet", "properties", "name"]`

**Path prefix filtering** enables drilling into a specific API endpoint or component:
- `pathPrefix: "paths./pets"` — all issues under the /pets path
- `pathPrefix: "components.schemas"` — all issues in schema definitions
- `pathPrefix: "paths./users"` — all issues in /users endpoints

**Why this matters**: When an LLM is helping fix a specific endpoint, it only needs that endpoint's issues.

### By Ruleset

Currently each job is one ruleset, so filtering by ruleset is achieved by selecting the right jobId. If multi-ruleset jobs are added in the future, a `rulesetName` filter would be needed.

---

## 7. Approach Comparison

### Approach A: Enhance existing `get_lint_results` only

| Dimension | Assessment |
|---|---|
| **Complexity** | Low — extends existing tool |
| **Breaking change** | No — new params are optional, defaults preserve current behavior |
| **LLM usability** | Medium — one tool does many things (format + pagination + filters) |
| **Tool count** | Unchanged (5 lint tools) |
| **Discoverability** | Lower — LLM must read complex description to understand modes |

### Approach B: New `browse_lint_results` tool

| Dimension | Assessment |
|---|---|
| **Complexity** | Low-Medium — new tool but simple logic |
| **Breaking change** | No — additive (new tool, existing tools unchanged) |
| **LLM usability** | High — clear separation: "get results" vs "browse results" |
| **Tool count** | +1 (6 lint tools) |
| **Discoverability** | Higher — dedicated tool name signals its purpose |

### Approach C: Combined (Recommended)

Enhance `get_lint_results` with `stats` format AND add `browse_lint_results`:

```
get_lint_results(format="stats")     → understand scope
get_lint_results(format="summary")   → quick counts
browse_lint_results(page, filters)   → drill down
get_lint_results(format="full")      → small result sets only
```

| Dimension | Assessment |
|---|---|
| **Complexity** | Medium — two tools share Spectify pagination API |
| **Breaking change** | No — existing behavior preserved, new capabilities additive |
| **LLM usability** | Highest — clear workflow: stats → browse → summarize |
| **Tool count** | +1 (6 lint tools) |

---

## 8. Recommendations

### Priority 1: Quick wins (no new tools needed)

1. **Fix issue duplication** — stop including issues in `executionDetails` on the API response. Immediate 50% payload reduction.
2. **Add `maxIssuesPerJob` safety limit** to Spectify config (default: 100,000). Mark truncated results.
3. **Add `stats` format** to existing `get_lint_results` tool — returns rule breakdown and severity counts without any issues.

### Priority 2: Pagination infrastructure

4. **Add `offset`/`limit`/`severity`/`rule` query params** to Spectify `GET /lint/:jobId/results`.
5. **Add `browse_lint_results` MCP tool** with page-based pagination and filters.
6. **Update `get_lint_results` tool description** to guide LLMs toward stats-first workflow.

### Priority 3: Enhanced navigation

7. **Add `pathPrefix` filtering** — enables drilling into specific API paths.
8. **Add rule breakdown statistics** in Spectify API — aggregate issue counts by ruleId before pagination.
9. **Consider `topPaths` statistics** — aggregate by path prefix to show issue hotspots.

### What does NOT need to change

- **Spectify's core architecture** — worker-per-ruleset, in-memory storage, job lifecycle — all remains valid
- **MCP `lint_document`** — async submission is the right pattern regardless of result size
- **MCP `get_lint_status`** — polling pattern is correct
- **Report service notifications** — fire-and-forget with full results is fine (server-to-server, no LLM involved)

### Implementation Order Suggestion

```
Phase 1: Foundation
├── Fix issue duplication in API response
├── Add maxIssuesPerJob config + truncation marker
└── Add "stats" format to get_lint_results

Phase 2: Pagination
├── Add offset/limit/severity/rule params to Spectify API
├── Create browse_lint_results MCP tool
└── Update get_lint_results description with guidance

Phase 3: Advanced Navigation
├── Add pathPrefix filtering
├── Add rule breakdown aggregation endpoint
└── Add path hotspot detection
```

---

## Appendix A: Size Estimation Reference

```
1 issue   ≈ 300 bytes JSON
100       ≈ 30 KB       (safe for any LLM)
500       ≈ 150 KB      (manageable)
1,000     ≈ 300 KB      (approaching limits)
5,000     ≈ 1.5 MB      (exceeds most context windows)
8,000     ≈ 2.4 MB      (far exceeds context windows)
100,000   ≈ 30 MB       (recommended safety limit)
```

## Appendix B: LLM-Guided Workflow Example

A realistic interaction flow for a document with 8,000 issues:

```
User: "Lint this document against the documentation ruleset"

LLM → lint_document(documentId, rulesetName="documentation")
     ← { jobId: "job-123", status: "queued" }

LLM → get_lint_status(jobId="job-123")
     ← { status: "completed", progress: { completedTasks: 1, totalTasks: 1 } }

LLM → get_lint_results(jobId="job-123", format="stats")
     ← { summary: { totalIssues: 8000, errorCount: 45, warningCount: 7800, ... },
         ruleBreakdown: [
           { rule: "description-for-every-attribute", count: 3200, severity: 1 },
           { rule: "examples-for-every-schema", count: 2100, severity: 1 },
           { rule: "error-code-description-consistent", count: 1500, severity: 1 },
           { rule: "info-contact", count: 1, severity: 0 },
           ...
         ] }

LLM → "Your document has 8,000 lint issues: 45 errors and 7,800 warnings.
        The biggest issues are:
        - 3,200 attributes missing descriptions
        - 2,100 schemas missing examples
        - 1,500 inconsistent error descriptions
        Let me check the errors first..."

LLM → browse_lint_results(jobId="job-123", severity="error", page=1, pageSize=50)
     ← { issues: [...45 errors...], pagination: { totalMatching: 45, hasMore: false } }

LLM → "All 45 errors reviewed. Here are the critical fixes needed: ..."

LLM → browse_lint_results(jobId="job-123", rule="description-for-every-attribute", page=1, pageSize=20)
     ← { issues: [...20 samples...], pagination: { totalMatching: 3200, hasMore: true } }

LLM → "Sampled 20 of 3,200 missing-description issues. The pattern is consistent:
        most are under paths /pets and /users. You should add descriptions to all
        schema properties. Would you like me to focus on a specific endpoint?"
```

## Appendix C: Current Ruleset Details

For reference, the complete rule inventory across all configured rulesets:

| Ruleset | Rule ID | Likely Volume | Notes |
|---|---|---|---|
| **pubhub** | `typed-enum` | Medium | Per enum in spec |
| | `duplicated-entry-in-enum` | Low | Per duplicate |
| | `operation-parameters` | Medium | Per operation |
| | `path-params` | Medium | Per path with params |
| | `path-not-include-query` | Low | Per path violation |
| | `operation-operationId-valid-in-url` | Medium | Per operation |
| | `no-eval-in-markdown` | Low | Per markdown field |
| | `no-script-tags-in-markdown` | Low | Per markdown field |
| | `info-version` | 0–1 | Document-level |
| | `short-summaries` | High | Per operation |
| | `success-status-code` | Medium | Per operation |
| | `tag-capitalization-consistent` | Low | Per tag |
| **contract** | `oas3-schema` / `oas2-schema` | Variable | Schema validation issues |
| | `general-schema-definition` | High | Per schema property |
| | `missing-returned-representation` | Medium | Per operation |
| | `error-status-code` | Medium | Per operation |
| | `success-status-code` | Medium | Per operation |
| | `multi-versions` | 0–1 | Document-level |
| | `operationId-required-and-unique` | Medium | Per operation |
| **documentation** | `description-for-every-attribute` | **Very High** | Per schema property |
| | `examples-for-every-schema` | **Very High** | Per schema |
| | `error-code-description-consistent` | High | Per error response |
| | `info-contact` / `info-license` / `license-url` | 0–1 each | Document-level |
| | `operationId-name-case-consistent` | Medium | Per operation |
| | `tag-name-case-consistent` | Low | Per tag |
| **oas** | `oas3-schema` / `oas2-schema` | Variable | Schema validation |
| | `operation-security-defined` | Medium | Per operation |
| | `server-variable-default` | Low | Per server variable |
