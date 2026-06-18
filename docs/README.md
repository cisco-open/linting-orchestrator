# Documentation

Workspace-level documentation for this monorepo. Most user-facing
documentation lives in the per-package `docs/` trees rather than here.

## User documentation

User documentation is per-package, since each package serves a
different audience:

- **[packages/orchestrator/docs/](../packages/orchestrator/docs/)** —
  the `spectify` CLI and the `spectifyd` HTTP API server. Start here
  if you want to lint OpenAPI documents.
- **[packages/reports/docs/](../packages/reports/docs/)** — the
  `spectifyr` reporting service and its TypeScript client library.
- **[packages/document-store/docs/](../packages/document-store/docs/)**
  — the pluggable OpenAPI document storage library.

## Maintainer documentation

- **[maintainers/](maintainers/)** — workspace-wide maintainer
  material (open-source rollout plan, release process, conventions).
- Per-package maintainer material — design docs, internal architecture,
  configuration design — lives next to the code it describes, under
  each package's `docs/internal/` directory.

## See also

- Repo entry point: [README.md](../README.md)
- Coding-agent guidance: [AGENTS.md](../AGENTS.md)
- Per-package agent guidance: each package has its own `AGENTS.md`.
