# Agent Prompt: Build the Linting Rulesets Template and Migrate the Orchestrator

This document is a self-contained briefing for an AI coding agent (Copilot,
Claude Sonnet, Claude Opus) working in the multi-root VS Code workspace that
contains the three repositories listed below. Read it fully before touching
any file.

---

## Workspace layout

```
spectify/                         ← @cisco-open/linting-orchestrator monorepo
openapi-rulesets-template/       ← NEW template repo (to be built)
ruleset-util/             ← existing utility repo (review before acting)
```

The workspace file is `spectify/spectify-dev.code-workspace`.

---

## Required reading before implementation

Before writing any code, read these documents in order:

1. `spectify/docs/maintainers/ruleset-externalization.md`
   Full architecture design. All decisions in this prompt derive from it.

2. `spectify/packages/orchestrator/src/ruleset-loader.ts`
   Understand how `loadRulesetVersion()` resolves paths (lines ~116–140).

3. `spectify/packages/orchestrator/src/types.ts`
   `RulesetVersionConfig` interface (lines ~169–181). This is what the YAML
   deserialises into.

4. `spectify/packages/orchestrator/rulesets/config/rulesets.yaml`
   Current registry with the four Cisco-internal rulesets that will be removed.

5. `openapi-ruleset-util/` — survey all source files.
   Understand what tooling already exists. Do not duplicate it in the template.
   The template's `scripts/validate.sh` and `scripts/install.sh` should call
   into ruleset-util if it provides equivalent functionality, or be standalone
   bash if it does not.

---

## Task 1 — Build `spectify-rulesets-template`

Create the following complete repository structure. Every file listed must be
created.

### 1.1 Directory layout

```
spectify-rulesets-template/
├── config/
│   └── rulesets.yaml              ← registry read by spectify (SPECTIFYD_RULESETS_DIR)
├── sources/
│   └── example/
│       └── oas-recommended/
│           ├── v1.0.0/
│           │   └── ruleset.yaml
│           └── v2.0.0/
│               └── ruleset.yaml
├── scripts/
│   ├── validate.sh
│   └── install.sh
├── AGENTS.md
├── README.md
└── LICENSE                        ← Apache-2.0 (copy header from spectify)
```

### 1.2 `config/rulesets.yaml`

Register one ruleset (`oas-recommended`) with two versions. Use the **full**
schema (all fields from `RulesetConfigEntry` and `RulesetVersionConfig` in
`spectify/packages/orchestrator/src/types.ts`) so the file is a valid teaching
example.

```yaml
# Orchestrator Ruleset Configuration
# Point SPECTIFYD_RULESETS_DIR at the root of this repository.
#
# Layout: sources/{sourceRepo}/{sourceVersion}/{entrypoint}
# Tooling: scripts/validate.sh  scripts/install.sh

rulesets:
  - name: oas-recommended
    displayName: "OpenAPI Recommended"
    category: validation
    origin: external
    description: >
      Core OpenAPI 3.x validation rules built on Spectral's built-in OAS
      ruleset, extended with a small set of opinionated quality rules.
      No npm dependencies required.
    tags:
      - oas
      - spectral
    metadata:
      team: "Your team name"
      repository: "https://github.com/your-org/spectify-rulesets-template"
      license: "Apache-2.0"
      documentation: ""
    versions:
      - version: "1.0.0"
        sourceRepo: "example/oas-recommended"
        sourceVersion: "v1.0.0"
        entrypoint: "ruleset.yaml"
        releaseDate: "2026-06-01"
        deprecated: false
        changelog: "Initial release. Extends spectral:oas recommended profile."
      - version: "2.0.0"
        sourceRepo: "example/oas-recommended"
        sourceVersion: "v2.0.0"
        entrypoint: "ruleset.yaml"
        releaseDate: "2026-06-01"
        deprecated: false
        changelog: >
          v2: adds operation-operationId, operation-tags, and
          info-contact-email rules on top of the v1 base.

defaults:
  oas-recommended: "2.0.0"
```

### 1.3 Ruleset YAML files

Both files are pure YAML with no `package.json`. They reference `spectral:oas`
which resolves via `@stoplight/spectral-rulesets` already bundled inside the
spectify orchestrator package. **Do not add a `package.json`.**

**`sources/example/oas-recommended/v1.0.0/ruleset.yaml`**

```yaml
# oas-recommended v1.0.0
# Extends Spectral's built-in OAS recommended profile.
# No additional npm dependencies required.
extends: [[spectral:oas, recommended]]
rules:
  info-contact: true
```

