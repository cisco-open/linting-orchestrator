# Changelog

All notable changes to `@cisco_open/linting-reports` are documented in this file.
For **Client Library** changes, see [src/client/CHANGELOG.md](src/client/CHANGELOG.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0-rc.5] - 2026-06-30

### Changed

- Documentation updated to the published npm scope `@cisco_open`.

---

## [1.0.0-rc.4] - 2026-06-18

**Initial open-source release.**

First public release of `@cisco_open/linting-reports` under the Apache-2.0 license.

### Features

- `spectifyr` binary for standalone report server deployment.
- SQLite-backed persistent storage for lint job results.
- Browsable web UI for exploring lint reports.
- REST API for querying jobs, results, and documents.
- TypeScript client library (`@cisco_open/linting-reports/client`).
