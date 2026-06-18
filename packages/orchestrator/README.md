# @cisco-open/linting-orchestrator

Quality assurance for API specifications. An orchestrator daemon (`spectifyd`) and CLI (`spectify`) that run [Spectral](https://stoplight.io/open-source/spectral) and custom rule engines at scale, with worker-per-ruleset architecture, document caching, and pluggable storage.

## Installation

```bash
npm install -g @cisco-open/linting-orchestrator
```

## Quick Start

```bash
# Lint a document (standalone CLI — no server required)
spectify lint petstore.yaml

# Start the daemon
spectifyd

# Lint via the running daemon
spectify lint petstore.yaml --server http://localhost:3003
```

## Documentation

- [Installation Guide](docs/installation.md)
- [CLI Quick Start](docs/quick-start-cli.md)
- [API Quick Start](docs/quick-start-api.md)
- [Deployment Modes](docs/deployment-modes.md)
- [Ruleset Management](docs/ruleset-management.md)

## Companion Packages

This package is part of the [spectify](https://github.com/cisco-open/linting-orchestrator) monorepo:

| Package | Description |
|---------|-------------|
| `@cisco-open/linting-reports` | Report storage service (`spectifyr`) |
| `@cisco-open/linting-document-store` | Pluggable document storage library |

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
