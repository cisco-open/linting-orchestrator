# Ruleset Externalization Architecture

This document describes the design for externalizing the linting orchestrator's
ruleset catalogue away from the orchestrator package and into independently
managed repositories.

---

## Background

The linting orchestrator ships with a set of Spectral rulesets vendored inside the orchestrator
package under `packages/orchestrator/rulesets/`. This tree contains:

- `config/rulesets.yaml` — the ruleset registry (which rulesets exist, their
  versions, and where their source files live)
- `sources/` — vendored copies of ruleset source files, organised as
  `sources/{domain}/{org}/{repo}/{version}/`

This works well for development and initial deployment, but it tightly couples
ruleset updates to orchestrator release cycles. Teams that want to maintain their
own ruleset catalogue — adding private rulesets, pinning different versions, or
updating rulesets without waiting for a spectify release — have no clean
mechanism to do so today.

The goals of externalization are:

1. Allow any team to manage their own ruleset catalogue in an independent
   repository, versioned and deployed on their own schedule.
2. Keep spectify itself small: ship only a minimal built-in ruleset that works
   out of the box with no extra dependencies.
3. Provide clear tooling contracts so that externally maintained ruleset repos
   are self-validating and self-installing.

---

## How spectify resolves rulesets today

At startup, `spectifyd` resolves the rulesets directory from one of three
sources, in priority order:

