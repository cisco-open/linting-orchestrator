# Linting orchestrator — changelog

All notable changes to `@cisco_open/linting-orchestrator` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0-rc.5] - 2026-06-30

### Changed

- Corrected cross-package imports and documentation to the published npm
  scope `@cisco_open`.
- Install docs default to npm-registry installation; the source build is
  framed as the maintainer path.

### Fixed

- Stabilized the ruleset-loader cache timing test that could fail on
  faster runtimes (Node 24).

---

## [1.0.0-rc.4] - 2026-06-18

**Initial open-source release.**

First public release of `@cisco_open/linting-orchestrator` under the Apache-2.0 license.

> **npm scope:** the package is published to npmjs.com under the scope
> `@cisco_open` (underscore). Note this differs from the GitHub org
> `github.com/cisco-open/...` (hyphen) — use the underscore form for all
> npm commands and `package.json` references.

### Features

- HTTP API daemon (`spectifyd`) for orchestrating Spectral and custom rule engines.
- Worker pool with per-ruleset isolation and document affinity.
- Externalized rulesets architecture (`rulesets/config/rulesets.yaml` + `rulesets/sources/`).
- `origin: embedded` support for Spectral's built-in rulesets.
- `SPECTIFY_HOME` environment variable for shared runtime data directory.
- `spectify lint` CLI client with multi-ruleset progress display and `--poll-interval` flag.
- Bash completion for all commands and flags.
- SARIF, JSON, and text output formats.
- `spectify reproduce` for reproducing lint jobs from stored reports.

## Version Components

The package ships two independently versioned components:
- **Daemon** (this file): Orchestrator service, HTTP API, worker pool — **Current: v1.0.0-rc.5**
- **CLI** ([src/cli/CHANGELOG.md](src/cli/CHANGELOG.md)): Command-line interface — **Current: v1.0.0-rc.5**

**Package version format:** `{daemon}-cli{cli}` (always) — e.g., `1.0.0-rc.1-cli1.0.0-rc.1`. Uses a semver prerelease identifier to couple both component versions for clarity.

View versions:
- CLI version: `spectify --version`
- Daemon version: `spectify health` (queries running daemon)

