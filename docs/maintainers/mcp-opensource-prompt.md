# Agent Prompt: Open-source `mcp-openapi-analysis` as `linting-mcp-analyzer`

This is a self-contained briefing for an AI coding agent working inside the
`mcp-openapi-analysis` repository. Read it completely before touching any file.

---

## Context and goals

The `mcp-openapi-analysis` repository is being renamed and moved to
`github.com/cisco-open/linting-mcp-analyzer` as part of a coordinated
open-source release of the Spectify tool family.

The broader renaming strategy is documented in:

```
../spectify/docs/maintainers/opensourcing.md
```

Read sections §1 (naming model), §2 (decisions table), and §3 (impacted surface)
of that document before proceeding. Key rules to internalize:

- **`spectify*` identifiers are kept only** in shell commands, binary names,
  env-var prefixes (`SPECTIFYD_*`, `SPECTIFYR_*`), on-disk paths (`~/.spectify/`),
  file/UI chrome, and SARIF `tool.name`. They are removed from package names,
  prose, configuration keys, class names, and file names.
- **Descriptive prose** uses "the OpenAPI linting orchestrator", "the linting
  orchestrator daemon (`spectifyd`)", "the linting MCP analyzer".
- **No backward-compatibility aliases** — this is a pre-1.0 release; clean break.

---

## Target state (what the repo must look like when done)

| Item | Before | After |
|---|---|---|
| Repository (GitHub) | `wwwin-github.cisco.com/DevNet/mcp-openapi-analysis` | `github.com/cisco-open/linting-mcp-analyzer` |
| `package.json` `name` | `openapi-analysis-mcp` | `@cisco_open/linting-mcp-analyzer` |
| `package.json` `license` | `"MIT"` | `"Apache-2.0"` |
| `package.json` `bin` key | `openapi-analysis-mcp` | `linting-mcp-analyzer` |
| `package.json` local dep | `file:../spectify/packages/document-store` | `file:../linting-orchestrator/packages/document-store` |
| Source file | `src/spectify-client.ts` | `src/orchestrator-client.ts` |
| Config YAML key | `spectify:` | `orchestrator:` |
| Config file | `config-spectify-disabled.yaml` | `config-orchestrator-disabled.yaml` |
| Env vars in TypeScript | `SPECTIFY_ENABLED`, `SPECTIFY_BASE_URL`, `SPECTIFY_TIMEOUT` | `ORCHESTRATOR_ENABLED`, `ORCHESTRATOR_BASE_URL`, `ORCHESTRATOR_TIMEOUT` |
| TS class | `SpectifyClient` | `OrchestratorClient` |
| TS class | `SpectifyError` | `OrchestratorError` |
| TS class | `SpectifyCapacityError` | `OrchestratorCapacityError` |
| TS interface | `SpectifyClientConfig` | `OrchestratorClientConfig` |
| TS interface | `AppConfig.spectify` field | `AppConfig.orchestrator` |
| Reference copy dir | `ref/spectify/` | `ref/linting-orchestrator/` |
| Maintainer doc | `docs/maintainers/SPECTIFY_MCP_INTEGRATION.md` | `docs/maintainers/ORCHESTRATOR_MCP_INTEGRATION.md` |
| Maintainer doc | `docs/maintainers/SPECTIFY_MCP_INTEGRATION_ARCHITECTURE.md` | `docs/maintainers/ORCHESTRATOR_MCP_INTEGRATION_ARCHITECTURE.md` |
| Maintainer doc | `docs/maintainers/SPECTIFY_INTEGRATION_TESTING.md` | `docs/maintainers/ORCHESTRATOR_INTEGRATION_TESTING.md` |

