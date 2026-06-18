# Managing Spectral's embedded rulesets

This note explains how to operate the `embedded` ruleset entries that
expose Spectral's built-in rulesets (`spectral:oas`, `spectral:asyncapi`,
`spectral:arazzo`) through a orchestrator catalogue.  Read it once before
adding or maintaining any `origin: embedded` entry.

Companion reads:

- [ruleset-curation-for-pms.md](ruleset-curation-for-pms.md) — origin
  classification methodology (`embedded` / `internal` / `external`).
- [openapi-rulesets-template AGENTS.md](https://github.com/DevNet/openapi-rulesets-template/blob/main/AGENTS.md)
  — the schema reference for `embedded` entries.

---

## 1. The problem

Spectral's built-in rulesets ship inside the npm package
`@stoplight/spectral-rulesets`, which is itself a transitive dependency
of the Spectral CLI (`@stoplight/spectral-cli`).  The catalogue cannot
pin the rule content directly — it only declares that the *Spectral
built-in token* (`spectral:oas`) is exposed under a stable catalogue
name (`oas-builtin`).

The effective rule content is therefore determined by **whatever
version of `@stoplight/spectral-rulesets` happens to be installed**
alongside the orchestrator.  Today (2026-06):

| Surface | Version |
|---|---|
| Spectral CLI shipped with the orchestrator | `6.15.0` |
| `@stoplight/spectral-rulesets` it pulls in | `1.22.0` (2025-04-22) |
| Upstream `main` of `@stoplight/spectral-rulesets` | `1.22.3` (2026-05-21) |

Three patch releases (`1.22.1`, `1.22.2`, `1.22.3`) shipped between
those two points — each containing bug fixes that affect rule
behaviour.  A consumer of the catalogue who reads "oas-builtin
latest" has no idea which of those four point releases they are
actually running.

This is the operational gap `embedded` deliberately accepts in
exchange for the simplicity of zero vendoring.  This document
explains how to manage that gap.

## 2. Finding the effective version

### 2.1 At runtime (the user surface)

After a orchestrator deployment is up, the catalogue PM can ask:

```bash
spectify rulesets oas-builtin
```

The output includes:

```
Version:      latest (effective: 1.22.0, from @stoplight/spectral-rulesets)
```

This is populated by the loader at startup by reading
`node_modules/@stoplight/spectral-rulesets/package.json` next to the
orchestrator's installation root.  The value is also exposed on the
`/rulesets/{name}` HTTP endpoint as `resolvedVersion`.

If `resolvedVersion` is missing, either:

- the entry doesn't declare `package:` (add it — see the schema), or
- the npm package isn't reachable from the orchestrator's resolution
  root (broken install).

### 2.2 At the source (the maintainer surface)

For audit or comparison, look directly inside the installed package:

```bash
cat $(npm root -g)/@cisco-open/linting-orchestrator/node_modules/@stoplight/spectral-rulesets/package.json | jq .version

# Or, for a non-global install:
cat /path/to/spectifyd/install/node_modules/@stoplight/spectral-rulesets/package.json | jq .version
```

Cross-reference that version against the upstream changelog at
[stoplightio/spectral CHANGELOG](https://github.com/stoplightio/spectral/blob/develop/packages/rulesets/CHANGELOG.md).

## 3. Routine review cadence

Treat the embedded ruleset as a third-party dependency that needs
periodic curation, not as a fire-and-forget binding.

| Cadence | Action | Owner |
|---|---|---|
| **Quarterly** | Compare the orchestrator's `resolvedVersion` against the latest upstream tag.  Read every release entry between the two.  Decide: pull in (bump the orchestrator's Spectral CLI), pin (switch to `external`, see §5), or stay. | Catalogue PM |
| **On upstream release** | If you subscribe to GitHub release notifications for `stoplightio/spectral`, triage within one sprint.  Skip noise; do not auto-adopt. | Catalogue PM |
| **On orchestrator Spectral CLI bump** | Verify the new `resolvedVersion` matches your expectation.  Re-run smoke tests (§4) against representative specs. | Orchestrator maintainer |

Capture the result of each review in `CHANGELOG.md` of the catalogue
repo, even when the decision is "stay on the embedded version".  A
single line is enough:

```markdown
## 2026-09-01 — Quarterly Spectral ruleset review

- Embedded `oas-builtin` runs at 1.22.0; latest is 1.22.3.
- Reviewed CHANGELOG 1.22.1 → 1.22.3.  Only bug fixes; no rule
  additions or severity changes.  Stay on 1.22.0 for now.
- Re-evaluate at 1.23.0 release or in three months, whichever
  comes first.
```

## 4. Smoke-testing an embedded ruleset

Even though `embedded` rules require no vendoring, you still need to
verify they load and behave as expected after any orchestrator install
or upgrade:

```bash
# Confirm the orchestrator loads the entry without error
spectify rulesets oas-builtin

# Lint a representative spec
spectify lint examples/petstore.yaml --ruleset oas-builtin

# Spot-check rules you care about (numbers, names)
spectify rulesets oas-builtin --verbose | grep -E '^\s*•'
```

If a known-good fixture starts producing different findings after an
orchestrator bump, the change is in `@stoplight/spectral-rulesets`.
Read the upstream CHANGELOG for the version range
(`previous-resolvedVersion → new-resolvedVersion`) to identify the
responsible change.

## 5. When the embedded version isn't acceptable

Two scenarios make `embedded` insufficient:

1. **You need to pin to a specific historical version** (e.g. you
   audited 1.22.0, certified your downstream consumers against it,
   and an orchestrator upgrade would now ship 1.22.4 with a behaviour
   change you can't absorb today).
2. **You need to evaluate a newer version in parallel** (e.g.
   1.22.0 is in production; you want to see what 1.22.3 changes
   without forcing an orchestrator upgrade on everyone).

For both cases, switch the entry's `origin` from `embedded` to
`external` and vendor the snapshot under `sources/`.  This is the
documented escape hatch (see [openapi-rulesets-template AGENTS.md](https://github.com/DevNet/openapi-rulesets-template/blob/main/AGENTS.md#decision-flowchart)).

Worked example — keeping the embedded entry **and** pinning a
specific version side-by-side:

```yaml
rulesets:
  # Production: tracks whatever orchestrator ships.
  - name: oas-builtin
    origin: embedded
    versions:
      - version: latest
        entrypoint: spectral:oas
        package: "@stoplight/spectral-rulesets"
        # …

  # Pinned: audited, frozen.  Update only on a deliberate review.
  - name: oas-pinned
    displayName: "OpenAPI Core (pinned)"
    origin: external
    description: "Pinned snapshot of @stoplight/spectral-rulesets."
    metadata:
      team: "API Council"
      maintainer: "API Council"
      contact: "https://github.com/your-org/your-catalogue/issues"
      repository: "https://github.com/stoplightio/spectral"
      license: "Apache-2.0"
    versions:
      - version: "1.22.0"
        sourceRepo: "github.com/stoplightio/spectral"
        sourceVersion: "@stoplight/spectral-rulesets-1.22.0"
        entrypoint: "packages/rulesets/dist/oas/index.js"
        releaseDate: "2025-04-22"
        deprecated: false
        changelog: "Frozen snapshot for compliance baseline."
```

`scripts/vendor.sh` will resolve the upstream tag
`@stoplight/spectral-rulesets-1.22.0`, prompt to clone, and copy the
relevant `packages/rulesets/` subtree into `sources/`.  After that,
catalogue users can request either ruleset by name.

## 6. The `spectral-rulesets-mirror` catalogue — proposal

Vendoring each upstream patch by hand (as in §5) is tedious and
error-prone.  A dedicated **mirror catalogue** would make per-version
evaluation cheap.

### 6.1 Shape

`github.com/<org>/spectral-rulesets-mirror` — itself an orchestrator
catalogue built from
[`openapi-rulesets-template`](https://github.com/DevNet/openapi-rulesets-template),
dedicated to mirroring Spectral's built-in rulesets.

For every published `@stoplight/spectral-rulesets-X.Y.Z` tag upstream
the mirror catalogue:

- Adds a new entry to its own `versions:` array in
  `config/rulesets.yaml` (one ruleset per Spectral built-in: `oas`,
  `asyncapi`, `arazzo`).  Each version uses `origin: external` and
  points at the upstream tag.
- Vendors a trimmed snapshot of upstream `packages/rulesets/` under
  `sources/github.com/stoplightio/spectral/@stoplight/spectral-rulesets-X.Y.Z/`
  (just enough to load the rulesets; no upstream tests, no build
  tooling).  The standard `scripts/vendor.sh` from the template does
  this work.
- Maintains a `MANIFEST.json` (or just the catalogue `CHANGELOG.md`)
  mapping each catalogue version to its upstream commit SHA and the
  source CHANGELOG entries.
- Tags itself (`v1.22.0`, `v1.22.1`, …) in lockstep with the upstream
  ruleset patch it added — the catalogue version intentionally
  mirrors the rule version it exposes, since the catalogue's only
  job is to mirror.

The mirror is automated: a CI job polls upstream once a day, opens a
PR per new tag, the standard `scripts/validate.sh` + smoke-test runs,
and a human merges after a quick eyeball.  The mirror catalogue does
not modify rule content — divergence from upstream is a bug.

### 6.2 Consumer experience

Two consumption modes:

**(a) Use the mirror catalogue directly** (simplest — for environments
that only need Spectral built-ins):

```bash
git clone https://github.com/<org>/spectral-rulesets-mirror.git
SPECTIFYD_RULESETS_DIR=$PWD/spectral-rulesets-mirror spectifyd
spectify rulesets        # lists oas, asyncapi, arazzo with all versions
```

**(b) Reference mirror entries from your own catalogue** (typical —
you already maintain a catalogue with internal/external rulesets and
want to add per-version Spectral built-ins to it):

Copy the relevant `versions:` entries from the mirror's
`config/rulesets.yaml` into your own catalogue and run
`scripts/vendor.sh` — it will fetch the same upstream tags and
produce identical `sources/` snapshots.  The mirror catalogue is the
reference; your catalogue is independent.

A worked example of mode (b), composed with the existing
`oas-builtin` embedded entry:

```yaml
rulesets:
  - name: oas-builtin
    origin: embedded
    versions:
      - version: latest
        entrypoint: spectral:oas
        package: "@stoplight/spectral-rulesets"

  - name: oas
    displayName: "Spectral OAS rules (per-version)"
    origin: external
    metadata:
      team: "API Council"
      maintainer: "Stoplight (mirrored by <your org>)"
      contact: "https://github.com/<org>/spectral-rulesets-mirror/issues"
      repository: "https://github.com/<org>/spectral-rulesets-mirror"
      license: "Apache-2.0"
    versions:
      - version: "1.22.0"
        sourceRepo: "github.com/stoplightio/spectral"
        sourceVersion: "@stoplight/spectral-rulesets-1.22.0"
        entrypoint: "packages/rulesets/dist/oas/index.js"
        releaseDate: "2025-04-22"
        deprecated: false
      - version: "1.22.1"
        sourceRepo: "github.com/stoplightio/spectral"
        sourceVersion: "@stoplight/spectral-rulesets-1.22.1"
        entrypoint: "packages/rulesets/dist/oas/index.js"
        releaseDate: "2026-04-13"
        deprecated: false
      - version: "1.22.2"
        sourceRepo: "github.com/stoplightio/spectral"
        sourceVersion: "@stoplight/spectral-rulesets-1.22.2"
        entrypoint: "packages/rulesets/dist/oas/index.js"
        releaseDate: "2026-05-12"
        deprecated: false
      - version: "1.22.3"
        sourceRepo: "github.com/stoplightio/spectral"
        sourceVersion: "@stoplight/spectral-rulesets-1.22.3"
        entrypoint: "packages/rulesets/dist/oas/index.js"
        releaseDate: "2026-05-21"
        deprecated: false

defaults:
  oas: "1.22.0"          # production default
```

Users compare `oas:1.22.0` vs `oas:1.22.3` against the same spec with
two `spectify lint --ruleset oas --version …` calls.  When the new
version is approved, the PM bumps `defaults.oas` and writes a
catalogue release note.

### 6.3 Why this is worth doing

- **Decouples evaluation from orchestrator upgrades.**  Today you
  can't evaluate `1.22.3` without first finding a Spectral CLI build
  that bundles it.  With the mirror, every published patch is testable
  the day it lands.
- **Makes the embedded gap auditable.**  The diff between
  `oas-builtin.resolvedVersion` and `defaults.oas` is the "Spectral
  patch debt" you are choosing to accept.
- **Reuses the existing template.**  No new tooling: the mirror is
  just a catalogue that happens to mirror one upstream.  The same
  `vendor.sh` / `validate.sh` / `install.sh` and the same review
  workflow apply.  Anyone who can read the template can read the
  mirror.
- **Aligns with the [ObjectIsAdvantag/spectral](https://github.com/ObjectIsAdvantag/spectral)
  fork's** goal of independent CLI/ruleset versioning.  The mirror is
  the catalogue-side complement to that fork-side work: once Stoplight
  ships ruleset-only patch tags (which they already do under
  `@stoplight/spectral-rulesets-X.Y.Z`), the mirror simply tracks
  them.
### 6.4 Risks and tradeoffs

- **Maintenance burden.**  Someone has to own the daily PR review.
  Estimate: ten minutes a week at the current upstream cadence (3-5
  ruleset patches per year).
- **Function-resolution edge cases.**  Some rules in the OAS ruleset
  reference custom functions packaged inside
  `@stoplight/spectral-rulesets`.  The vendored snapshot must include
  enough of `packages/rulesets/dist/` for the functions to resolve
  when loaded by the bundler.  The mirror catalogue's standard smoke
  test (`spectify lint examples/petstore.yaml --ruleset oas --version
  X.Y.Z`) is what catches this on first vendor of each tag.
- **Divergence risk if a human edits.**  Enforce via CI that the
  vendored bytes under
  `sources/github.com/stoplightio/spectral/@stoplight/spectral-rulesets-X.Y.Z/`
  match the upstream tag bytes (modulo the template's exclusion list:
  `node_modules/`, `dist/`, `test(s)/`, `coverage/`, `snapshots/`).
  A divergence is a release-blocker bug.

### 6.5 Status

Not yet built.  This document is the proposal.  Tracking issue: TBD.

---

## See also

- [ruleset-curation-for-pms.md](ruleset-curation-for-pms.md) — the
  parent methodology document.
- [ruleset-externalization.md](ruleset-externalization.md) — the
  externalization architecture and schema.
- [openapi-rulesets-template/AGENTS.md](https://github.com/DevNet/openapi-rulesets-template/blob/main/AGENTS.md)
  — schema reference for `embedded` and `external` entries.
- [ObjectIsAdvantag/spectral](https://github.com/ObjectIsAdvantag/spectral)
  — the fork pursuing independent CLI/ruleset versioning.
