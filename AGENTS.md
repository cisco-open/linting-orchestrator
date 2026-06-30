# AGENTS.md

Instructions for AI coding agents (and the humans they help) working in this
repository.

This is the **workspace-level** guide. Each package under `packages/*` also
has its own `AGENTS.md` with package-specific guidance. Read both — this one
first, the package one second once you know which package you're touching.

---

## What this repository is

This repo is the **linting orchestrator monorepo**. It hosts three
related TypeScript packages that ship together and depend on each other:

| Path                          | Package                                       | Purpose | Binaries |
| ----------------------------- | --------------------------------------------- | ------- | -------- |
| `packages/orchestrator/`      | `@cisco_open/linting-orchestrator`            | Orchestrates Spectral + custom rule engines: HTTP API, worker pool, ruleset loader, CLI. | `spectify`, `spectifyd` |
| `packages/reports/`           | `@cisco_open/linting-reports`                 | Reporting service: SQLite-backed report store, HTTP API for browsing/serving lint reports, plus a TypeScript client library that the orchestrator uses to deliver job-completion notifications. | `spectifyr` |
| `packages/document-store/`    | `@cisco_open/linting-document-store`          | Pluggable document storage library. Shared by the orchestrator and (separately) by the MCP analysis server. | — (library) |

The three packages were merged into this monorepo when the project moved to
its open-source identity. Prior to the merge they lived in three separate
repos and were wired together via git submodules + `file:` deps. The
historical design and integration docs (under `packages/orchestrator/docs/`)
were written before the merge and may still describe that layout — treat
those references as historical context, not current instructions.

## How the packages depend on each other

```
@cisco_open/linting-document-store     (no internal deps)
            ▲
            │
@cisco_open/linting-reports            (uses document-store types)
            ▲
            │
@cisco_open/linting-orchestrator
   ├── @cisco_open/linting-document-store
   └── @cisco_open/linting-reports           (subpath import: "/client")
```

Cross-package dependencies are declared with the workspace `"*"` specifier
and resolved by npm workspaces (root `package.json` declares
`"workspaces": ["packages/*"]`). This means a fresh `npm install` at the
repo root symlinks `packages/*` into each other's `node_modules/`.

The orchestrator imports the reports **client library** via the package
subpath `@cisco_open/linting-reports/client`. That subpath is
declared under `"exports"` in the reports package, and the orchestrator's
`tsconfig.json` uses `"module": "NodeNext"` + `"moduleResolution": "NodeNext"`
so TypeScript honours the `exports` map. Do not change those tsconfig
settings without re-verifying that the cross-package import still resolves.

## Build order matters

`npm run build` at the root explicitly chains the workspace builds in the
correct topological order:

1. `@cisco_open/linting-document-store`
2. `@cisco_open/linting-reports`
3. `@cisco_open/linting-orchestrator`

Do not replace this with `npm run build --workspaces` (which iterates
alphabetically and would attempt to build the orchestrator before its
dependencies are compiled). If you add a new workspace, extend the chain.

## Common workflows

```bash
# One-time setup after clone (or after pulling cross-package changes)
npm install                          # links packages/* together
npm run build                        # builds all three in topological order

# Day-to-day
npm test                             # runs every package's tests
npm run lint                         # type-checks every package
npm run dev                          # tsx watch on the orchestrator

# Working in one package only
npm run build --workspace=@cisco_open/linting-reports
npm test  --workspace=@cisco_open/linting-orchestrator

# Installing the orchestrator binaries globally for local testing
npm install -g ./packages/orchestrator
# …or, for active development (symlinked)
npm link --workspace=@cisco_open/linting-orchestrator
```

All three packages use **vitest** for testing. Their `"test"` script must
invoke `vitest run` (not bare `vitest`, which sits in watch mode and would
hang `npm test --workspaces`). If you add a new package, follow the same
convention.

## Orchestrator-specific assets that live inside the package

These directories are **inside** `packages/orchestrator/` and ship with the
package on `npm install -g`:

