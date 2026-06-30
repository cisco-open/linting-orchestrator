# Reports documentation

User-facing documentation for the `@cisco_open/linting-reports`
package — the `spectifyr` reporting service and its TypeScript client
library.

## What's here

- **[client-integration.md](client-integration.md)** — how to use the
  `ReportServiceClient` library to deliver job-completion
  notifications from a producer (for example, the orchestrator) to a
  `spectifyr` instance.

## Maintainer documentation

Design, internal architecture, configuration rationale, and the
package's versioning strategy live under **[internal/](internal/)**.

## What's missing

A short "quick start" for running `spectifyr` as a standalone server
and an end-user configuration reference would round this out; both
are tracked as docs-debt and not yet written.

## See also

- Package README: [packages/reports/README.md](../README.md)
- Workspace docs: [docs/](../../../docs/)
