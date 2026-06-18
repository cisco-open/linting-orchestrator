# Installation guide

Comprehensive guide for installing and upgrading the orchestrator in different scenarios.

---

## Overview

The orchestrator provides **three global binaries** when fully installed:

- **`spectify`** — CLI for linting OpenAPI documents (embeds its own daemon for one-shot use)
- **`spectifyd`** — Long-running orchestrator daemon (HTTP API + worker pool)
- **`spectifyr`** — Optional reporting service (persistent SQLite + web UI at `:3010`)

`spectify` and `spectifyd` are in the same package (`@cisco-open/linting-orchestrator`).  
`spectifyr` is a separate package (`@cisco-open/linting-reports`) and must be installed separately.

---

## Installation Methods

There are **two installation methods**:

| Method | Status | Use Case |
|--------|--------|----------|
| **npm registry** | 🚧 Coming soon | After package is published to npm |
| **npm link (from source)** | ✅ Available now | Pre-publish testing and development |

> **Why not `npm install -g ./packages/orchestrator`?**  
> The orchestrator declares sibling packages (`@cisco-open/linting-document-store`,
> `@cisco-open/linting-reports`) as regular npm dependencies. Outside of
> the workspace, npm tries to resolve them from the registry — which hangs because
> they aren't published yet. `npm link` avoids this by symlinking directly into
> the workspace directory where those deps are already installed.

---

## Method 1: npm Registry (Production - Coming Soon)

**Best for:** End users who want stable releases

**Status:** 🚧 Not yet published to npm registry (coming in v0.5.0+)

Once published, installation will be:

```bash
# Install
npm install -g @cisco-open/linting-orchestrator

# Verify both binaries
spectify --version         # CLI
spectifyd --version  # Standalone server

# Upgrade
npm update -g spectify

# Uninstall
npm uninstall -g spectify
```

**Advantages:**
- ✅ Simplest installation
- ✅ Automatic updates
- ✅ Version management
- ✅ No git clone needed

---

## Method 2: From Source — npm link

**Best for:** Pre-publish testing and active development

`npm link` creates global symlinks pointing into the workspace packages.
Because the symlinks resolve deps through the workspace's own `node_modules`,
npm never needs to fetch the sibling packages from the registry.

### Initial Setup

```bash
# 1. Clone the repository
git clone https://github.com/cisco-open/linting-orchestrator.git
cd spectify

# 2. Install workspace dependencies (links all packages/* together)
npm install

# 3. Build every package (document-store -> reports -> orchestrator)
npm run build

# 4. Create global symlinks for all three binaries
npm link --workspace=@cisco-open/linting-orchestrator  # spectify + spectifyd
npm link --workspace=@cisco-open/linting-reports        # spectifyr

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
npm unlink --workspace=@cisco-open/linting-orchestrator
npm unlink --workspace=@cisco-open/linting-reports
```

**Advantages:**
- ✅ Works before npm publication
- ✅ Rebuilding is sufficient — no reinstall step
- ✅ Full source code access

**Disadvantages:**
- ❌ Requires a local clone
- ❌ Symlinks (not a standalone installation)

---

## Comparison Table

| Feature | npm registry | npm install -g ./packages/orchestrator | npm link --workspace=… |
|---------|--------------|------------------|----------|
| **Complexity** | ⭐ Simple | ⭐⭐ Moderate | ⭐⭐⭐ Advanced |
| **Installation Type** | Copy | Copy | Symlink |
| **After Code Changes** | - | Reinstall | Just rebuild |
| **Upgrade Command** | `npm update -g` | Pull + rebuild + reinstall | Pull + rebuild |
| **Best For** | End users | Pre-release users | Developers |
| **Both Binaries** | ✅ Yes | ✅ Yes | ✅ Yes |

---

## Troubleshooting

### Problem: Old version still showing after upgrade

**Cause:** Multiple installations exist (both `npm install -g ./packages/orchestrator` and `npm link`)

**Solution:**
```bash
# 1. Uninstall everything
npm uninstall -g spectify

# 2. Choose ONE method:
# For users:
npm install -g ./packages/orchestrator

# For developers:
npm link --workspace=@cisco-open/linting-orchestrator
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
npm uninstall -g spectify
npm install -g ./packages/orchestrator   # or: npm link --workspace=@cisco-open/linting-orchestrator

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
depends on `@cisco-open/linting-document-store` and `@cisco-open/linting-reports`,
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
# When available on npm:
npm install -g @cisco-open/linting-orchestrator
spectify --help

# Upgrade:
npm update -g spectify
```

### Tester (Pre-Release)
```bash
# Clone, build, install:
git clone <repo>
cd spectify
npm install && npm run build
npm install -g ./packages/orchestrator

# Upgrade every few weeks:
git pull && npm install && npm run build && npm install -g ./packages/orchestrator
```

### Contributor (Development)
```bash
# Clone, build, link:
git clone <repo>
cd spectify
npm install && npm run build
npm link --workspace=@cisco-open/linting-orchestrator

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
