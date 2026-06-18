# Changelog

All notable changes to the **Linting Orchestrator** project are documented here.

This is the **umbrella changelog** for the monorepo. It covers cross-cutting
milestones and breaking changes that affect the project as a whole. For
detailed per-package history, see:

| Package | Changelog |
|---------|-----------|
| **Orchestrator** (`spectifyd`, `spectify`) | [packages/orchestrator/CHANGELOG.md](packages/orchestrator/CHANGELOG.md) |
| **Orchestrator CLI** | [packages/orchestrator/src/cli/CHANGELOG.md](packages/orchestrator/src/cli/CHANGELOG.md) |
| **Reports** (`spectifyr`) | [packages/reports/CHANGELOG.md](packages/reports/CHANGELOG.md) |
| **Reports Client** | [packages/reports/src/client/CHANGELOG.md](packages/reports/src/client/CHANGELOG.md) |
| **Document Store** | [packages/document-store/CHANGELOG.md](packages/document-store/CHANGELOG.md) |

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0-rc.4] - 2026-06-18

**Initial open-source release.**

This is the first public release of the linting orchestrator suite under
the Apache-2.0 license.

### Packages

| Package | Version |
|---------|---------|
| `@cisco-open/linting-orchestrator` | `1.0.0-rc.4` |
| `@cisco-open/linting-reports` | `1.0.0-rc.4` |
| `@cisco-open/linting-document-store` | `1.0.0-rc.4` |

### Highlights

- Orchestrates [Spectral](https://github.com/stoplightio/spectral) and custom rule engines via an HTTP API and worker pool.
- Supports OpenAPI, AsyncAPI, Arazzo, and any Spectral-compatible format.
- Externalized rulesets architecture (`rulesets/config/rulesets.yaml` + `rulesets/sources/`).
- SQLite-backed lint report store with browsable web UI (`spectifyr`).
- Pluggable document store with Local, PassThrough, and MCP adapters.
- CLI binaries: `spectify` (client), `spectifyd` (daemon), `spectifyr` (reports server).

See the individual package changelogs for full details:
- [packages/orchestrator/CHANGELOG.md](packages/orchestrator/CHANGELOG.md)
- [packages/reports/CHANGELOG.md](packages/reports/CHANGELOG.md)
- [packages/document-store/CHANGELOG.md](packages/document-store/CHANGELOG.md)
