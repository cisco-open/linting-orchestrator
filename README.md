# Linting Orchestrator for Quality Assurance

> Quality assurance for API specifications — orchestrated linting with
> [Spectral](https://stoplight.io/open-source/spectral) and custom rule engines.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Status: pre-release](https://img.shields.io/badge/status-1.0.0--rc.3-orange.svg)](CHANGELOG.md)

## Quick start

```bash
git clone https://github.com/cisco-open/linting-orchestrator.git
cd linting-orchestrator
npm install && npm run build
npm link --workspace=@cisco-open/linting-orchestrator  # spectify + spectifyd
npm link --workspace=@cisco-open/linting-reports        # spectifyr

spectifyd &                             # start the orchestrator daemon
spectify lint examples/petstore.yaml    # lint a document
```

> **New here?** The [tour](packages/orchestrator/docs/tour.md) walks through the full workflow: daemon, rulesets, results, and the reports UI.

## What's in this repo

| Binary       | Role                                                    |
|--------------|---------------------------------------------------------|
| `spectifyd`  | The orchestrator daemon (HTTP API + worker pool)        |
| `spectify`   | The CLI used to talk to the daemon (or run embedded)    |
| `spectifyr`  | Optional companion: the linting reporting service       |

The orchestrator is designed as three cooperating components:

- **The linting orchestrator service** (`spectifyd`) accepts lint jobs over HTTP,
  dispatches them to a pool of worker threads pre-loaded with rulesets, and
  returns SARIF-formatted results. One worker is kept warm per ruleset; document
  affinity keeps recently-linted documents in worker memory.
- **The orchestrator CLI** (`spectify`) is the everyday user-facing tool. It can
  embed the daemon for one-shot use, talk to a long-running daemon, or be
  driven from CI.
- **The linting reporting service** (`spectifyr`, separate package
  [`@cisco-open/linting-reports`](packages/reports/))
  persists job results into SQLite and exposes a small web UI for browsing
  them across runs.

## How it fits together

```
┌──────────┐     ┌──────────────┐     ┌─────────┐     ┌──────────┐
│ spectify │───▶│  spectifyd   │────▶│ workers │     │spectifyr │
│  (CLI)   │     │  (daemon)    │     │ (Spec-  │───▶│ (reports │
└──────────┘     │  HTTP API    │     │  tral)  │     │  + DB)   │
                 └──────────────┘     └─────────┘     └──────────┘
                       │                                  ▲
                       ▼                                  │
                ┌──────────────┐                          │
                │  document    │                          │
                │   store      │◀─────────────────────────┘
                │ (filesystem) │
                └──────────────┘
```

The orchestrator never copies document content between processes; workers
read by path. The reports service is optional and can be added at any time
without touching ruleset configuration.

## Deployment modes

Three modes are supported — embedded (in-process, ideal for one-shot/CI use),
standalone (long-running service), and companion (co-located with an MCP
uploader). In every mode the command is the same (`spectify lint`); what
differs is where the daemon lives. See
[deployment modes](packages/orchestrator/docs/deployment-modes.md) for details.

## Rulesets

The orchestrator ships with Spectral-based rulesets out of the box and can
load additional rulesets from the filesystem. See
[packages/orchestrator/docs/ruleset-management.md](packages/orchestrator/docs/ruleset-management.md) for adding,
versioning, and configuring rulesets.

```bash
# list installed rulesets
spectify rulesets              

# list rules for a particular ruleset
spectify rulesets --name contract --verbose
```

## Configuration

The daemon is configured via [`config/default.yaml`](config/default.yaml) with
environment-variable overrides. 

Daemon-side variables use the `SPECTIFYD_`prefix; 
client-side connection config for the reporting service uses `SPECTIFYD_REPORTS_`. 

The reporting service itself reads `SPECTIFYR_*` in its own repo.

| Variable                              | Purpose                                            |
|---------------------------------------|----------------------------------------------------|
| `SPECTIFYD_PORT`                      | HTTP API port (default `3003`)                     |
| `SPECTIFYD_DOCUMENT_STORE_TYPE`       | `local` or `passthrough`                           |
| `SPECTIFYD_DOCUMENT_STORE_DIR`        | Document directory                                 |
| `SPECTIFYD_TOTAL_MAX_WORKERS`         | Cap on total worker threads                        |
| `SPECTIFYD_LOG_LEVEL`                 | `error` \| `warn` \| `info` \| `debug` \| `trace`  |
| `SPECTIFYD_REPORTS_ENABLED`           | Forward results to the reporting service           |
| `SPECTIFYD_REPORTS_URL`               | Reporting service URL                              |

See [packages/orchestrator/docs/installation.md](packages/orchestrator/docs/installation.md) for the
complete list and recommended values per deployment mode.

## Testing

```bash
npm test                       # unit + non-network integration suites
npm run test:unit
npm run test:integration       # deployment modes + loader/accessor
npm run test:mcp               # requires a running MCP-style uploader
```

## Documentation

User guides:

- **[Tour](packages/orchestrator/docs/tour.md)** — 5-minute walkthrough from clone to lint report
- [Installation](packages/orchestrator/docs/installation.md) — global install, npm link, or from source
- [CLI quick start](packages/orchestrator/docs/quick-start-cli.md)
- [HTTP API quick start](packages/orchestrator/docs/quick-start-api.md)
- [Deployment modes](packages/orchestrator/docs/deployment-modes.md) — embedded, standalone, companion
- [Ruleset management](packages/orchestrator/docs/ruleset-management.md)
- [MCP integration](packages/orchestrator/docs/internal/integrations/spectify-mcp.md)
- [Pluggable document store](packages/orchestrator/docs/internal/pluggable-document-store.md)
- [Versioning strategy](packages/orchestrator/docs/internal/versioning-strategy.md)

Design & internals:

- [Lint orchestrator design](packages/orchestrator/docs/internal/design/lint-orchestrator-design.md)
- [Architecture decisions](packages/orchestrator/docs/internal/design/architecture-decisions.md)
- [All design docs](packages/orchestrator/docs/internal/design/)

Contributing:

- [`CONTRIBUTING.md`](CONTRIBUTING.md)
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- [`SECURITY.md`](SECURITY.md)
- [`AGENTS.md`](AGENTS.md) — guidance for AI coding agents working on the repo

## Repository layout

This repo is an npm-workspaces monorepo. The three packages live under
`packages/`:

| Path                          | Package name                                | Role |
| ----------------------------- | ------------------------------------------- | ---- |
| `packages/orchestrator/`      | `@cisco-open/linting-orchestrator`  | The orchestrator daemon (`spectifyd`) and CLI (`spectify`). |
| `packages/reports/`           | `@cisco-open/linting-reports`       | The linting reporting service (`spectifyr`). |
| `packages/document-store/`    | `@cisco-open/linting-document-store`        | Pluggable document-storage library. |

Shared assets stay at the repo root: `rulesets/`, `scripts/`,
`examples/`, `docs/`, plus the LICENSE and community files.

Common workflow:

```bash
npm install                                          # links workspaces
npm run build                                        # builds all three, in order
npm test                                             # runs every package's tests
npm run dev                                          # tsx watch on the orchestrator
```

## Open-source rollout

This repo is in active open-source transition. See
[docs/maintainers/opensourcing.md](docs/maintainers/opensourcing.md) for the
plan, naming convention, and rollout sequence.

## License

Apache-2.0 — see [LICENSE](LICENSE).