1. `--rulesets-directory <path>` CLI flag
2. `SPECTIFYD_RULESETS_DIR` environment variable
3. Default: the `rulesets/` directory adjacent to the built package
   (`packages/orchestrator/rulesets/` during development, or the installed
   package's `rulesets/` in production)

The resolved directory must contain two sub-trees:

```
<rulesets-dir>/
├── config/
│   └── rulesets.yaml        ← registry file
└── sources/                 ← vendored ruleset source files
    └── {domain}/
        └── {org}/
            └── {repo}/
                └── {version}/
                    ├── *.yaml | *.js     ← entrypoint
                    ├── functions/        ← optional custom functions
                    └── package.json      ← optional; declares npm deps
```

The `RulesetLoader` at `packages/orchestrator/src/ruleset-loader.ts` reads
`config/rulesets.yaml` and resolves each ruleset's entrypoint as:

```
sources/{sourceRepo}/{sourceVersion}/{entrypoint}
```

This means the entire `<rulesets-dir>/` tree can be replaced by pointing the
env var or CLI flag at a different directory — which is the hook that external
ruleset repos will use.

---

## Proposed architecture: template repository

Rather than embedding external-ruleset management into spectify itself, the
recommended approach is a **template repository** that teams fork or clone. The
template provides:

- The directory layout expected by spectify
- Tooling scripts for validation and dependency installation
- One simple example ruleset that works with no extra npm dependencies

This separates concerns cleanly:

| Concern | Lives in |
|---|---|
| Ruleset engine (Spectral integration, worker pool, API) | spectify orchestrator package |
| Ruleset catalogue (which rulesets, what versions) | team-owned template-derived repo |
| Ruleset source code (`.yaml` / `.js` files + functions) | sources/ tree inside that repo |
| Dependency installation | `scripts/install.sh` inside that repo |
| Catalogue validation | `scripts/validate.sh` inside that repo |

### Template repository layout

```
my-rulesets/                          ← team forks/clones this
├── rulesets.yaml                     ← registry (the only required file at root)
├── sources/                          ← vendored ruleset files
│   └── {domain}/
│       └── {org}/
│           └── {repo}/
│               └── {version}/
│                   ├── *.yaml | *.js
│                   └── package.json  ← optional
├── scripts/
│   ├── validate.sh                   ← syntax check + path existence
│   └── install.sh                    ← npm install in each sources/ subdir
├── README.md
└── LICENSE
```

> **Note**: the root `rulesets.yaml` is a convenience alias. When spectify
> is pointed at this repo (`SPECTIFYD_RULESETS_DIR=/path/to/my-rulesets`), it
> looks for `config/rulesets.yaml`. Teams can either keep a `config/`
> subdirectory or symlink `config/rulesets.yaml → ../rulesets.yaml`. The
> template can include both.

### `rulesets.yaml` format

The format is unchanged from the current registry:

```yaml
rulesets:
  - id: my-custom-rules
    name: "My Custom Rules"
    description: "Internal API standards for Acme Corp"
    defaultVersion: latest
    versions:
      - version: "2026-03-01"
        sourceRepo: "github.com/acme/api-rulesets"
        sourceVersion: "2026-03-01"
        entrypoint: "ruleset.yaml"
        releaseDate: "2026-03-01"
```

Each entry's `entrypoint` is resolved relative to
`sources/{sourceRepo}/{sourceVersion}/`.

---

## Validate tool (`scripts/validate.sh`)

The validate script performs static checks against `rulesets.yaml` before
any changes are deployed. It should be run in CI and before calling
`install.sh`.

### Checks performed

1. **YAML syntax**: the file parses without errors.
2. **Required fields**: every version entry has `id`, `version`,
   `sourceRepo`, `sourceVersion`, and `entrypoint`.
3. **Source path existence**: for every version entry, the path
   `sources/{sourceRepo}/{sourceVersion}/{entrypoint}` exists on disk.
4. **No duplicate ids**: no two top-level ruleset entries share the same `id`.
5. **Default version resolvable**: if `defaultVersion` is not `latest`, the
   referenced version must exist in the `versions` array.

### Output contract

- Zero exit code + green summary when all checks pass.
- Non-zero exit code + per-error messages (file, entry id, check that failed)
  when any check fails. This makes it safe to use as a CI gate.

### Example output

```
✅ YAML syntax OK
✅ my-custom-rules:2026-03-01  sources/github.com/acme/api-rulesets/2026-03-01/ruleset.yaml
❌ legacy-rules:1.0.0          sources/github.com/acme/legacy/1.0.0/ruleset.yaml  ← NOT FOUND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Summary: 1 error(s). Run `git status sources/` to check missing files.
```

---

## Install tool (`scripts/install.sh`)

The install script runs `npm install` (or `npm ci` if a lockfile exists) in
every `sources/` subdirectory that contains a `package.json`, skipping any
`node_modules/` directories to avoid recursive descent.

```bash
find sources/ -name "package.json" -not -path "*/node_modules/*" |
  while read -r pkg; do
    dir=$(dirname "$pkg")
    echo "Installing: $dir"
    npm install --prefix "$dir"
  done
```

This mirrors the existing `scripts/install-rulesets-dependencies.sh` inside the
orchestrator package.

> Rulesets with no `package.json` (pure YAML rulesets) require no installation
> step and are skipped automatically.

---

## Minimal built-in ruleset

The orchestrator will continue to ship a **minimal built-in ruleset** inside
`packages/orchestrator/rulesets/`. This serves two purposes:

1. A fresh `spectifyd` install works out of the box — no external repo required.
2. It acts as a concrete, tested example of the `rulesets.yaml` format.

The built-in ruleset is a single YAML-only Spectral ruleset (`oas-recommended`,
two versions) with no `package.json`, no npm dependencies, and no compilation
step. It checks core OpenAPI structural rules via `spectral:oas`.

Teams that want more comprehensive linting (Cisco API Insights rules, PubHub
publishing requirements, etc.) point `SPECTIFYD_RULESETS_DIR` at their
external repo.

---

## Wiring external rulesets into spectify

### Development / local install

```bash
# Clone the team's ruleset repo
git clone git@github.com/acme/api-rulesets.git ~/my-rulesets
cd ~/my-rulesets && bash scripts/validate.sh && bash scripts/install.sh

# Point spectifyd at it (persist across restarts via a .env file or shell profile)
export SPECTIFYD_RULESETS_DIR=~/my-rulesets

spectifyd
```

### Docker deployment

Mount the external rulesets directory as a volume into the container:

```yaml
# docker-compose.override.yml
services:
  orchestrator:
    volumes:
      - /path/to/my-rulesets:/data/rulesets:ro
    environment:
      SPECTIFYD_RULESETS_DIR: /data/rulesets
```

The container image itself still contains the minimal built-in rulesets, so
it starts cleanly even without the override.

### One-time CLI flag

```bash
spectifyd --rulesets-directory /path/to/my-rulesets
```

---

## Proposed `absolutePath` extension

Some deployment scenarios cannot easily use the `sources/{domain}/{org}/{repo}/{version}/`
directory layout. For example:

- A ruleset installed via an OS package manager at `/usr/share/acme-rules/`
- A monorepo where the ruleset lives at `../../api-standards/spectral/`
- CI pipelines that check out rulesets into unpredictable locations

To support these cases, a future extension to the `RulesetVersionConfig` schema
will add an optional `absolutePath` field:

```yaml
versions:
  - version: "2026-03-01"
    absolutePath: "/usr/share/acme-rules/ruleset.yaml"
    # sourceRepo / sourceVersion / entrypoint are ignored when absolutePath is set
```

When `absolutePath` is set, the `RulesetLoader` skips the
`sources/{sourceRepo}/{sourceVersion}/{entrypoint}` path construction and loads
the file directly from the given path. This is the escape hatch for
non-standard layouts without changing the normal convention.

> **Status**: `absolutePath` is not yet implemented. It is planned as a future
> small refactor to `types.ts` and `ruleset-loader.ts`.

---

## Cisco-internal rulesets

The four rulesets that were previously bundled in spectify (`pubhub`,
`contract`, `documentation`, `oas`) have been extracted. As of June 2026 they
are no longer part of the orchestrator package.

Teams that relied on these rulesets should set up an external ruleset
repository using the
[spectify-rulesets-template](https://github.com/your-org/spectify-rulesets-template)
as a starting point, then point `SPECTIFYD_RULESETS_DIR` at it.

---

## Implementation checklist

- [x] Create the template repository with the layout above, including both
      `validate.sh` and `install.sh`, and one YAML-only example ruleset
      (`oas-recommended` v1.0.0 and v2.0.0).
- [x] Add a minimal YAML-only built-in ruleset to `packages/orchestrator/rulesets/`
      that works without `npm install` (`oas-recommended`).
- [ ] Document `SPECTIFYD_RULESETS_DIR` in the orchestrator README and the
      Docker architecture guide.
- [x] Implement `absolutePath` in `RulesetVersionConfig` and `RulesetLoader`.
- [x] Migrate Cisco-internal rulesets out of the orchestrator package.