**What must NOT change:**
- Binary name `spectifyd` (it is the orchestrator's binary, not this repo's)
- Log strings that say "`spectifyd`" (these are binary names, correct per the naming model)
- `SPECTIFYD_*` env vars (they belong to the orchestrator daemon)
- `~/.spectify/` paths
- The shell script's `SPECTIFY_ENABLED` / `SPECTIFY_PATH` backward-compat aliases
  in `scripts/start-with-orchestrator.sh` (already mapped to `ORCHESTRATOR_ENABLED`/
  `ORCHESTRATOR_PATH`; keep both so existing users aren't broken at runtime)
- The `ref/` snapshot files themselves — only rename the directory

---

## Already done (do NOT redo)

These changes are already in the repo:

- `NOTICE` — already says `linting-mcp-analyzer`, Apache-2.0, Copyright 2026
- `LICENSE` — already Apache-2.0
- `AGENTS.md` — already uses `linting-mcp-analyzer` name and `github.com/cisco-open` URLs
- `tests/test-orchestrator-integration.bats` — already renamed from `test-spectify-integration.bats`
- `package.json` scripts: `test:orchestrator` — already renamed from `test:spectify`
- `docs/maintainers/LINT_ORCHESTRATOR_AGENTS.md` and `LINT_ORCHESTRATOR_DESIGN.md` — already well-named
- `scripts/start-with-orchestrator.sh` — `ORCHESTRATOR_ENABLED`/`ORCHESTRATOR_PATH`
  aliases already added

---

## Task 1 — File renames (git mv)

Use `git mv` for all renames to preserve history.

```bash
# Source file
git mv src/spectify-client.ts src/orchestrator-client.ts

# Config file
git mv config-spectify-disabled.yaml config-orchestrator-disabled.yaml

# Reference snapshot directory
git mv ref/spectify ref/linting-orchestrator

# Maintainer docs
git mv docs/maintainers/SPECTIFY_MCP_INTEGRATION.md \
       docs/maintainers/ORCHESTRATOR_MCP_INTEGRATION.md
git mv docs/maintainers/SPECTIFY_MCP_INTEGRATION_ARCHITECTURE.md \
       docs/maintainers/ORCHESTRATOR_MCP_INTEGRATION_ARCHITECTURE.md
git mv docs/maintainers/SPECTIFY_INTEGRATION_TESTING.md \
       docs/maintainers/ORCHESTRATOR_INTEGRATION_TESTING.md
```

---

## Task 2 — `package.json`

Edit `package.json`:

1. `"name"`: `"openapi-analysis-mcp"` → `"@cisco_open/linting-mcp-analyzer"`
2. `"license"`: `"MIT"` → `"Apache-2.0"`
3. `"bin"`: rename the key `"openapi-analysis-mcp"` → `"linting-mcp-analyzer"`
4. Add `"repository"`, `"homepage"`, and `"bugs"` fields:
   ```json
   "repository": {
     "type": "git",
     "url": "https://github.com/cisco-open/linting-mcp-analyzer.git"
   },
   "homepage": "https://github.com/cisco-open/linting-mcp-analyzer#readme",
   "bugs": {
     "url": "https://github.com/cisco-open/linting-mcp-analyzer/issues"
   }
   ```
5. `"author"`: `""` → `"Cisco Systems, Inc."`
6. Local dep: `"file:../spectify/packages/document-store"` →
   `"file:../linting-orchestrator/packages/document-store"`

---

## Task 3 — `src/orchestrator-client.ts` (was `spectify-client.ts`)

After the `git mv`, update **all identifiers inside the file**:

| Old | New |
|---|---|
| `SpectifyClientConfig` | `OrchestratorClientConfig` |
| `SpectifyClient` | `OrchestratorClient` |
| `SpectifyError` | `OrchestratorError` |
| `SpectifyCapacityError` | `OrchestratorCapacityError` |
| `@module spectify-client` | `@module orchestrator-client` |
| `getLogger('spectify')` | `getLogger('orchestrator')` |
| Module docblock "Spectify HTTP Client" | "Linting Orchestrator HTTP Client" |
| Module docblock "Spectify lint orchestrator service" | "OpenAPI linting orchestrator service" |

All other exported interfaces (`LintJobRequest`, `LintJobResponse`, `JobStatus`,
`LintIssue`, `LintJobResult`, `PaginatedLintResult`, `RuleBreakdownEntry`,
`LintResultStats`, `LintResultQueryOptions`, `Ruleset`) are already
well-named — leave them unchanged.

---

## Task 4 — `src/config.ts`

### 4.1 `AppConfig` interface

Rename the field:
```typescript
// Before
spectify: {
  enabled: boolean;
  baseUrl: string;
  ...
};

// After
orchestrator: {
  enabled: boolean;
  baseUrl: string;
  ...
};
```

Update the comment from `// Spectify integration (lint orchestrator)` to
`// Linting orchestrator integration`.

### 4.2 `DEFAULT_CONFIG`

Rename the key `spectify:` → `orchestrator:` in the default config object.

### 4.3 `loadConfig()` YAML parsing

Change the YAML key read:
```typescript
// Before
if (parsed.spectify) {
  config.spectify = { ... parsed.spectify ... };
}

// After
if (parsed.orchestrator) {
  config.orchestrator = { ... parsed.orchestrator ... };
}
```

### 4.4 Env var overrides

```typescript
// Before                              // After
SPECTIFY_ENABLED    →   ORCHESTRATOR_ENABLED
SPECTIFY_BASE_URL   →   ORCHESTRATOR_BASE_URL
SPECTIFY_TIMEOUT    →   ORCHESTRATOR_TIMEOUT
```

Update the env-var read block accordingly. Remove any inline comments that
reference "Spectify" and replace with "linting orchestrator".

---

## Task 5 — `src/index.ts`

1. Update import: `from './spectify-client.js'` → `from './orchestrator-client.js'`
2. Rename all local variables:
   - `spectifyClient` → `orchestratorClient`
   - `spectifyEnabled` → `orchestratorEnabled`
   - `spectifyAvailable` → `orchestratorAvailable`
3. Update all property accesses from `config.spectify.*` → `config.orchestrator.*`
4. Update log strings that say "Spectify integration" → "linting orchestrator integration"
   (but keep "`spectifyd`" in log strings where it refers to the binary — that is correct)
5. Update the startup log: `"✅ Spectify integration enabled at ..."` →
   `"✅ Linting orchestrator integration enabled at ..."`

---

## Task 6 — `src/batch-manager.ts`

1. Update import: `from './spectify-client.js'` → `from './orchestrator-client.js'`
2. Update named imports: `SpectifyClient, SpectifyCapacityError` →
   `OrchestratorClient, OrchestratorCapacityError`
3. Rename all references: `spectifyClient` → `orchestratorClient`,
   `SpectifyClient` type annotations → `OrchestratorClient`

---

## Task 7 — `src/upload-server.ts` and `src/mcp-streamable-server.ts`

Search for any remaining `spectify` identifiers (excluding binary references to
`spectifyd`) and update them using the same rules as Tasks 5–6.

Specifically check:
- Import of `SpectifyClient` → `OrchestratorClient`
- Parameter or property types referencing `SpectifyClient` → `OrchestratorClient`
- Log strings referencing "Spectify" (the product) → "linting orchestrator"

---

## Task 8 — Config YAML files

### `config.yaml`

Rename the `spectify:` top-level key to `orchestrator:`:

```yaml
# Before
# Spectify integration (lint orchestrator)
spectify:
  enabled: true
  ...

# After
# Linting orchestrator integration
# Set enabled: false to disable linting orchestrator integration entirely
orchestrator:
  enabled: true
  ...
```

Also rename env-var references in comments: `SPECTIFY_ENABLED` → `ORCHESTRATOR_ENABLED`,
etc.

### `config-orchestrator-disabled.yaml` (was `config-spectify-disabled.yaml`)

Same key rename: `spectify:` → `orchestrator:`. Update the file's top comment.

---

## Task 9 — `scripts/start-with-orchestrator.sh`

The shell script already has `ORCHESTRATOR_ENABLED`/`ORCHESTRATOR_PATH` aliases.
Keep the backward-compat `SPECTIFY_ENABLED`/`SPECTIFY_PATH` shell variables but
update all **prose comments** that say "Spectify integration" or "the Spectify
daemon" to say "linting orchestrator integration" or "the orchestrator daemon".

Binary names `spectifyd` in echo strings are correct — do not change them.

---

## Task 10 — Renamed maintainer docs (internal content)

Open each of the three renamed docs and update internal references:

- All occurrences of `SPECTIFY_MCP_INTEGRATION.md` (cross-links) →
  `ORCHESTRATOR_MCP_INTEGRATION.md`
- All occurrences of `SPECTIFY_MCP_INTEGRATION_ARCHITECTURE.md` →
  `ORCHESTRATOR_MCP_INTEGRATION_ARCHITECTURE.md`
- All occurrences of `SPECTIFY_INTEGRATION_TESTING.md` →
  `ORCHESTRATOR_INTEGRATION_TESTING.md`
- Any prose saying "Spectify MCP integration" → "linting orchestrator MCP
  integration" (but keep `spectifyd` in shell commands)

Also update cross-links in **all other docs** that reference the old filenames.
A quick sweep:
```bash
grep -rn "SPECTIFY_MCP_INTEGRATION\|SPECTIFY_INTEGRATION_TESTING" docs/ README.md AGENTS.md CHANGELOG.md
```

---

## Task 11 — `README.md`

1. Update the quick-start clone instructions:
   `cd ../spectify` → `cd ../linting-orchestrator`
2. Any remaining mentions of `Spectify integration` in prose → `linting
   orchestrator integration`
3. Verify the repository URL and badge links point to
   `https://github.com/cisco-open/linting-mcp-analyzer`
4. The `package.json` reference `"@cisco_open/linting-document-store":
   "file:../spectify/packages/document-store"` appears in README notes
   (line ~92); update to `file:../linting-orchestrator/packages/document-store`

---

## Task 12 — `CHANGELOG.md`

Add a new entry at the top for the rename/opensource release. Keep historical
entries unchanged (they describe what actually happened at those versions). The
new entry should read:

```markdown
## [1.0.0-rc.1] — 2026-06-11

### Breaking changes

- Package renamed from `openapi-analysis-mcp` to `@cisco_open/linting-mcp-analyzer`
- Binary renamed from `openapi-analysis-mcp` to `linting-mcp-analyzer`
- Config YAML key `spectify:` renamed to `orchestrator:`
- Env vars `SPECTIFY_ENABLED`, `SPECTIFY_BASE_URL`, `SPECTIFY_TIMEOUT` renamed to
  `ORCHESTRATOR_ENABLED`, `ORCHESTRATOR_BASE_URL`, `ORCHESTRATOR_TIMEOUT`
- TypeScript exports `SpectifyClient`, `SpectifyError`, `SpectifyCapacityError`,
  `SpectifyClientConfig` renamed to `OrchestratorClient`, `OrchestratorError`,
  `OrchestratorCapacityError`, `OrchestratorClientConfig`
- Source file `src/spectify-client.ts` renamed to `src/orchestrator-client.ts`
- Repository moved to `github.com/cisco-open/linting-mcp-analyzer`
- License harmonized to Apache-2.0 (was MIT in package.json metadata; LICENSE
  file was already Apache-2.0)

### Non-breaking
- `scripts/start-with-orchestrator.sh` retains `SPECTIFY_ENABLED` / `SPECTIFY_PATH`
  shell variable aliases for runtime backward compatibility
- All binary names (`spectifyd`) unchanged
- All HTTP API endpoints, MCP tool names, and data formats unchanged
```

---

## Task 13 — `AGENTS.md` final review

The `AGENTS.md` is already largely correct (it references `linting-mcp-analyzer`
and cisco-open URLs). Verify and fix only:

1. Clone instruction: `cd ../spectify` → `cd ../linting-orchestrator`
2. Any reference to `src/spectify-client.ts` → `src/orchestrator-client.ts`
3. Any internal link to the old doc filenames (SPECTIFY_MCP_INTEGRATION*.md)

Do **not** change the sections that already correctly use `spectifyd` in shell
commands.

---

## Task 14 — Community / legal files audit

Check the following files and update any stale content:

- `CONTRIBUTING.md` — verify repo URL, `npm install` instructions still correct
- `SECURITY.md` — verify contact/reporting URL points to cisco-open
- `MAINTAINERS.md` — no changes expected unless it lists the old wwwin-github URL
- `SUPPORT.md` — verify it references `github.com/cisco-open/linting-mcp-analyzer`
- `CODE_OF_CONDUCT.md` — typically boilerplate, but check for any project-specific URLs

---

## Task 15 — Build and test

After all changes:

```bash
# In the mcp-openapi-analysis directory
npm run build

# Verify the binary resolves
node build/index.js --help

# Run tests (bats required)
npm run test:base
```

If `npm install` fails because `../linting-orchestrator` does not exist yet
(the orchestrator repo hasn't been renamed locally), temporarily keep the old
path for installation purposes and note it as a TODO. The critical check is
that TypeScript compiles without errors.

---

## Commit strategy

Use a single commit for the rename:

```
feat: open-source rename — openapi-analysis-mcp → @cisco_open/linting-mcp-analyzer

- Rename package, binary, and repository to linting-mcp-analyzer under cisco-open
- Rename src/spectify-client.ts → src/orchestrator-client.ts
- Rename SpectifyClient/SpectifyError/SpectifyCapacityError/SpectifyClientConfig
  → OrchestratorClient/OrchestratorError/OrchestratorCapacityError/OrchestratorClientConfig
- Rename config YAML key spectify: → orchestrator:
- Rename env vars SPECTIFY_ENABLED/SPECTIFY_BASE_URL/SPECTIFY_TIMEOUT
  → ORCHESTRATOR_ENABLED/ORCHESTRATOR_BASE_URL/ORCHESTRATOR_TIMEOUT
- Rename config-spectify-disabled.yaml → config-orchestrator-disabled.yaml
- Rename SPECTIFY_MCP_INTEGRATION*.md → ORCHESTRATOR_MCP_INTEGRATION*.md
- Rename ref/spectify/ → ref/linting-orchestrator/
- Update license field in package.json: MIT → Apache-2.0
- Add package.json repository/homepage/bugs/author fields
- Update all prose references: "Spectify integration" → "linting orchestrator integration"
- Keep spectifyd binary name references unchanged (they refer to the orchestrator binary)
- Keep SPECTIFY_ENABLED/SPECTIFY_PATH shell aliases in start-with-orchestrator.sh
  for runtime backward compatibility
```

---

## Pitfalls and edge cases

1. **`config.spectify` vs `config.orchestrator`** — this is a config-file breaking
   change. Any existing `config.yaml` files used by operators will break if they
   still use the `spectify:` key. Since this is pre-1.0 with no public users, this
   is acceptable. The CHANGELOG entry must be clear.

2. **`ref/linting-orchestrator/` contents** — this directory contains a snapshot
   copy of the old orchestrator source. Do **not** edit the files inside it. Only
   rename the parent directory. The files reference old names intentionally (they
   are historical snapshots).

3. **Import path in TypeScript** — after renaming `spectify-client.ts` to
   `orchestrator-client.ts`, TypeScript import statements use `.js` extension
   (ESM style). Verify every import is updated to `'./orchestrator-client.js'`.

4. **Other source files not listed** — run a final sweep after all the listed
   changes to catch any remaining `spectify` occurrences that aren't binary names:
   ```bash
   grep -rn "spectify\|SPECTIFY\|SpectifyClient" src/ --include="*.ts" | \
     grep -v "spectifyd\|SPECTIFYD\|SPECTIFYR\|~/.spectify"
   ```
   This should return zero results when the work is complete.

5. **`mcp-config.example.json`** — check if it contains a `spectify` key and
   rename it to `orchestrator` to match the YAML config change.
