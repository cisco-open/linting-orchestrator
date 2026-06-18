# Rule Exclusion & Severity Override

**Date:** 2026-04-09  
**Status:** Design — not yet implemented  
**Server Version:** 0.13.0 (planned)  
**CLI Version:** 0.11.0 (planned)

## Table of Contents

- [Summary](#summary)
- [Motivation](#motivation)
- [Options Evaluated](#options-evaluated)
  - [Option 1: Post-filter results (selected)](#option-1-post-filter-results-selected)
  - [Option 2: Mutate in-memory ruleset before spectral.run()](#option-2-mutate-in-memory-ruleset-before-spectralrun)
  - [Option 3: Dynamic ruleset via extends + severity off](#option-3-dynamic-ruleset-via-extends--severity-off)
  - [Option 4: Spectral internals — programmatic rule.severity override](#option-4-spectral-internals--programmatic-ruleseverity-override)
  - [Option 5: Dedicated override workers (spawn on demand)](#option-5-dedicated-override-workers-spawn-on-demand)
  - [Option 6: Spectral overrides feature](#option-6-spectral-overrides-feature)
  - [Decision rationale](#decision-rationale)
- [Design](#design)
  - [Terminology](#terminology)
  - [API contract](#api-contract)
  - [CLI interface](#cli-interface)
  - [Display conventions](#display-conventions)
  - [Cache behavior](#cache-behavior)
- [Implementation Plan](#implementation-plan)
  - [Phase 1: Types and API contract](#phase-1-types-and-api-contract)
  - [Phase 2: Orchestrator plumbing](#phase-2-orchestrator-plumbing)
  - [Phase 3: Worker post-filter](#phase-3-worker-post-filter)
  - [Phase 4: CLI integration](#phase-4-cli-integration)
  - [Phase 5: OpenAPI spec and schemas](#phase-5-openapi-spec-and-schemas)
  - [Phase 6: Tests](#phase-6-tests)
- [Files Changed](#files-changed)
- [Examples](#examples)
  - [CLI usage examples](#cli-usage-examples)
  - [API request examples](#api-request-examples)
  - [API response examples](#api-response-examples)
- [Test Plan](#test-plan)
- [Future Enhancements](#future-enhancements)

---

## Summary

Add the ability to **exclude rules** or **override rule severity** when linting with a specific ruleset. This is a per-request customization — the underlying ruleset is not modified. Overrides are applied as a post-processing filter on lint results in the worker, after `spectral.run()` completes.

A `ruleOverrides` object is added to the `POST /lint` request body and exposed as `--override` on the CLI. Each key is a rule ID, and the value is either `"off"` (exclude entirely) or a severity string (`"error"`, `"warn"`, `"info"`, `"hint"`).

---

## Motivation

Users often want to adopt a shared organizational ruleset (e.g., `pubhub`, `oas`) but need to suppress specific rules that don't apply to their API, or adjust severity for rules that are advisory rather than mandatory in their context.

Without per-request overrides, users must either:
- Accept all rules as-is (too noisy)
- Fork the ruleset source and maintain a parallel copy (drift-prone)
- Request changes to the shared ruleset (slow, blocks other teams)

Per-request rule overrides solve this by letting the caller customize behavior at lint time, without touching the source ruleset.

---

## Options Evaluated

### Option 1: Post-filter results (selected)

**How:** Run all rules via `spectral.run()` as usual. After execution, in the worker's `executeTask()`, filter out diagnostics for rules set to `"off"` and remap severity for rules with severity overrides.

| Aspect | Assessment |
|--------|-----------|
| Effort | **Lowest** — ~30 lines in `worker.ts` |
| Correctness | Perfect — identical output to never running excluded rules |
| Performance | Excluded rules still execute; overhead is negligible for most rulesets |
| Architecture impact | Minimal — plumb `ruleOverrides` through API → orchestrator → worker message |
| Worker cache | No impact — Spectral instance stays unchanged, workers remain stateless per-request |

### Option 2: Mutate in-memory ruleset before `spectral.run()`

**How:** Before each `spectral.run()`, clone the loaded ruleset, delete excluded rules from its `rules` map, call `spectral.setRuleset(modified)`, execute, then restore.

| Aspect | Assessment |
|--------|-----------|
| Effort | Medium |
| Correctness | Perfect |
| Performance | Better (excluded rules don't execute), but `setRuleset()` recompilation has overhead |
| Architecture impact | Moderate — mutable state in long-lived workers; concurrent requests with different overrides need serialization |
| Worker cache | Complicated — must hold original reference for restore |

### Option 3: Dynamic ruleset via `extends` + severity `off`

**How:** Generate a temporary YAML/JS ruleset that extends the original and sets excluded rules to `"off"`, then `bundleAndLoadRuleset()` it.

| Aspect | Assessment |
|--------|-----------|
| Effort | High — temp file I/O, cleanup, unique paths per exclusion set |
| Correctness | Perfect |
| Performance | Poor — `bundleAndLoadRuleset()` costs 200-500ms per call |
| Architecture impact | Breaks worker-per-ruleset model entirely |

### Option 4: Spectral internals — programmatic `rule.severity` override

**How:** After `setRuleset()`, reach into `spectral.ruleset.rules` and set `rule.severity = -1` (off) or remap severity values directly on the internal `Rule` objects.

| Aspect | Assessment |
|--------|-----------|
| Effort | Medium |
| Correctness | Works today but relies on private API |
| Performance | Best — excluded rules skipped at engine level |
| Risk | **High** — Spectral internal structure is not a public API; may break silently on upgrades |

### Option 5: Dedicated override workers (spawn on demand)

**How:** Spawn a short-lived worker with a modified ruleset for requests that include overrides. Normal requests use cached workers.

| Aspect | Assessment |
|--------|-----------|
| Effort | High |
| Performance | Worst — worker initialization (200-500ms) per request |
| Architecture impact | Cleanest isolation, but expensive and complex |

### Option 6: Spectral `overrides` feature

**How:** Use Spectral's [overrides](https://docs.stoplight.io/docs/spectral/293426e270fac-overrides) feature to disable rules per file pattern.

| Aspect | Assessment |
|--------|-----------|
| Effort | High |
| Correctness | Partial — overrides are resolved at bundle/compile time, not at `run()` time |
| Limitation | Overrides aren't inherited through `extends` in YAML rulesets |
| Architecture impact | Collapses into Option 3 (dynamic ruleset generation) |

**Verdict:** Not viable as a distinct approach. The `overrides` feature targets static per-file/per-path rule configuration in `.spectral.yaml`, not per-request runtime customization. By the time the worker calls `spectral.setRuleset(compiledRuleset)`, overrides have already been flattened.

### Decision rationale

**Option 1 is selected** because:

1. **Lowest risk** — no changes to Spectral instance, worker lifecycle, or caching
2. **Minimal code** — add `ruleOverrides` to the API, thread through orchestrator → worker, filter results
3. **Correct by construction** — identical output to never running excluded rules
4. **Performance is acceptable** — rule execution is fast relative to document parsing (which happens regardless); individual rules typically take <1ms
5. **Easy to upgrade later** — if profiling reveals that certain excluded rules are expensive, Option 2 or 4 can be adopted as a targeted optimization without changing the API contract
6. **No mutable state** — workers remain stateless per-request; no risk of cross-request leakage

---

## Design

### Terminology

| Term | Meaning |
|------|---------|
| **Rule override** | A per-request instruction to change or disable a specific rule |
| **Exclude** | Set a rule to `"off"` — its results are completely removed from output |
| **Severity remap** | Change a rule's severity (e.g., `"error"` → `"warn"`) in the results |
| **Customized ruleset** | A ruleset with active overrides — displayed distinctly in CLI output |

### API contract

Add `ruleOverrides` to the `POST /lint` request body as an optional field.

**`ruleOverrides` schema:**

```typescript
// In LintJobRequest (src/types.ts)
interface LintJobRequest {
  documentId: string;
  rulesetName: string;
  rulesetVersion?: string;
  callbackUrl?: string;
  ruleOverrides?: Record<string, 'off' | 'error' | 'warn' | 'info' | 'hint'>;
  options?: {
    forceRun?: boolean;
    priority?: 'low' | 'normal' | 'high';
  };
}
```

**JSON Schema:**

```json
{
  "ruleOverrides": {
    "type": "object",
    "description": "Per-rule overrides. Keys are rule IDs (as returned by GET /rulesets/:name). Values are 'off' to exclude, or a severity string to remap.",
    "additionalProperties": {
      "type": "string",
      "enum": ["off", "error", "warn", "info", "hint"]
    },
    "example": {
      "oas3-always-use-https": "off",
      "operation-description": "warn"
    }
  }
}
```

**Severity mapping (used in post-filter):**

| Override value | Spectral DiagnosticSeverity |
|----------------|---------------------------|
| `"error"` | `0` |
| `"warn"` | `1` |
| `"info"` | `2` |
| `"hint"` | `3` |
| `"off"` | Remove from results |

**Validation rules:**
- `ruleOverrides` is optional. Omitting it = existing behavior (no overrides).
- Each key must be a non-empty string (rule ID). Keys do not need to match actual rule names in the ruleset — unknown rules are silently ignored (a rule may not trigger for a given document, and the caller shouldn't need to know the full rule catalog).
- Maximum 200 entries to prevent abuse.

### Response enrichment

When overrides are active, the `LintJobResult` and `LintJobStatus` responses include override metadata:

```typescript
// Added to LintJobResult and LintJobStatus
interface LintJobResult {
  // ... existing fields ...
  ruleOverrides?: Record<string, 'off' | 'error' | 'warn' | 'info' | 'hint'>;
}
```

This is a passthrough of the original request's `ruleOverrides`, stored on the job for auditability and display purposes.

### CLI interface

**New `--override` flag on `spectify lint`:**

```
spectify lint <file> [--ruleset <name>] [--override <rules>]
```

Where `<rules>` is a comma-separated list of `rule=severity` pairs:

```bash
# Exclude rules
spectify lint api.yaml --ruleset pubhub --override oas3-always-use-https=off,operation-tags=off

# Change severity
spectify lint api.yaml --ruleset pubhub --override operation-description=warn,info-contact=hint

# Mix exclusion and severity changes
spectify lint api.yaml --ruleset pubhub --override oas3-always-use-https=off,operation-description=warn
```

**Parsing logic:** Split on `,`, then split each token on `=`. Validate that the value is one of `off|error|warn|info|hint`.

### Display conventions

Three levels of detail for overridden rulesets:

**Short form** (compact contexts like job listings, table cells):
```
pubhub*
```
The `*` suffix indicates the ruleset has active overrides. No `*` means vanilla ruleset.

**Long form** (summary header in lint results):
```
Ruleset: pubhub (2 rules excluded, 1 severity override)
```

The format is: `{rulesetName} ({N} rules excluded[, {M} severity override[s]])`

- If only exclusions: `pubhub (3 rules excluded)`
- If only severity changes: `pubhub (2 severity overrides)`
- If both: `pubhub (1 rule excluded, 2 severity overrides)`
- If no overrides: `pubhub` (unchanged, no `*`)

**Detail view** (`spectify results <jobId>` or verbose output):
Full override map displayed below the summary:

```
Rule Overrides:
  oas3-always-use-https  → excluded
  operation-description  → warn
  info-contact           → hint
```

### Cache behavior

Jobs with different `ruleOverrides` produce different results. The cache key must include overrides.

**Cache key computation:**

```
cacheKey = hash(documentId + rulesetName + rulesetVersion + stableStringify(ruleOverrides))
```

Where `stableStringify` sorts keys deterministically so `{a: "off", b: "warn"}` and `{b: "warn", a: "off"}` produce the same key.

If `ruleOverrides` is `undefined` or `{}`, the cache key matches the existing behavior (backward compatible).

---

## Implementation Plan

### Phase 1: Types and API contract

**Files:** `src/types.ts`, `src/validation.ts`, `src/schemas.ts`

1. Add `ruleOverrides?: Record<string, 'off' | 'error' | 'warn' | 'info' | 'hint'>` to `LintJobRequest`
2. Add `ruleOverrides` to `LintJob` (stored for display/audit)  
3. Add `ruleOverrides` to `LintJobResult` (pass through for response enrichment)
4. Add `ruleOverrides` to `LintJobStatus` response
5. Update `lintJobRequestSchema` in `validation.ts` with the JSON Schema
6. Add `RuleOverridesSchema` to `schemas.ts` and reference it from `LintJobResultSchema`, `LintJobStatusSchema`
7. Add `ruleOverrides` to `RuleTask` type
8. Add `ruleOverrides` to `WorkerExecuteMessage.payload`

### Phase 2: Orchestrator plumbing

**Files:** `src/orchestrator.ts`, `src/worker-pool.ts`

1. In `submitJob()`: copy `ruleOverrides` from request → `LintJob` → `RuleTask`
2. In `submitJob()`: include `ruleOverrides` in cache key computation
3. In `executeTaskWithRetry()` / `executeOnWorker()`: pass `ruleOverrides` into the worker message payload
4. In result aggregation: persist `ruleOverrides` on `LintJobResult`

### Phase 3: Worker post-filter

**File:** `src/worker.ts`

1. Accept `ruleOverrides` in the `ExecuteMessage.payload`
2. After `spectral.run(document)` and `results.map(formatDiagnostic)`:
   - **Exclude:** Remove any diagnostic where `diagnostic.code` is in overrides with value `"off"`
   - **Remap severity:** For any diagnostic whose `diagnostic.code` has a severity override, replace `diagnostic.severity` with the mapped value

```typescript
function applyRuleOverrides(
  diagnostics: FormattedDiagnostic[],
  overrides: Record<string, string>
): FormattedDiagnostic[] {
  const severityMap: Record<string, number> = {
    error: 0, warn: 1, info: 2, hint: 3
  };

  return diagnostics
    .filter(d => overrides[d.code] !== 'off')
    .map(d => {
      const override = overrides[d.code];
      if (override && override !== 'off' && severityMap[override] !== undefined) {
        return { ...d, severity: severityMap[override] };
      }
      return d;
    });
}
```

### Phase 4: CLI integration

**Files:** `src/cli/commands/lint.ts`, `src/cli/api-client.ts`, `src/cli/formatters.ts`

1. Add `--override <rules>` option to the `lint` command (Commander)
2. Parse `rules` string into `Record<string, string>` (split on `,` then `=`)
3. Validate each value is one of `off|error|warn|info|hint`
4. Add `ruleOverrides` to `LintRequest` in `api-client.ts`
5. Pass `ruleOverrides` in the `submitLint()` POST body
6. Update `formatSummary()` to display override info when present
7. Add override details to verbose/detail output

### Phase 5: OpenAPI spec and schemas

**Files:** `src/schemas.ts`, `exports/openapi.json`

1. Add `RuleOverridesSchema` as a reusable `$ref` schema
2. Add `ruleOverrides` property to `LintJobSubmitRequestSchema` (body schema for `POST /lint`)
3. Add `ruleOverrides` to `LintJobResultSchema` and `LintJobStatusSchema`
4. Regenerate `exports/openapi.json` via `npm run generate-openapi`

### Phase 6: Tests

**Files:** `tests/unit/`, `tests/integration/`

See [Test Plan](#test-plan) below.

---

## Files Changed

| File | Change |
|------|--------|
| `src/types.ts` | Add `ruleOverrides` to `LintJobRequest`, `LintJob`, `LintJobResult`, `LintJobStatus`, `RuleTask`, `WorkerExecuteMessage` |
| `src/validation.ts` | Add `ruleOverrides` to `lintJobRequestSchema` |
| `src/schemas.ts` | Add `RuleOverridesSchema`, update `LintJobResultSchema`, `LintJobStatusSchema` |
| `src/orchestrator.ts` | Pass `ruleOverrides` through job lifecycle; include in cache key |
| `src/worker-pool.ts` | Add `ruleOverrides` to `ExecuteTaskRequest`; include in worker message |
| `src/worker.ts` | Add `applyRuleOverrides()` post-filter function; apply after `spectral.run()` |
| `src/server.ts` | Pass `ruleOverrides` from request body to orchestrator (sanitized) |
| `src/cli/commands/lint.ts` | Add `--override` option, parse, validate |
| `src/cli/api-client.ts` | Add `ruleOverrides` to `LintRequest`; include in POST body |
| `src/cli/formatters.ts` | Display override summary and details |
| `exports/openapi.json` | Regenerate with new schema fields |

---

## Examples

### CLI usage examples

**Exclude two rules:**
```bash
spectify lint petstore.yaml --ruleset pubhub --override oas3-always-use-https=off,operation-tags=off
```

**Change severity of a rule from error to warning:**
```bash
spectify lint petstore.yaml --ruleset oas --override info-contact=warn
```

**Combine exclusion and severity override:**
```bash
spectify lint petstore.yaml --ruleset pubhub \
  --override oas3-always-use-https=off,operation-description=warn,info-contact=hint
```

**Use with multiple rulesets (overrides apply to all):**
```bash
spectify lint petstore.yaml --ruleset pubhub,oas \
  --override oas3-always-use-https=off
```

### API request examples

**Exclude rules:**
```json
POST /lint
{
  "documentId": "41c1d4aa-5825-4313-8ae5-737490707b5b",
  "rulesetName": "pubhub",
  "ruleOverrides": {
    "oas3-always-use-https": "off",
    "operation-tags": "off"
  }
}
```

**Override severity:**
```json
POST /lint
{
  "documentId": "41c1d4aa-5825-4313-8ae5-737490707b5b",
  "rulesetName": "oas",
  "ruleOverrides": {
    "operation-description": "warn",
    "info-contact": "hint"
  }
}
```

**No overrides (backward compatible):**
```json
POST /lint
{
  "documentId": "41c1d4aa-5825-4313-8ae5-737490707b5b",
  "rulesetName": "pubhub"
}
```

### API response examples

**Job status with overrides:**
```json
GET /lint/94c9db52-92fc-4733-806a-fe6d206109aa
{
  "jobId": "94c9db52-92fc-4733-806a-fe6d206109aa",
  "documentId": "41c1d4aa-5825-4313-8ae5-737490707b5b",
  "rulesetName": "pubhub",
  "rulesetVersion": "1.1.0",
  "ruleOverrides": {
    "oas3-always-use-https": "off",
    "operation-description": "warn"
  },
  "status": "completed",
  "progress": { "totalTasks": 1, "completedTasks": 1, "failedTasks": 0, "timeoutTasks": 0, "runningTasks": 0, "queuedTasks": 0 },
  "startTime": "2026-04-09T12:00:00.000Z",
  "endTime": "2026-04-09T12:00:01.234Z"
}
```

**Job result with overrides — issues reflect applied overrides:**
```json
GET /lint/94c9db52-92fc-4733-806a-fe6d206109aa/results
{
  "jobId": "94c9db52-92fc-4733-806a-fe6d206109aa",
  "documentId": "41c1d4aa-5825-4313-8ae5-737490707b5b",
  "rulesetName": "pubhub",
  "rulesetVersion": "1.1.0",
  "ruleOverrides": {
    "oas3-always-use-https": "off",
    "operation-description": "warn"
  },
  "status": "completed",
  "summary": {
    "totalIssues": 12,
    "errorCount": 3,
    "warningCount": 7,
    "infoCount": 2,
    "hintCount": 0
  },
  "results": [
    {
      "ruleId": "operation-description",
      "code": "operation-description",
      "message": "Operation \"description\" must be present and non-empty string.",
      "severity": 1,
      "path": ["paths", "/pets", "get"],
      "range": { "start": { "line": 14, "character": 8 }, "end": { "line": 14, "character": 30 } }
    }
  ]
}
```

Note: `oas3-always-use-https` issues are absent from `results` (excluded). `operation-description` issues have `severity: 1` (warn) instead of the ruleset's default (which may have been `0`/error).

### CLI output example

**Summary view (default):**
```
╔══════════════════════════════════════════════════╗
║  Lint Results                                     ║
╠══════════════════════════════════════════════════╣
║  Document: petstore.yaml                          ║
║  Ruleset:  pubhub (1 rule excluded, 1 severity override) ║
║  Job ID:   94c9db52...                            ║
║                                                   ║
║  ❌ Errors:   3                                   ║
║  ⚠️  Warnings: 7                                  ║
║  ℹ️  Info:     2                                   ║
║  💡 Hints:    0                                   ║
║  ────────────────────                             ║
║  Total:       12 issues                           ║
╚══════════════════════════════════════════════════╝

Rule Overrides:
  oas3-always-use-https  → excluded
  operation-description  → warn
```

**In job listing (`spectify jobs`):**
```
Job ID        Status     Ruleset   Document
94c9db52...   completed  pubhub*   petstore.yaml
a1b2c3d4...   completed  pubhub    other-api.yaml
```

The `*` suffix in the short form quickly indicates which jobs used customized rulesets.

---

## Test Plan

### Unit tests

**File:** `tests/unit/rule-overrides.test.ts`

| # | Test | Description |
|---|------|-------------|
| 1 | `applyRuleOverrides` — no overrides | Empty or undefined overrides returns diagnostics unchanged |
| 2 | `applyRuleOverrides` — exclude single rule | Diagnostics for excluded rule are removed |
| 3 | `applyRuleOverrides` — exclude multiple rules | Multiple rules removed simultaneously |
| 4 | `applyRuleOverrides` — remap severity | Diagnostic severity changed to override value |
| 5 | `applyRuleOverrides` — mix exclude and remap | Some rules excluded, others remapped, unmentioned rules untouched |
| 6 | `applyRuleOverrides` — unknown rule in overrides | Override for a rule ID not present in diagnostics is silently ignored |
| 7 | `applyRuleOverrides` — summary recalculation | After filtering, summary counts (error/warn/info/hint) reflect the actual filtered results |
| 8 | Cache key includes overrides | Same doc+ruleset with different overrides produces different cache keys |
| 9 | Cache key stable ordering | `{a: 'off', b: 'warn'}` and `{b: 'warn', a: 'off'}` produce identical cache keys |
| 10 | Validation — valid overrides accepted | All valid severity values pass schema validation |
| 11 | Validation — invalid severity rejected | Values like `"critical"` or `"OFF"` rejected |
| 12 | Validation — max 200 entries enforced | Overrides with >200 entries rejected |

**File:** `tests/unit/cli-override-parser.test.ts`

| # | Test | Description |
|---|------|-------------|
| 1 | Parse simple exclusion | `"rule1=off"` → `{ rule1: 'off' }` |
| 2 | Parse multiple overrides | `"rule1=off,rule2=warn"` → correct object |
| 3 | Parse all severity values | `off`, `error`, `warn`, `info`, `hint` all accepted |
| 4 | Reject invalid severity | `"rule1=critical"` → error |
| 5 | Reject malformed input | `"rule1"` (no `=`) → error |
| 6 | Handle whitespace | `" rule1 = off , rule2 = warn "` → trimmed and parsed correctly |

### Integration tests

**File:** `tests/integration/rule-overrides.test.ts`

| # | Test | Description |
|---|------|-------------|
| 1 | POST /lint with ruleOverrides — excluded rules absent from results | Submit job with overrides, verify excluded rule's issues not in results |
| 2 | POST /lint with ruleOverrides — severity remapped in results | Verify affected rule issues have new severity value |
| 3 | POST /lint without ruleOverrides — backward compatible | Existing behavior unchanged when field omitted |
| 4 | GET /lint/:jobId includes ruleOverrides | Status endpoint reflects overrides from request |
| 5 | GET /lint/:jobId/results includes ruleOverrides | Results endpoint includes override metadata |
| 6 | Cache isolation | Two jobs with same doc/ruleset but different overrides return different results |
| 7 | Invalid ruleOverrides rejected | Bad severity value returns 400 |

### E2E test

**File:** `tests/e2e/rule-overrides-e2e.test.ts`

| # | Test | Description |
|---|------|-------------|
| 1 | CLI `--override` excludes rules | `spectify lint <file> --override <rule>=off` produces output without excluded rule |
| 2 | CLI `--override` changes severity | Output shows changed severity for overridden rule |
| 3 | CLI display shows override summary | Summary line includes "(N rules excluded, M severity overrides)" |

---

## Future Enhancements

1. **Override profiles** — Named override configurations stored server-side (e.g., `spectify lint api.yaml --ruleset pubhub --profile relaxed`) that map to predefined `ruleOverrides`. Avoids repeating long override strings.

2. **Performance optimization** — If profiling reveals specific excluded rules are expensive (e.g., rules with complex custom functions), upgrade to Option 2 or Option 4 for those rules while keeping Option 1 as the default path. The API contract stays the same.

3. **Rule validation** — Optionally warn when an override references a rule ID that doesn't exist in the ruleset (requires loading ruleset metadata server-side before dispatching to worker). Not in scope for initial release — unknown rules are silently ignored.

4. **`--override-file`** — Load overrides from a YAML/JSON file for complex configurations:
   ```bash
   spectify lint api.yaml --ruleset pubhub --override-file .spectify-overrides.yaml
   ```

5. **SARIF integration** — Include override metadata in generated SARIF reports (e.g., as `run.properties`).
