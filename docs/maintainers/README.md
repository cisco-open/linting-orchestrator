# Maintainer documentation

Workspace-wide material aimed at people maintaining or contributing to
this monorepo (not at end users of the published packages).

Per-package maintainer docs (package-specific design, internal
architecture, configuration rationale) live next to the code they
describe, under each package's `docs/internal/` directory:

- [packages/orchestrator/docs/internal/](../../packages/orchestrator/docs/internal/)
- [packages/reports/docs/internal/](../../packages/reports/docs/internal/)
- [packages/document-store/docs/internal/](../../packages/document-store/docs/internal/)

## What's here

- **[opensourcing.md](opensourcing.md)** — the plan for moving these
  packages to their open-source identity (`@cisco_open/linting-*`).
- **[ruleset-externalization.md](ruleset-externalization.md)** — the
  architecture and schema for shipping rulesets outside the
  orchestrator package.
- **[ruleset-curation-for-pms.md](ruleset-curation-for-pms.md)** —
  recommendations for product managers who own one or more rulesets:
  how to maintain individual ruleset repos, how to curate a catalogue
  for `spectifyd`, and how to apply this to the Cisco internal
  catalogue.
- **[managing-spectral-embedded-rulesets.md](managing-spectral-embedded-rulesets.md)**
  — how to operate `origin: embedded` catalogue entries (Spectral's
  built-in `spectral:oas` / `:asyncapi` / `:arazzo`): how to find the
  effective version, review cadence, when to switch to `external`, and
  a proposal for a `spectral-rulesets-mirror` catalogue (itself
  built from the template) to make
  per-patch evaluation cheap.

## What could go here next

A few documents would be worth writing as the project matures:

- A workspace conventions guide distilled from
  [AGENTS.md](../../AGENTS.md): build order, test conventions, the
  `tests/helpers/repo-paths.ts` pattern, where to put new package
  dependencies.
- A release process guide: how to cut a new RC, update changelogs,
  publish each package to npm, and tag the workspace.
- A high-level architecture overview: how the three packages
  interact at runtime, expanding the dependency diagram in
  `AGENTS.md` into something a new contributor can read in five
  minutes.
