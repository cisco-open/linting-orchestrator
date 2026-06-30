# Installation guide

Comprehensive guide for installing and upgrading the orchestrator in different scenarios.

---

## Overview

The orchestrator provides **three global binaries** when fully installed:

- **`spectify`** — CLI for linting OpenAPI documents (embeds its own daemon for one-shot use)
- **`spectifyd`** — Long-running orchestrator daemon (HTTP API + worker pool)
- **`spectifyr`** — Optional reporting service (persistent SQLite + web UI at `:3010`)

`spectify` and `spectifyd` are in the same package (`@cisco_open/linting-orchestrator`).  
`spectifyr` is a separate package (`@cisco_open/linting-reports`) and must be installed separately.

---

## Installation Methods

There are **two installation methods**:

| Method | Status | Use Case |
|--------|--------|----------|
| **npm registry** | ✅ Available | End users — recommended |
| **npm link (from source)** | ✅ Available | Maintainers and contributors |

---

## Method 1: npm Registry (Recommended)

**Best for:** End users

```bash
# Install the orchestrator (CLI + daemon)
npm install -g @cisco_open/linting-orchestrator

# Optional: install the reporting service
npm install -g @cisco_open/linting-reports

# Verify
spectify --version
spectifyd --version
spectifyr --version

# Upgrade
npm update -g @cisco_open/linting-orchestrator

# Uninstall
npm uninstall -g @cisco_open/linting-orchestrator
```

**Advantages:**
- ✅ Simplest installation
- ✅ No git clone needed
- ✅ Version management via npm

---

## Method 2: From Source — npm link (Maintainers / Contributors)

**Best for:** Active development on the orchestrator itself

`npm link` creates global symlinks pointing into the workspace packages.
Because the symlinks resolve deps through the workspace's own `node_modules`,
npm never needs to fetch the sibling packages from the registry.

### Initial Setup

```bash
# 1. Clone the repository
git clone https://github.com/cisco-open/linting-orchestrator.git
cd linting-orchestrator

# 2. Install workspace dependencies (links all packages/* together)
npm install

# 3. Build every package (document-store -> reports -> orchestrator)
npm run build

# 4. Create global symlinks for all three binaries
npm link --workspace=@cisco_open/linting-orchestrator  # spectify + spectifyd
npm link --workspace=@cisco_open/linting-reports        # spectifyr

# 5. Verify
spectify --version && spectifyd --version && spectifyr --version
which spectify && which spectifyd && which spectifyr
```

### Development Workflow

```bash
# 1. Make code changes in src/

# 2. Rebuild (symlinks pick up the new build automatically)
npm run build

# 3. Test immediately (no re-link needed)
spectify lint examples/petstore.yaml

# 4. Run tests
npm test
```

### Upgrading

```bash
# 1. Pull latest changes
git pull origin main

# 2. Reinstall workspace deps and rebuild
npm install && npm run build

# 3. Done — symlinks already point to the new build
spectify --version
```

### Unlinking

```bash
npm unlink --workspace=@cisco_open/linting-orchestrator
npm unlink --workspace=@cisco_open/linting-reports
```

**Advantages:**
- ✅ Rebuilding is sufficient — no reinstall step
- ✅ Full source code access

**Disadvantages:**
- ❌ Requires a local clone
- ❌ Symlinks (not a standalone installation)

---

## Comparison Table

| Feature | npm registry (recommended) | npm link --workspace=… |
|---------|----------------------------|------------------------|
| **Complexity** | ⭐ Simple | ⭐⭐⭐ Advanced |
| **Installation Type** | Copy | Symlink |
| **After Code Changes** | — | Just rebuild |
| **Upgrade Command** | `npm update -g` | Pull + rebuild |
| **Best For** | End users | Maintainers / contributors |
| **Both Binaries** | ✅ Yes | ✅ Yes |

---

## Troubleshooting

### Problem: Old version still showing after upgrade

**Cause:** Multiple installations exist (both `npm install -g @cisco_open/linting-orchestrator` and `npm link`)

**Solution:**
```bash
# 1. Uninstall everything
npm uninstall -g @cisco_open/linting-orchestrator

# 2. Choose ONE method:
# For users:
npm install -g @cisco_open/linting-orchestrator

# For maintainers:
npm link --workspace=@cisco_open/linting-orchestrator
```

### Problem: `spectifyd` command not found

**Cause:** Installation didn't complete or shebang missing

**Solution:**
```bash
# 1. Rebuild
npm run build

# 2. Verify shebang in packages/orchestrator/build/index.js
head -1 packages/orchestrator/build/index.js
# Should show: #!/usr/bin/env node

# 3. Reinstall
npm uninstall -g @cisco_open/linting-orchestrator
npm install -g @cisco_open/linting-orchestrator   # or: npm link --workspace=@cisco_open/linting-orchestrator

# 4. Verify
which spectifyd
```

### Problem: Version shows old number after rebuild

**Cause:** Forgot to rebuild or browser cache

**Solution:**
```bash
# 1. Clean and rebuild every package
rm -rf packages/*/build
npm run build

# 2. Verify version in source
grep "CLI_VERSION\|PACKAGE_VERSION" packages/orchestrator/src/version.ts

# 3. Test
spectify --version
```

### Problem: Workspace package import fails to resolve

**Cause:** Workspaces not linked, or a dependent package not built.

This repo is an npm-workspaces monorepo. The orchestrator (`packages/orchestrator`)
depends on `@cisco_open/linting-document-store` and `@cisco_open/linting-reports`,
both of which live under `packages/`. They must be built before the orchestrator
can resolve their entry points.

**Solution:**
```bash
# 1. Re-link the workspaces
npm install

# 2. Build everything in the correct order (document-store -> reports -> orchestrator)
npm run build
```

---

## Verifying Installation

After installation (any method), verify both binaries work:

```bash
# 1. Check versions
spectify --version
# Should show: 0.5.0

# 2. Check help
spectify --help

# 3. Check both binaries exist
which spectify
which spectifyd

# 4. Test server startup (will start server, Ctrl+C to stop)
spectifyd
# Should show: 🚀 Starting Spectify server...

# 5. Test CLI commands
spectify rulesets
spectify health http://localhost:3003
```

---

## Recommended Workflow by Role

### End User (Production)
```bash
npm install -g @cisco_open/linting-orchestrator
spectify --help

# Upgrade:
npm update -g @cisco_open/linting-orchestrator
```

### Contributor (Development)
```bash
# Clone, build, link:
git clone https://github.com/cisco-open/linting-orchestrator.git
cd linting-orchestrator
npm install && npm run build
npm link --workspace=@cisco_open/linting-orchestrator

# Daily workflow:
# Edit code → npm run build → test immediately
# No reinstall needed!

# Upgrade:
git pull && npm run build
```

---

## Next Steps

After installation:

1. **Try Embedded Mode (Embedded Server)**
   ```bash
   spectify start
   # Server runs in-process with CLI
   ```

2. **Try Standalone Mode (Dedicated Server)**
   ```bash
   spectifyd
   # Server runs independently
   ```

3. **Read the Quick Start Guides:**
   - [CLI Quick Start](./QUICK_START_CLI.md)
   - [API Quick Start](./QUICK_START_API.md)

4. **Explore Deployment Modes:**
   - [Deployment Architecture](./design/CLI_SERVER_DEPLOYMENT_ARCHITECTURE.md)

---

## Support

- **Issues:** https://github.com/cisco-open/linting-orchestrator/issues
- **Documentation:** [docs/README.md](./README.md)
- **Contributing:** [AGENTS.md](../AGENTS.md) (for developers)