- `packages/orchestrator/rulesets/` — Spectral + custom rulesets, both the
  `config/rulesets.yaml` registry and the `sources/` tree of vendored rule
  files. `src/config.ts` resolves the rulesets directory relative to the
  built `build/config.js`, so a globally installed `spectifyd` must find
  rulesets next to its `build/` output. That is why these files live
  inside the orchestrator package and not at the repo root.
- `packages/orchestrator/scripts/` — Bash automation for adding and
  installing rulesets. Exposed through `npm run add-ruleset`,
  `npm run install-rulesets`, `npm run check-rulesets`, and
  `npm run generate-openapi`. The root `package.json` forwards each of
  these to the orchestrator workspace, so you can run them from anywhere
  in the repo.
- `packages/orchestrator/docs/` — User docs, design docs, and historical
  build-phase docs.

The other packages keep their own `docs/`, `tests/`, `src/` trees inside
their own package directories.

## When you add or change a ruleset

Use the workflow already documented in
[packages/orchestrator/.github/copilot-instructions.md](packages/orchestrator/.github/copilot-instructions.md)
(if present) or call the helper directly:

```bash
npm run add-ruleset   # interactive wizard
```

The wizard clones a remote ruleset repo into
`packages/orchestrator/rulesets/sources/{domain}/{org}/{repo}/{version}/`,
runs `npm install` inside it if there's a `package.json`, and then guides
you through registering it in
`packages/orchestrator/rulesets/config/rulesets.yaml`. After adding a
ruleset, verify with `npm run check-rulesets`.

## Tests, paths, and `process.cwd()`

A failure pattern that has bitten this repo before: tests that use
`process.cwd()` to locate `rulesets/config/rulesets.yaml` break the moment
you invoke them from a different directory (root vs. workspace vs. an
editor test runner). Always resolve repo-relative paths from a known
anchor.

Use the helper at
[`packages/orchestrator/tests/helpers/repo-paths.ts`](packages/orchestrator/tests/helpers/repo-paths.ts):

```ts
import { RULESETS_CONFIG, RULESETS_SOURCES } from '../helpers/repo-paths.js';
```

It computes paths from `import.meta.url`, so it works regardless of cwd.

## Versioning and branches

- Packages currently share the version `1.0.0-rc.1` and are licensed under
  Apache-2.0 (each package has its own `LICENSE` + `NOTICE`).
- The active rename work happens on the `rename/opensource` branch (per-repo
  identity rename, cisco-open URLs) and the `workspace-reorg` branch
  (npm-workspaces monorepo conversion). See
  [docs/maintainers/opensourcing.md](docs/maintainers/opensourcing.md) for the
  open-source rollout plan and current status.
- Each package has its own `CHANGELOG.md`. There is intentionally no
  workspace-root `CHANGELOG.md`.

## Things to avoid

- **Do not** re-introduce git submodules or `file:` dependencies for the
  three internal packages. They are workspace dependencies now.
- **Do not** add a `preinstall` hook that touches submodules. The previous
  `scripts/check-submodules.sh` has been removed.
- **Do not** edit `packages/*/build/` — those directories are gitignored
  build outputs.
- **Do not** edit anything under `packages/orchestrator/docs/materials/`
  except by re-cloning. Those are vendored copies of other repos' docs and
  are gitignored.
- **Do not** assume tests run from any particular cwd. Always anchor paths
  via `import.meta.url` or the `repo-paths.ts` helper.
- **Do not** rename the `ReportServiceClient` / `ReportServiceConfig`
  TypeScript identifiers without coordinating with downstream consumers —
  they are part of the published client library's public surface.

## Where to look next

- Repo overview and user-facing docs: [README.md](README.md)
- Workspace documentation index: [docs/](docs/)
- Open-source rollout plan:
  [docs/maintainers/opensourcing.md](docs/maintainers/opensourcing.md)
- Per-package guidance:
  [packages/orchestrator/AGENTS.md](packages/orchestrator/AGENTS.md),
  [packages/reports/AGENTS.md](packages/reports/AGENTS.md),
  [packages/document-store/AGENTS.md](packages/document-store/AGENTS.md)
- Per-package READMEs:
  [reports](packages/reports/README.md),
  [document-store](packages/document-store/README.md)
  (the orchestrator package does not have its own README yet; see the
  top-level [README.md](README.md) for now)
