# GitHub Copilot Instructions for the orchestrator

This file provides context and workflows for GitHub Copilot when assisting with the orchestrator development.

## Project Overview

The linting orchestrator uses Spectral and custom rule engines. It supports external rulesets from various sources.

## Common Workflows

### Adding a New Ruleset

When a user asks to "add a new ruleset" or "integrate a ruleset", follow this workflow:

1. **Gather Information**
   - Ask for: Repository URL, domain, organization, repository name, version/tag
   - Example questions:
     ```
     - What's the repository URL? (e.g., https://github.com/CiscoDevNet/api-insights-openapi-rulesets)
     - What domain is it from? (github.com, wwwin-github.cisco.com, etc.)
     - What's the organization name? (CiscoDevNet, DevNet, etc.)
     - What version/tag/date should we use? (v1.0.0, 2026-02-05, etc.)
     - Which branch should we clone? (default: main)
     ```

2. **Run the Automation Script**
   ```bash
   # Interactive mode (recommended)
   npm run add-ruleset
   
   # Or with arguments
   bash scripts/add-ruleset.sh <repo-url> <domain> <org> <repo-name> <version> [branch]
   ```

3. **Guide Registration**
   After the script completes, help the user:
   
   a. **Add to rulesets/config/rulesets.yaml:**
   ```yaml
   rulesets:
     - id: unique-ruleset-id
       name: "Human Readable Name"
       description: "Brief description of ruleset purpose"
       source:
         type: filesystem
         path: sources/{domain}/{org}/{repo}/{version}/{main-file}.yaml
       defaultVersion: latest
       versions:
         - version: "{version}"
           spectralFile: {main-file}.yaml
   ```
   
   b. **Document in rulesets/sources/README.md:**
   - Add entry to the "Current Sources" section
   - Include: repository URL, license, maintainer, purpose
   - Add version table entry

4. **Verify Installation**
   ```bash
   npm run check-rulesets
   ```

### Finding Ruleset Files

When helping identify the main Spectral file:
```bash
# Look for common patterns
ls sources/{domain}/{org}/{repo}/{version}/*.yaml
ls sources/{domain}/{org}/{repo}/{version}/*.js

# Common filenames:
# - {repo-name}.yaml
# - ruleset.yaml
# - .spectral.yaml
# - index.js (CommonJS)
# - main entry in package.json
```

### Debugging Ruleset Loading

If a ruleset fails to load:

1. **Check dependencies:**
   ```bash
   npm run check-rulesets
   ```

2. **Install missing dependencies:**
   ```bash
   npm run install-rulesets
   ```

3. **Common issues:**
   - Missing `.git` removal (causes "modified content" warnings)
   - Missing `node_modules` (dependencies not installed)
   - Incorrect path in `rulesets.yaml`
   - Module resolution issues (check `package.json` exports)

## Code Patterns

### Ruleset Configuration Schema

```yaml
rulesets:
  - id: string              # Unique identifier (kebab-case)
    name: string            # Display name
    description: string     # Brief purpose description
    source:
      type: filesystem      # Always "filesystem" for sources/
      path: string          # Relative to rulesets/ directory
    defaultVersion: string  # "latest" or specific version
    versions:
      - version: string     # Version identifier
        spectralFile: string # Main Spectral file (relative to path)
```

### Adding Ruleset Entry Example

```yaml
- id: api-insights-validation
  name: "API Insights Validation"
  description: "API contract validation and quality checks"
  source:
    type: filesystem
    path: sources/github.com/CiscoDevNet/api-insights-openapi-rulesets/2025-11-19
  defaultVersion: latest
  versions:
    - version: "2025-11-19"
      spectralFile: validation.js
```

## Directory Structure

```
rulesets/
├── sources/                          # External ruleset sources
│   └── {domain}/                     # github.com, wwwin-github.cisco.com, etc.
│       └── {organization}/           # CiscoDevNet, DevNet, etc.
│           └── {repository}/         # Repo name
│               └── {version}/        # Version/tag/date
│                   ├── *.yaml        # Spectral rulesets
│                   ├── *.js          # Spectral rulesets (CommonJS)
│                   ├── functions/    # Custom functions
│                   ├── package.json  # Dependencies
│                   └── node_modules/ # Installed dependencies
├── config/
│   └── rulesets.yaml                 # Ruleset registry
└── CHANGELOG.md                      # Ruleset version history
```

## Scripts Reference

| Script | Purpose | Usage |
|--------|---------|-------|
| `npm run add-ruleset` | Add new ruleset source | Interactive wizard |
| `npm run install-rulesets` | Install all ruleset dependencies | Automatic in postinstall |
| `npm run check-rulesets` | Verify dependencies installed | Validates all rulesets |
| `spectify rulesets` | List available rulesets | CLI command |

## Helpful Commands

```bash
# List all configured rulesets
spectify rulesets

# Check specific ruleset can be loaded
spectify lint <document-id> --ruleset <ruleset-id>

# View ruleset metadata
cat rulesets/config/rulesets.yaml

# Check ruleset source exists
ls -la rulesets/sources/{domain}/{org}/{repo}/{version}
```

## Common User Intents

### "I want to add a ruleset"
→ Guide through `npm run add-ruleset` workflow

### "Ruleset not loading" or "Cannot find module"
→ Check dependencies: `npm run check-rulesets` → `npm run install-rulesets`

### "How do I use a ruleset?"
→ Show CLI: `spectify lint <doc-id> --ruleset <ruleset-id>`

### "Where are rulesets stored?"
→ Explain `rulesets/sources/` structure and `rulesets/config/rulesets.yaml`

### "How do I update a ruleset?"
→ Add new version directory, register in config, update defaultVersion

## Best Practices

1. **Always remove .git folders** from sources (prevents submodule confusion)
2. **Always install dependencies** via `npm install` in source directories
3. **Use consistent naming**: `{date}` format (YYYY-MM-DD) for unversioned repos
4. **Document thoroughly** in sources/README.md
5. **Test after adding**: Run `npm run check-rulesets` and verify with `spectify lint`

## Related Files

- `rulesets/sources/README.md` - Ruleset sources documentation
- `scripts/add-ruleset.sh` - Automation script
- `scripts/check-rulesets-dependencies.sh` - Dependency verification
- `AGENTS.md` - AI agent instructions for the orchestrator development