**`sources/example/oas-recommended/v2.0.0/ruleset.yaml`**

```yaml
# oas-recommended v2.0.0
# Adds quality rules on top of the v1 base.
extends: [[spectral:oas, recommended]]
rules:
  info-contact: true
  operation-operationId: true
  operation-tags: true
  info-contact-email:
    message: "info.contact must include an email address"
    given: "$.info.contact"
    severity: warn
    then:
      field: email
      function: truthy
```

### 1.4 `scripts/validate.sh`

Full implementation. Exit 0 on success, non-zero with per-error messages on
failure. Checks (in order):

1. **YAML syntax** — `config/rulesets.yaml` must parse without error.
   Use Python (`python3 -c "import yaml,sys; yaml.safe_load(sys.stdin)"`) if
   present; otherwise `node -e "require('js-yaml').load(require('fs').readFileSync('config/rulesets.yaml','utf8'))"`.
   Prefer python3 since it has no npm dep.

2. **Required fields** — every version entry must have: `version`,
   `sourceRepo`, `sourceVersion`, `entrypoint`, `releaseDate`.

3. **Source path existence** — for each version entry, the file at
   `sources/{sourceRepo}/{sourceVersion}/{entrypoint}` must exist.

4. **No duplicate ruleset names** — no two top-level entries share the same
   `name` field.

5. **Default version resolvable** — every key in `defaults` must match a
   ruleset `name`, and the version value must exist in that ruleset's
   `versions` array; OR the value is `"latest"` (which spectify resolves to
   the last non-deprecated entry).

Output format (matches the example in the design doc):

```
✅ YAML syntax OK
✅ oas-recommended:1.0.0  sources/example/oas-recommended/v1.0.0/ruleset.yaml
✅ oas-recommended:2.0.0  sources/example/oas-recommended/v2.0.0/ruleset.yaml
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Summary: 0 error(s). All checks passed.
```

### 1.5 `scripts/install.sh`

Find all `package.json` files under `sources/` (excluding `node_modules/`).
For each:
- If a `package-lock.json` exists alongside it, run `npm ci`.
- Otherwise run `npm install`.
Print the dir being processed. Exit 0 when all succeed.

If no `package.json` files are found, print a message and exit 0.

### 1.6 `AGENTS.md`

Write an `AGENTS.md` for contributors to the template repo. Cover:

- What this repo is (a template/starter for teams managing their own spectify
  ruleset catalogue)
- How to fork/clone and use it (`SPECTIFYD_RULESETS_DIR`)
- How to add a new ruleset (add source files under `sources/`, register in
  `config/rulesets.yaml`, run `scripts/validate.sh`)
- How to add a new version of an existing ruleset (add a new `sources/`
  subdir, add a new `versions` entry)
- Dependency installation (`scripts/install.sh` — only needed for JS rulesets
  with a `package.json`)
- CI recommendation (run `scripts/validate.sh` in CI before merging)
- How to point a Docker deployment at this repo (volume mount +
  `SPECTIFYD_RULESETS_DIR`)
- Reference: `spectify/docs/maintainers/ruleset-externalization.md` for the
  full architecture

### 1.7 `README.md`

User-facing readme. Sections: Overview, Quick Start (3 steps: clone, validate,
set env var), Directory Layout, Ruleset Configuration Reference (link to
AGENTS.md), How it Works (link to spectify), Contributing.

---

## Task 2 — Migrate spectify to a minimal built-in ruleset

All changes are inside `spectify/packages/orchestrator/`.

### 2.1 Replace the built-in ruleset sources

Remove the four Cisco-internal source trees:

```
packages/orchestrator/rulesets/sources/github.com/
packages/orchestrator/rulesets/sources/wwwin-github.cisco.com/
```

Replace with the two example rulesets from Task 1 (identical content):

```
packages/orchestrator/rulesets/sources/example/oas-recommended/v1.0.0/ruleset.yaml
packages/orchestrator/rulesets/sources/example/oas-recommended/v2.0.0/ruleset.yaml
```

### 2.2 Update `packages/orchestrator/rulesets/config/rulesets.yaml`

Replace entirely with a minimal registry that mirrors `config/rulesets.yaml`
from the template repo (same `oas-recommended` entries). Add a header comment
explaining this is the built-in fallback and pointing users to the
externalization doc for how to supply their own.

### 2.3 Implement `absolutePath` in `types.ts`

Add an optional field to `RulesetVersionConfig`:

