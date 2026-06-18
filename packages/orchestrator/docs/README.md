# Orchestrator documentation

User-facing documentation for the orchestrator package — the `spectify`
CLI and the `spectifyd` HTTP API server.

## Get started

- **[Tour](tour.md)** — 5-minute walkthrough from clone to lint report. Start here.
- **[Installation](installation.md)** — install the orchestrator
  (global npm install, workspace link, or from source).
- **[CLI quick start](quick-start-cli.md)** — lint a document with
  `spectify` in a few commands.
- **[API server quick start](quick-start-api.md)** — run `spectifyd`
  and submit lint jobs over HTTP.

## Reference

- **[Deployment modes](deployment-modes.md)** — how to run the
  orchestrator standalone, as a server, or alongside other services;
  port assignments and configuration.
- **[Ruleset management](ruleset-management.md)** — how rulesets are
  organised, how to add a new ruleset, and how to select which
  ruleset(s) to run against a document.

## Maintainer documentation

Design rationale, internal architecture, integration contracts, and
the package's versioning strategy live under
**[internal/](internal/)**. That material is intended for people
maintaining or extending the package rather than for end users.

## See also

- Workspace docs: [docs/](../../../docs/)
- Workspace agent guidance: [AGENTS.md](../../../AGENTS.md)
- Package agent guidance: [packages/orchestrator/AGENTS.md](../AGENTS.md)
