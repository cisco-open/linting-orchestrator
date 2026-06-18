# Tour of the linting orchestrator

> From `git clone` to reading a lint report in five minutes.

This guide walks through the complete workflow end-to-end:

**install → launch daemon → list rulesets → lint a document → read results in the terminal → browse the reports UI**

---

## Prerequisites

- **Node.js 18+** — verify with `node --version`
- **Git**

---

## Step 1 — Bootstrap

Clone the repo and build all packages. This is the pre-registry path;
once packages are published to npm, the clone step won't be needed.

```bash
git clone https://github.com/cisco-open/linting-orchestrator.git
cd spectify

npm install        # installs all workspace packages and links them together
npm run build      # builds: document-store → reports → orchestrator
```

Install all three binaries globally via `npm link`.
`npm link` creates global symlinks into the already-built workspace packages, so
it never needs to resolve the sibling packages from the npm registry
(they aren't published yet):

```bash
# Orchestrator: spectify (CLI) + spectifyd (daemon)
npm link --workspace=@cisco-open/linting-orchestrator

# Reports service: spectifyr
npm link --workspace=@cisco-open/linting-reports

# Verify
spectify --version
spectifyd --version
spectifyr --version
```

> After any `npm run build`, the linked binaries pick up your changes
> automatically — no re-link needed.

---

## Step 2 — Start the daemon

The CLI defaults to standalone mode and expects the orchestrator daemon to be
running. Start it in a dedicated terminal and leave it running:

```bash
# Terminal 1 — leave this running
spectifyd
# Listening on http://localhost:3003
```

Confirm it's ready:

```bash
spectify health
# ✅ ok
```

---

## Step 3 — Lint a document

With the daemon running, submit a lint job from another terminal:

```bash
spectify lint examples/petstore.yaml
```

Sample output:

```
📄 Analyzing: examples/petstore.yaml
🔍 Running rulesets: pubhub, contract, documentation, oas
✅ Analysis complete!

Summary:
  🚨 Errors:    2
  ⚠️  Warnings: 8
  ℹ️  Info:     3
```

> **One-shot mode (no daemon):** If you prefer a self-contained single run,
> switch to embedded mode first:
> ```bash
> spectify config set mode embedded
> spectify lint examples/petstore.yaml   # daemon starts and stops automatically
> ```

In another terminal, confirm it's ready:

```bash
spectify health
# ✅ Spectify is healthy
```

---

## Step 4 — List pre-installed rulesets

```bash
spectify rulesets
```

```
┌───────────────┬─────────┬────────────────────────────────────────────┐
│ Name          │ Version │ Description                                │
├───────────────┼─────────┼────────────────────────────────────────────┤
│ pubhub        │ 1.1.0   │ PubHub publishing readiness                │
│ contract      │ …       │ Contract completeness & documentation      │
│ documentation │ …       │ Documentation quality standards            │
│ oas           │ …       │ OpenAPI Specification compliance           │
└───────────────┴─────────┴────────────────────────────────────────────┘
```

See [ruleset-management.md](ruleset-management.md) for adding custom rulesets.

---

## Step 5 — Lint and read results

```bash
# Lint with all rulesets (recommended first run)
spectify lint examples/petstore.yaml

# Lint with a specific ruleset
spectify lint examples/petstore.yaml --ruleset pubhub

# Lint your own document
spectify lint path/to/your-api.yaml
```

The command prints the **job ID**. Fetch full results in the terminal:

```bash
spectify results <jobId>

# Or as JSON (useful in CI)
spectify results <jobId> --format json
```

Check job status if the lint is still running:

```bash
spectify status <jobId>
```

Browse recent documents and jobs:

```bash
spectify history
```

---

## Step 6 — Persistent reports with spectifyr (optional)

`spectifyr` persists every lint result into a local SQLite database and
exposes a web UI to browse results across runs and share findings.
It is fully optional — `spectify`/`spectifyd` work without it.

### Wire spectifyd to spectifyr

Create a `.env` file in the directory where you run `spectifyd`:

```ini
SPECTIFYD_REPORTS_ENABLED=true
SPECTIFYD_REPORTS_URL=http://localhost:3010
```

### Start both services

```bash
# Terminal 1
spectifyd          # orchestrator on :3003

# Terminal 2
spectifyr          # reports service + web UI on :3010
```

### Lint something

```bash
spectify lint examples/petstore.yaml
```

### Open the reports UI

Navigate to **http://localhost:3010** in your browser.
You'll see the lint job, a breakdown of findings by rule, and the full
issue list with file locations.

---

## What's next

| Goal | Where to go |
|------|-------------|
| Understand embedded vs. standalone vs. companion modes | [deployment-modes.md](deployment-modes.md) |
| Run as an HTTP API server | [quick-start-api.md](quick-start-api.md) |
| Add or configure rulesets | [ruleset-management.md](ruleset-management.md) |
| Integrate with CI/CD | Use embedded mode — `spectify lint` needs no running daemon |
| Full installation reference | [installation.md](installation.md) |
| Configuration environment variables | [installation.md](installation.md#configuration) |
