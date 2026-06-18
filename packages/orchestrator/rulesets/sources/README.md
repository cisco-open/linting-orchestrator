# Ruleset Source Files

This directory contains the source files for the orchestrator's **built-in minimal
rulesets**. It is intentionally small — only the `oas-recommended` example
ruleset lives here.

## Purpose

- Provide a working out-of-the-box ruleset that requires no npm dependencies.
- Serve as a concrete, tested example of the `rulesets.yaml` format and the
  `sources/{sourceRepo}/{sourceVersion}/{entrypoint}` layout.

## Directory Structure

```
sources/
└── example/
    └── oas-recommended/
        ├── v1.0.0/
        │   └── ruleset.yaml    # Extends spectral:oas recommended
        └── v2.0.0/
            └── ruleset.yaml    # Adds operationId, tags, contact-email rules
```

## Current Sources

### example/oas-recommended

| Version | Release    | Description                                       |
|---------|------------|---------------------------------------------------|
| v1.0.0  | 2026-06-01 | Extends `spectral:oas` recommended profile        |
| v2.0.0  | 2026-06-01 | Adds `operation-operationId`, `operation-tags`, `info-contact-email` |

No `package.json`. No npm dependencies. Pure YAML.

## Adding Team-Specific Rulesets

The built-in rulesets are deliberately minimal. For team-specific ruleset
catalogues, use an **external rulesets directory** instead of adding sources
here.

See `docs/maintainers/ruleset-externalization.md` for the full architecture,
and the `spectify-rulesets-template` repository for a starter kit.

```bash
# Point Spectify at your own ruleset repo
export SPECTIFYD_RULESETS_DIR=/path/to/my-rulesets
