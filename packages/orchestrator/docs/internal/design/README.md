# Orchestrator — design documents

Architectural design documents, technical specifications, and design
rationale for the orchestrator package. Audience: contributors and
maintainers.

## Core architecture

- **[lint-orchestrator-design.md](lint-orchestrator-design.md)** —
  the comprehensive design specification for the orchestration engine
  (jobs, workers, ruleset loader, HTTP API).
- **[architecture-decisions.md](architecture-decisions.md)** — key
  architectural choices and trade-offs, ADR-style.
- **[cli-server-deployment-architecture.md](cli-server-deployment-architecture.md)**
  — design for how the CLI and the server fit together at deployment
  time.

## Subsystems

- **[concurrency.md](concurrency.md)** — concurrency, queueing, and
  backpressure analysis.
- **[error-handling-and-status-tracking.md](error-handling-and-status-tracking.md)**
  — how jobs report errors and how status is tracked end-to-end.
- **[runtime-session-id.md](runtime-session-id.md)** — pragmatic
  per-process session identification.
- **[rule-documentation-design.md](rule-documentation-design.md)** —
  the design for how rule documentation is surfaced.
- **[linting-results-scalability-analysis.md](linting-results-scalability-analysis.md)**
  — pagination, filtering, and limits for large lint result sets.

## Output formats and reporting

- **[cli-report-generation.md](cli-report-generation.md)** — how the
  CLI generates lint reports.
- **[sarif-considerations.md](sarif-considerations.md)** — notes on
  SARIF as an output format.
- **[spectral-native.md](spectral-native.md)** — design for reproducing
  Spectral's native behavior.

## Features

- **[exclude-rules.md](exclude-rules.md)** — design for rule
  exclusion and severity overrides.
- **[job-and-document-listing.md](job-and-document-listing.md)** —
  design for the job- and document-listing APIs.

