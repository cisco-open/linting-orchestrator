# Spectral Native Reproduction

**Date:** 2026-04-09  
**Status:** Design  
**Server Version:** 0.14.0 (planned)  
**CLI Version:** 0.11.0 (planned)

## Table of Contents

- [Summary](#summary)
- [Motivation](#motivation)
- [Feature scope](#feature-scope)
  - [In scope](#in-scope)
  - [Out of scope](#out-of-scope)
- [User stories](#user-stories)
- [Design](#design)
  - [Information available per job](#information-available-per-job)
  - [Ruleset source mapping](#ruleset-source-mapping)
  - [Markdown structure](#markdown-structure)
  - [Handling rule overrides](#handling-rule-overrides)
    - [Option A: Manual instructions](#option-a-manual-instructions)
    - [Option B: Generated wrapper ruleset example](#option-b-generated-wrapper-ruleset-example)
    - [Spectral overrides caveat with extends](#spectral-overrides-caveat-with-extends)
    - [Selected approach](#selected-approach)
  - [API contract](#api-contract)
  - [CLI interface](#cli-interface)
- [Implementation plan](#implementation-plan)
  - [Phase 1: Ruleset source metadata](#phase-1-ruleset-source-metadata)
  - [Phase 2: Reproduction generator](#phase-2-reproduction-generator)
  - [Phase 3: API endpoint](#phase-3-api-endpoint)
  - [Phase 4: CLI command](#phase-4-cli-command)
  - [Phase 5: Tests](#phase-5-tests)
- [Files changed](#files-changed)
- [Examples](#examples)
  - [Basic reproduction (no overrides)](#basic-reproduction-no-overrides)
  - [Reproduction with rule overrides](#reproduction-with-rule-overrides)
  - [CLI usage](#cli-usage)
  - [API usage](#api-usage)
- [Test plan](#test-plan)
- [Future enhancements](#future-enhancements)

---

## Summary

Generate reproduction instructions that allow an engineer who has only the **Spectral CLI** (not Spectify) to reproduce the exact linting analysis that Spectify performed for a given job. The output is a **Markdown document** containing step-by-step shell commands to install the Spectral CLI, clone the ruleset source repository, install its dependencies, and run `spectral lint` with the correct ruleset file.

When rule overrides were applied (rules excluded or severity changed), the instructions include manual guidance on how to configure Spectral's native [overrides feature](https://docs.stoplight.io/docs/spectral/293426e270fac-overrides), plus a generated example wrapper ruleset file.

---

## Motivation

Spectify centralizes linting orchestration, but the engineers who need to **act on** lint results often work in different environments:

1. **Handoff scenario** — A tech lead runs linting through Spectify and finds issues. They need to share the exact analysis with an API developer who doesn't have Spectify installed but does have Spectral.

2. **CI/CD portability** — A team wants to reproduce the same lint check in their CI pipeline using only the Spectral CLI (no Spectify dependency in CI).

3. **Debugging** — An engineer questions a specific lint result and wants to run the same ruleset locally, tweak rules, and iterate.

4. **Trust & transparency** — Providing the exact Spectral command demonstrates that Spectify is just orchestrating standard Spectral — no black box.

In all cases, the user needs:
- The source repository of the ruleset (to clone and install)
- The exact Spectral command line
- Override/exclusion configuration (if any rules were modified)

They **already have** the OpenAPI document on their machine.

---

## Feature scope

### In scope

- **Markdown reproduction instructions** for any completed job — generated on demand from stored job data and ruleset metadata
- **Spectral CLI command** with the correct `--ruleset` flag pointing to the cloned ruleset's entrypoint
- **Git clone + npm install instructions** for the ruleset source repository
- **Rule override handling** — manual instructions explaining how to configure Spectral's native overrides, plus a generated wrapper ruleset file provided as an example
- **API endpoint** — `GET /lint/:jobId/reproduce`
- **CLI command** — `spectify reproduce <jobId>`

### Out of scope

- **Raw Spectral output** — We do not return the Spectral CLI JSON results. The user runs Spectral themselves to obtain results. Spectify's internal result format (LintIssue) is very close to but not byte-identical with `spectral lint --format json` output, so returning stored results as "Spectral output" would be misleading.
- **Document retrieval** — Instructions reference a placeholder `<your-document.yaml>`. The user already has their OpenAPI document.
- **Automated script generation** — We provide commands to copy/paste, not a runnable script. Keep it simple and auditable.
- **Ruleset bundling/download** — We don't package or serve ruleset source files. The user clones from the original repository.

---

## User stories

**US-1:** As a tech lead, I want to get reproduction instructions for a completed lint job so I can share them with an engineer who uses Spectral natively.

**US-2:** As an API developer, I want to follow step-by-step instructions to reproduce a Spectify lint analysis using only the Spectral CLI, so I can iterate on fixes locally.

**US-3:** As a tech lead, when a job used rule overrides (some rules disabled or severity changed), I want the reproduction instructions to include how to configure those same overrides in Spectral, so the engineer gets matching results.

---

## Design

### Information available per job

From the stored `LintJobResult` and the loaded `RulesetVersion` metadata, we have everything needed:

| Data | Source | Example |
|------|--------|---------|
| Ruleset name | `LintJobResult.rulesetName` | `pubhub` |
| Ruleset version | `LintJobResult.rulesetVersion` | `1.1.0` |
| Source repository URL | `rulesets.yaml` → `metadata.repository` | `https://wwwin-github.cisco.com/DevNet/PubHub-Analyzer` |
| Source version / tag | `rulesets.yaml` → `versions[].sourceVersion` | `1.1.0` |
| Entrypoint file | `rulesets.yaml` → `versions[].entrypoint` | `pubhub.yaml` |
| Source repo relative path | `rulesets.yaml` → `versions[].sourceRepo` | `wwwin-github.cisco.com/DevNet/PubHub-Analyzer` |
| Rule overrides | `LintJobResult.ruleOverrides` | `{ "oas3-api-servers": "off" }` |
| Document ID | `LintJobResult.documentId` | `41c1d4aa-...` |

### Ruleset source mapping

Each ruleset version in `rulesets.yaml` already stores:

```yaml
versions:
  - version: "1.1.0"
    sourceRepo: "wwwin-github.cisco.com/DevNet/PubHub-Analyzer"
    sourceVersion: "1.1.0"
    entrypoint: "pubhub.yaml"
```

Combined with the top-level `metadata.repository` URL, we can reconstruct clone instructions. The repository name is the last segment of the `sourceRepo` path (e.g., `PubHub-Analyzer`).

**Mapping logic:**

```
repository URL  → git clone target
sourceVersion   → git checkout tag/branch (or "main" if date-based)
entrypoint      → --ruleset flag value
```

For date-based source versions (e.g., `2025-11-19` for `api-insights-openapi-rulesets`), the clone instructions will check out `main` since these repos don't have version tags — the date represents a snapshot.

### Markdown structure

The generated Markdown follows this structure:

```
# Spectral Reproduction: {rulesetDisplayName}

## Job Information
- Job ID, ruleset, version, document ID, timestamp

## Prerequisites
- Node.js, npm, Spectral CLI install command

## Step 1: Clone the Ruleset
- git clone + cd + optional git checkout

## Step 2: Install Dependencies
- npm install (if package.json exists)

## Step 3: Run Spectral
- spectral lint <your-document.yaml> --ruleset {entrypoint}

## Rule Overrides (conditional — only if overrides were applied)
- Explanation of what overrides were used
- Manual instructions to add overrides to the ruleset
- Example wrapper ruleset file
```

### Handling rule overrides

When a job was executed with `ruleOverrides`, the reproduction instructions must explain how to achieve the same effect using Spectral's native [overrides feature](https://docs.stoplight.io/docs/spectral/293426e270fac-overrides).

#### Option A: Manual instructions

Tell the user which rules were overridden and how to add an `overrides` section to the ruleset file:

```markdown
### Manual Override Configuration

The original analysis applied these rule overrides:
- `oas3-api-servers`: **off** (excluded)
- `operation-description`: **warn** (changed from error)

To reproduce, add an `overrides` section to the ruleset file (`pubhub.yaml`):

```yaml
overrides:
  - files:
      - "**"
    rules:
      oas3-api-servers: "off"
      operation-description: "warn"
```
```

#### Option B: Generated wrapper ruleset example

Provide a ready-to-use wrapper ruleset file that extends the original and adds overrides:

```markdown
### Example: Wrapper Ruleset

Save the following as `spectify-overrides.yaml` in the same directory as the ruleset:

```yaml
extends:
  - ./pubhub.yaml
overrides:
  - files:
      - "**"
    rules:
      oas3-api-servers: "off"
      operation-description: "warn"
```

Then run:
```bash
spectral lint <your-document.yaml> --ruleset spectify-overrides.yaml
```
```

#### Spectral overrides caveat with `extends`

Spectral documents a known caveat: **overrides defined in a wrapper ruleset are not applied to rules inherited via `extends`** when using YAML `extends`. However, this caveat applies specifically to overrides in *extended* files, not in the *root* ruleset being executed.

When the wrapper file is the **root ruleset** passed to `--ruleset`, its overrides section should apply to all rules, including those inherited from `extends`. The caveat applies when `rulesetA` extends `rulesetB`, and `rulesetB` has overrides — those overrides in `rulesetB` are ignored.

In our case, the wrapper IS the root ruleset, so its overrides apply. The caveat is documented for transparency in case edge cases arise with deeply nested extends chains.

If a user encounters issues with the YAML wrapper approach, we document an alternative JS wrapper:

```js
// spectify-overrides.mjs
import ruleset from './pubhub.yaml' assert { type: 'json' };
export default {
  ...ruleset,
  overrides: [
    {
      files: ['**'],
      rules: {
        'oas3-api-servers': 'off',
        'operation-description': 'warn'
      }
    }
  ]
};
```

#### Selected approach

**Both A and B.** The Markdown includes:
1. A table listing each override (manual reference — Option A)
2. A generated wrapper `.yaml` file as a ready-to-use example (Option B)
3. A note about the JS wrapper fallback if extends doesn't work as expected

This lets the user choose: paste the overrides into the original file, or use the wrapper as-is.

### API contract

#### `GET /lint/:jobId/reproduce`

Returns the reproduction Markdown as a response.

**Response `200 OK`:**

```
Content-Type: text/markdown; charset=utf-8
```

```markdown
# Spectral Reproduction: PubHub Readiness
...
```

**Response `404 Not Found`:**

```json
{
  "error": "Job not found",
  "jobId": "abc-123"
}
```

**Response `400 Bad Request`:**

Job exists but is not in a completed/failed/timeout state (still running):

```json
{
  "error": "Job not yet completed",
  "jobId": "abc-123",
  "status": "running"
}
```

**Query parameters:** None for v1.

### CLI interface

```bash
# Output to terminal (stdout)
spectify reproduce <jobId>

# Save to file
spectify reproduce <jobId> --output reproduce.md
spectify reproduce <jobId> -o reproduce.md
```

The CLI fetches the Markdown from `GET /lint/:jobId/reproduce` and either prints it or writes it to a file.

---

## Implementation plan

### Phase 1: Ruleset source metadata

**Goal:** Ensure the reproduction generator has access to all required metadata.

The `RulesetLoader` already loads `rulesets.yaml` and resolves versions. We need to expose a method that returns the source metadata for a given ruleset + version:

```typescript
// New method on RulesetLoader
getSourceMetadata(rulesetName: string, version: string): RulesetSourceMetadata | null

interface RulesetSourceMetadata {
  rulesetName: string;
  displayName: string;
  version: string;
  repositoryUrl: string;       // From metadata.repository
  sourceRepo: string;          // From versions[].sourceRepo
  sourceVersion: string;       // From versions[].sourceVersion  
  entrypoint: string;          // From versions[].entrypoint
  hasPackageJson: boolean;     // Whether npm install is needed
  license: string;             // From metadata.license
}
```

**Files:** `src/ruleset-loader.ts`, `src/types.ts`

### Phase 2: Reproduction generator

**Goal:** Build the Markdown generation logic.

New module `src/formatters/reproduce-markdown.ts`:

```typescript
export function generateReproductionMarkdown(
  jobResult: LintJobResult,
  sourceMetadata: RulesetSourceMetadata
): string
```

Pure function — takes job result + source metadata, returns a Markdown string. No side effects, no I/O. Easy to test.

Key sections generated:
1. Job information header
2. Prerequisites (Node.js, Spectral CLI)
3. Clone + install instructions (constructed from `sourceMetadata`)
4. `spectral lint` command
5. Rule overrides section (conditional, only when `jobResult.ruleOverrides` is non-empty)
   - Override summary table
   - Wrapper `.spectral.yaml` example
   - JS wrapper fallback note

**Files:** `src/formatters/reproduce-markdown.ts`

### Phase 3: API endpoint

**Goal:** Wire up the `GET /lint/:jobId/reproduce` endpoint.

Route handler:
1. Look up job result from storage
2. Validate job is completed/failed/timeout (not queued/running)
3. Call `rulesetLoader.getSourceMetadata(result.rulesetName, result.rulesetVersion)`
4. Call `generateReproductionMarkdown(result, metadata)`
5. Return with `Content-Type: text/markdown`

Register JSON Schema for the endpoint in `src/schemas.ts` for OpenAPI spec generation.

**Files:** `src/server.ts`, `src/schemas.ts`

### Phase 4: CLI command

**Goal:** Add `spectify reproduce <jobId>` CLI command.

New command that:
1. Calls `GET /lint/:jobId/reproduce` on the connected server
2. Prints the Markdown to stdout (or saves to file with `--output`)
3. Handles errors (job not found, job still running)

**Files:** `src/cli/commands/reproduce.ts`, `src/cli/index.ts` (register command)

### Phase 5: Tests

**Goal:** Unit tests for the generator, integration tests for the endpoint.

- Unit tests for `generateReproductionMarkdown()` — various combinations:
  - Basic (no overrides)
  - With overrides (off + severity changes)
  - Date-based source versions
  - JS-based entrypoints
- Integration test for `GET /lint/:jobId/reproduce`
- CLI test for `spectify reproduce`

**Files:** `tests/unit/reproduce-markdown.test.ts`, `tests/integration/reproduce-endpoint.test.ts`

---

## Files changed

| File | Change |
|------|--------|
| `src/types.ts` | Add `RulesetSourceMetadata` interface |
| `src/ruleset-loader.ts` | Add `getSourceMetadata()` method |
| `src/formatters/reproduce-markdown.ts` | New — Markdown generation logic |
| `src/server.ts` | Add `GET /lint/:jobId/reproduce` route |
| `src/schemas.ts` | Add schema for reproduce endpoint |
| `src/cli/commands/reproduce.ts` | New — CLI `reproduce` command |
| `src/cli/index.ts` | Register `reproduce` command |
| `tests/unit/reproduce-markdown.test.ts` | New — generator unit tests |
| `tests/integration/reproduce-endpoint.test.ts` | New — endpoint integration tests |

---

## Examples

### Basic reproduction (no overrides)

For a job that linted with the `pubhub` ruleset v1.1.0:

````markdown
# Spectral Reproduction: PubHub Readiness

## Job Information

| Field | Value |
|-------|-------|
| Job ID | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| Ruleset | pubhub (PubHub Readiness) |
| Version | 1.1.0 |
| Document ID | `41c1d4aa-5825-4313-8ae5-737490707b5b` |
| Timestamp | 2026-04-09T14:30:00Z |

## Prerequisites

```bash
# Install Spectral CLI (if not already installed)
npm install -g @stoplight/spectral-cli

# Verify installation
spectral --version
```

## Step 1: Clone the Ruleset

```bash
git clone https://wwwin-github.cisco.com/DevNet/PubHub-Analyzer
cd PubHub-Analyzer
git checkout v1.1.0
```

## Step 2: Install Dependencies

```bash
npm install
```

## Step 3: Run Spectral

```bash
spectral lint <your-document.yaml> --ruleset pubhub.yaml
```

Replace `<your-document.yaml>` with the path to your OpenAPI document.

---

*Generated by Spectify — [spectify.io](https://spectify.io)*
````

### Reproduction with rule overrides

For a job that used `ruleOverrides: { "oas3-api-servers": "off", "operation-description": "warn" }`:

````markdown
# Spectral Reproduction: PubHub Readiness

## Job Information

| Field | Value |
|-------|-------|
| Job ID | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| Ruleset | pubhub (PubHub Readiness) |
| Version | 1.1.0 |
| Document ID | `41c1d4aa-5825-4313-8ae5-737490707b5b` |
| Timestamp | 2026-04-09T14:30:00Z |
| Rule Overrides | 2 rules modified (see below) |

## Prerequisites

```bash
# Install Spectral CLI (if not already installed)
npm install -g @stoplight/spectral-cli

# Verify installation
spectral --version
```

## Step 1: Clone the Ruleset

```bash
git clone https://wwwin-github.cisco.com/DevNet/PubHub-Analyzer
cd PubHub-Analyzer
git checkout v1.1.0
```

## Step 2: Install Dependencies

```bash
npm install
```

## Step 3: Configure Rule Overrides

The original Spectify analysis applied the following rule overrides:

| Rule | Override | Effect |
|------|----------|--------|
| `oas3-api-servers` | `off` | Rule excluded from results |
| `operation-description` | `warn` | Severity changed to warning |

To reproduce the same behavior with Spectral, create a **wrapper ruleset** that extends the original and adds an [overrides section](https://docs.stoplight.io/docs/spectral/293426e270fac-overrides).

Save the following as `spectify-overrides.yaml` in the same directory as the cloned ruleset:

```yaml
extends:
  - ./pubhub.yaml
overrides:
  - files:
      - "**"
    rules:
      oas3-api-servers: "off"
      operation-description: "warn"
```

> **Note:** This is provided as an example. You can also add the `overrides` section directly to `pubhub.yaml` instead of creating a wrapper file.

> **Troubleshooting:** If overrides don't take effect (rare edge case with deeply nested `extends` chains), use a JavaScript wrapper instead:
> ```js
> // spectify-overrides.mjs
> export default {
>   extends: ['./pubhub.yaml'],
>   overrides: [
>     {
>       files: ['**'],
>       rules: {
>         'oas3-api-servers': 'off',
>         'operation-description': 'warn'
>       }
>     }
>   ]
> };
> ```

## Step 4: Run Spectral

```bash
spectral lint <your-document.yaml> --ruleset spectify-overrides.yaml
```

Replace `<your-document.yaml>` with the path to your OpenAPI document.

---

*Generated by Spectify — [spectify.io](https://spectify.io)*
````

### CLI usage

```bash
# Print reproduction instructions to terminal
spectify reproduce a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Save to file for sharing
spectify reproduce a1b2c3d4-e5f6-7890-abcd-ef1234567890 --output reproduce.md

# Pipe to clipboard (macOS)
spectify reproduce a1b2c3d4-e5f6-7890-abcd-ef1234567890 | pbcopy
```

### API usage

```bash
# Get reproduction instructions
curl -s http://localhost:3003/lint/a1b2c3d4-e5f6-7890-abcd-ef1234567890/reproduce

# Save to file
curl -s http://localhost:3003/lint/a1b2c3d4-e5f6-7890-abcd-ef1234567890/reproduce \
  -o reproduce.md
```

---

## Test plan

### Unit tests — `generateReproductionMarkdown()`

| Test | Input | Assertion |
|------|-------|-----------|
| Basic reproduction | Job with `pubhub` v1.1.0, no overrides | Markdown contains clone URL, npm install, spectral lint command |
| With overrides | Job with 2 rule overrides | Markdown contains overrides table, wrapper YAML example |
| All rules to off | All overrides are `off` | Overrides section says "all listed rules excluded" |
| Date-based version | `sourceVersion: "2025-11-19"` | Clone instructions use `main` branch, not version tag |
| JS entrypoint | `entrypoint: "contract.js"` | `--ruleset contract.js` in command |
| No package.json | `hasPackageJson: false` | Step 2 (Install Dependencies) is omitted |
| Overrides with mixed severities | mix of `off`, `error`, `warn`, `info`, `hint` | Table shows all, wrapper YAML correct |

### Integration tests — `GET /lint/:jobId/reproduce`

| Test | Scenario | Expected |
|------|----------|----------|
| Happy path | Completed job, valid ruleset | 200, `Content-Type: text/markdown` |
| Job not found | Invalid jobId | 404 |
| Job still running | Job in `running` state | 400 with status field |
| Job with overrides | Completed job with overrides | 200, markdown includes overrides section |

---

## Future enhancements

- **`--format` flag** — Support different output formats (e.g., `--format shell` for a raw shell script, `--format json` for structured reproduction data)
- **Raw Spectral output** — If we decide to store the raw `ISpectralDiagnostic[]` separately from our `LintIssue[]`, we could offer a `GET /lint/:jobId/spectral-output` endpoint
- **Document retrieval instructions** — Optional flag to include `curl` command to download the document from Spectify's API
- **Ruleset archive** — Serve a tarball of the ruleset source from Spectify, eliminating the need to clone
- **CI/CD snippets** — Generate GitHub Actions / GitLab CI YAML snippets using the Spectral command
- **Reproduce validation** — `spectify reproduce --verify <jobId>` that actually runs the Spectral command locally and compares results
