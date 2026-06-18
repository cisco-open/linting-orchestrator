# Orchestrator — maintainer documentation

Material intended for people maintaining or extending the orchestrator
package, rather than for end users of `spectify` / `spectifyd`.

## What's here

- **[versioning-strategy.md](versioning-strategy.md)** — how the CLI
  and the server are versioned.
- **[pluggable-document-store.md](pluggable-document-store.md)** —
  design for the document-store extension point that the orchestrator
  exposes.
- **[integrations/](integrations/)** — integration contracts and
  architecture for systems the orchestrator is designed to work with:
  - `mcp-analyzer.md` — the integration contract with the MCP OpenAPI
    Analyzer (document store + analysis).
  - `spectify-mcp.md` — overall integration architecture between the
    orchestrator and the MCP analyzer.
- **[design/](design/)** — design documents and architectural
  rationale; see that directory's [README](design/README.md) for the
  per-document map.

## Why "internal"?

Material in this directory may be:

- detailed enough that it would distract a user from the user docs;
- only meaningful in the context of contributing to the orchestrator;
- aspirational or transitional (planned features, in-flight rewrites);
- focused on rationale for choices that the user-facing docs simply
  state as fact.

