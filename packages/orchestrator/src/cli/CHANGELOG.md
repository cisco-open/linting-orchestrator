# Orchestrator CLI changelog

All notable changes to the `spectify` CLI binary are documented in this file.
CLI and daemon ship together; release notes live in the package
[`CHANGELOG.md`](../../CHANGELOG.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0-rc.4] - 2026-06-18

**Initial open-source release.**

First public release of the `spectify` CLI under the Apache-2.0 license.

### Features

- `spectify lint` — submit one or more documents against one or more rulesets.
- `spectify jobs` / `spectify history` — browse past lint jobs.
- `spectify reproduce` — re-run a stored lint job.
- `spectify rulesets` — list and inspect configured rulesets.
- `spectify config` — manage local client configuration.
- `spectify health` — query running daemon status.
- `--format` flag: `text`, `json`, `sarif`.
- `--poll-interval` flag for multi-ruleset progress display.
- Bash completion for all commands, flags, and dynamic values.
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