```typescript
export interface RulesetVersionConfig {
  version: string;
  sourceRepo: string;
  sourceVersion: string;
  entrypoint: string;
  releaseDate: string;
  deprecated: boolean;
  changelog?: string;
  /**
   * When set, overrides the sourceRepo/sourceVersion/entrypoint path
   * construction. The loader will load this absolute path directly.
   * Useful for rulesets installed outside the sources/ tree (e.g. via
   * OS package manager or a separate monorepo checkout).
   */
  absolutePath?: string;
}
```

Also add it to the `LoadedRulesetVersion` / `RulesetVersion` types if those
mirror the config type (check `types.ts` and `ruleset-loader.ts` carefully).

### 2.4 Implement `absolutePath` in `ruleset-loader.ts`

In `loadRulesetVersion()`, before computing `sourcePath`, check for
`absolutePath`:

```typescript
const sourcePath = versionConfig.absolutePath
  ? path.resolve(versionConfig.absolutePath)   // absolute or relative to cwd
  : path.resolve(
      this.loaderConfig.sourcesBasePath,
      versionConfig.sourceRepo,
      versionConfig.sourceVersion,
      versionConfig.entrypoint
    );
```

The error message when the file is not found should include the resolved path
regardless of which branch was taken.

Also update `getSourceDir()` (around line 282): if `absolutePath` is set,
`sourceDir` should be `path.dirname(versionConfig.absolutePath)` so that
dependency checks and `node_modules` resolution still work.

### 2.5 Update documentation references

- `packages/orchestrator/rulesets/CHANGELOG.md` — add an entry noting the
  removal of the Cisco-internal rulesets and the addition of the built-in
  `oas-recommended` example.
- `packages/orchestrator/AGENTS.md` — update the "rulesets" section to
  explain the minimal built-in and reference the externalization doc.
- `docs/maintainers/ruleset-externalization.md` — the "Cisco-internal
  rulesets" section says they will "eventually" be extracted; update it to
  say they have been extracted and link to the template repo.

---

## Task 3 — Verify

After all changes, run from the `spectify/` root:

```bash
npm run build
npm test
npm run check-rulesets
spectify rulesets          # should list oas-recommended with 2 versions
```

Also run from `spectify-rulesets-template/`:

```bash
bash scripts/validate.sh   # must exit 0
bash scripts/install.sh    # must report "no package.json found" or similar
```

---

## Commit strategy

Use three commits, one per task:

```
feat(orchestrator): add built-in oas-recommended ruleset (2 versions, YAML-only)

Remove Cisco-internal rulesets from bundled sources. Replace with a minimal
oas-recommended example (v1.0.0 and v2.0.0) that requires no npm deps and
illustrates the two-version versioning model.
```

```
feat(orchestrator): implement absolutePath in RulesetVersionConfig

Allows YAML entries to reference ruleset files at arbitrary absolute paths,
bypassing the sources/{sourceRepo}/{sourceVersion}/{entrypoint} layout.
Useful for OS-installed rulesets or unconventional checkout structures.
```

```
feat(template): initial spectify-rulesets-template repository

Template/starter for teams managing their own spectify ruleset catalogue.
Includes oas-recommended example (v1.0.0 and v2.0.0), validate.sh, install.sh,
AGENTS.md, and README.
```

---

## Known constraints and pitfalls

- **`spectral:oas` resolution**: works without a local `package.json` because
  `@stoplight/spectral-rulesets` is already in the orchestrator's
  `node_modules`. If a test loads a ruleset in isolation (e.g. unit test that
  does not go through the orchestrator), it may fail to resolve `spectral:oas`.
  Check existing tests in `packages/orchestrator/tests/` for how ruleset
  loading is tested and mock accordingly.

- **`sourceRepo` and `sourceVersion` still required in YAML even when
  `absolutePath` is set?** No — make them optional (`sourceRepo?: string;
  sourceVersion?: string;`) when `absolutePath` is provided. Update the YAML
  validation in `ruleset-loader.ts` to accept entries where either
  `absolutePath` or all three of `sourceRepo` + `sourceVersion` + `entrypoint`
  are present, but not neither.

- **`defaults` section in `rulesets.yaml`**: the key in `defaults` must match
  a ruleset `name`. After the migration this should only contain
  `oas-recommended: "2.0.0"` (or `"latest"`).

- **Removing the `github.com/` source trees**: these are not git submodules
  (the repo moved away from submodules). A plain `git rm -r` works. Confirm
  with `git status` before committing.

- **ruleset-util repo**: the agent must review this repo's actual content
  before designing the validate/install scripts. If it already provides a
  `validate` or `lint-registry` command, the template scripts should delegate
  to it rather than reimplement. If it targets a different registry format,
  note the discrepancy in a comment.
