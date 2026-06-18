# Ruleset Management Architecture

**Version:** 1.0  
**Last Updated:** November 19, 2025  
**Status:** Design Specification

---

## Table of Contents

1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [Architecture](#architecture)
4. [Source Repository Management](#source-repository-management)
5. [Configuration Layer](#configuration-layer)
6. [Exposed Rulesets](#exposed-rulesets)
7. [Implementation Details](#implementation-details)
8. [Examples](#examples)
9. [Maintenance Workflows](#maintenance-workflows)
10. [API Integration](#api-integration)

---

## Overview

the orchestrator's ruleset management system cleanly separates **source repositories** (physical storage of external ruleset code) from **exposed rulesets** (logical, versioned rulesets that users interact with). This design enables:

- ✅ **Multiple rulesets from one source** (e.g., contract.js, documentation.js from same repo)
- ✅ **Independent versioning** (the orchestrator versions ≠ source repo versions)
- ✅ **Dump-based updates** (for unversioned repos, use dump dates as versions)
- ✅ **Clear traceability** (know exactly which source/version each ruleset comes from)
- ✅ **Easy updates** (drop new repo dump, update config, done)
- ✅ **Category tracking** (publishing, contract, security, etc.)
- ✅ **Origin tracking** (internal, external, third-party)

---

## Problem Statement

### Real-World Complexity

When integrating external Spectral rulesets, we face several challenges:

1. **Source Repos Have Multiple Potential Rulesets**
   - Example: API Insights repo contains `contract.js`, `documentation.js`, `completeness.js`, `validation.js`
   - We may want to expose each as a separate logical ruleset

2. **Source Repos May Not Be Versioned**
   - Example: PubHub-Analyzer doesn't use semver tags
   - We need to track "dumps" by date instead

3. **the orchestrator Versions ≠ Source Versions**
   - We may expose "contract v1.0.0" from "API Insights repo v1.2.0"
   - Or "pubhub v1.1.0" from "2024-06-15 dump"

4. **Need to Track Metadata**
   - Which team owns this ruleset?
   - Is it internal or external?
   - What category does it belong to?

5. **Updates Must Be Clean**
   - When source repo updates, we should be able to add new versions without breaking old ones
   - Users should be able to pin to specific versions

### Without This Architecture (Problems)

```
❌ Mixed concerns: source code and configuration together
❌ Hard to add new rulesets from existing source repos
❌ Version conflicts between Spectify and source repos
❌ Difficult to track origin and ownership
❌ Updates require code changes, not just config
```

### With This Architecture (Solutions)

```
✅ Clear separation: sources/ vs config/ vs exposed rulesets
✅ Multiple rulesets from one source via config
✅ Independent versioning at each layer
✅ Metadata tracked in config
✅ Updates = drop new source + edit config
```

---

## Architecture

### Three-Layer Model

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1: SOURCE REPOSITORIES (Physical Storage)            │
│  Location: rulesets/sources/{domain}/{org}/{repo}/{version}/│
│                                                              │
│  Purpose: Store original ruleset code as-is from repos      │
│  Versioning: Repo's native versioning OR dump dates         │
│  Structure: Unchanged from original repo                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2: CONFIGURATION (Mapping Layer)                     │
│  Location: rulesets/config/rulesets.yaml                    │
│                                                              │
│  Purpose: Define which rulesets to expose and from where    │
│  Versioning: Spectify-controlled semantic versions          │
│  Structure: YAML configuration mapping sources to rulesets  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: EXPOSED RULESETS (User-Facing API)                │
│  Access: HTTP API (/rulesets, /rulesets/:name)              │
│                                                              │
│  Purpose: Clean, stable API for users                       │
│  Versioning: Semantic versioning (1.0.0, 1.1.0, etc.)      │
│  Structure: Normalized ruleset metadata + rules             │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
rulesets/
├── sources/                              # LAYER 1: Source repos
│   ├── github.com/                       # Public GitHub
│   │   └── CiscoDevNet/
│   │       └── api-insights-openapi-rulesets/
│   │           ├── 2025-11-19/          # Dump date (unversioned repo)
│   │           │   ├── contract.js
│   │           │   ├── completeness.js
│   │           │   ├── documentation.js
│   │           │   ├── validation.js
│   │           │   ├── functions/
│   │           │   └── package.json
│   │           └── v1.2.0/              # Future: if repo adds semver
│   │               └── ...
│   │
│   └── wwwin-github.cisco.com/          # Internal Cisco GitHub
│       └── DevNet/
│           └── PubHub-Analyzer/
│               ├── 1.1.0/               # Repo uses semver
│               │   ├── pubhub.yaml
│               │   ├── devxPublishingRequirements.js
│               │   ├── pubhubRendering.js
│               │   ├── functions/
│               │   └── package.json
│               └── 1.2.0/               # Future version
│                   └── ...
│
├── config/                               # LAYER 2: Configuration
│   └── rulesets.yaml                    # Master configuration
│
└── README.md                            # Documentation
```

---

## Source Repository Management

### Naming Convention

**Pattern:** `{domain}/{organization}/{repository}/{version}/`

**Examples:**
```
github.com/CiscoDevNet/api-insights-openapi-rulesets/2025-11-19/
wwwin-github.cisco.com/DevNet/PubHub-Analyzer/1.1.0/
gitlab.com/myorg/custom-ruleset/v2.3.0/
```

### Version Identification

Use whichever is available from the source:

1. **Semantic Version Tag** (preferred): `v1.0.0`, `v1.2.0`
   - Example: `PubHub-Analyzer/1.1.0/`

2. **ISO Date** (for unversioned repos): `YYYY-MM-DD`
   - Example: `api-insights-openapi-rulesets/2025-11-19/`

3. **Commit SHA** (if needed): `abc123def456`
   - Example: `custom-ruleset/abc123def456/`

### Adding a New Source Repository

#### Step 1: Create Directory

```bash
# Navigate to sources
cd rulesets/sources

# Create full path structure
mkdir -p github.com/CiscoDevNet/api-insights-openapi-rulesets/2025-11-19

# Copy repo contents (preserving structure)
cp -r /path/to/cloned/repo/* \
  github.com/CiscoDevNet/api-insights-openapi-rulesets/2025-11-19/
```

#### Step 2: Verify Structure

The source directory should be **unchanged** from the original repo:

```
github.com/CiscoDevNet/api-insights-openapi-rulesets/2025-11-19/
├── contract.js               # Original files
├── completeness.js
├── documentation.js
├── functions/               # Original structure
│   ├── someFunction.js
│   └── ...
├── package.json             # Original dependencies
└── README.md                # Original docs
```

✅ **Keep everything as-is** - no modifications to source files  
✅ **Include all files** - even if not all are used  
✅ **Preserve structure** - maintain original directory layout

#### Step 3: Document Source

Add entry to `rulesets/sources/README.md`:

```markdown
## github.com/CiscoDevNet/api-insights-openapi-rulesets

- **Repository:** https://github.com/CiscoDevNet/api-insights-openapi-rulesets
- **License:** MIT
- **Maintainer:** Cisco API Insights Team

### Versions

| Version    | Date       | Notes                    |
|------------|------------|--------------------------|
| 2025-11-19 | 2025-11-19 | Initial dump from main branch |
```

---

## Configuration Layer

### Master Configuration File

**Location:** `rulesets/config/rulesets.yaml`

This file defines **all exposed rulesets** and maps them to source repositories.

### Configuration Schema

```yaml
# Spectify Ruleset Configuration
# Defines which rulesets to expose to users via the API

rulesets:
  # Each entry is a logical ruleset (user-facing)
  - name: string                    # Unique identifier (kebab-case)
    displayName: string             # Human-readable name
    category: string                # publishing|contract|security|documentation|other
    origin: string                  # internal|external|third-party
    description: string             # User-facing description
    tags: string[]                  # Searchable tags
    metadata:                       # Additional metadata
      team: string                  # Owning team
      repository: string            # Source repo URL
      license: string               # License (Apache-2.0, MIT, etc.)
      documentation: string         # (Optional) Docs URL
      maintainer: string            # (Optional) Contact email/slack
    versions:
      - version: string             # Spectify version (semver)
        sourceRepo: string          # Source path (relative to sources/)
        sourceVersion: string       # Source version/date
        entrypoint: string          # Main file to load
        releaseDate: string         # ISO date
        deprecated: boolean         # Is this version deprecated?
        changelog: string           # (Optional) What's new

defaults:
  # Default version for each ruleset
  ruleset-name: "version"
```

### Field Descriptions

#### Ruleset-Level Fields

- **`name`** (required, unique): Identifier used in API endpoints
  - Format: `kebab-case`
  - Example: `pubhub`, `contract`, `contract-documentation`

- **`displayName`** (required): Human-readable name shown in UI/docs
  - Example: `"PubHub Readiness Analyzer"`

- **`category`** (required): Ruleset category for organization
  - Values: `publishing`, `contract`, `security`, `documentation`, `validation`, `other`

- **`origin`** (required): Source origin type
  - `internal`: Cisco internal repositories
  - `external`: Public open-source repositories
  - `third-party`: External vendor/partner repositories

- **`description`** (required): Brief description of ruleset purpose
  - 1-2 sentences max
  - User-facing documentation

- **`tags`** (required): Array of searchable keywords
  - Example: `[devnet, pubhub, publishing, cisco]`

- **`metadata`** (required): Ownership and tracking info
  - `team`: Team responsible for maintaining this ruleset
  - `repository`: URL to source repository
  - `license`: SPDX license identifier
  - `documentation`: (Optional) Link to ruleset docs
  - `maintainer`: (Optional) Contact info

#### Version-Level Fields

- **`version`** (required): Orchestrator version number (semver)
  - Format: `MAJOR.MINOR.PATCH` (e.g., `1.0.0`, `1.1.0`)
  - Independent of source repo version

- **`sourceRepo`** (required): Path to source repo
  - Relative to `rulesets/sources/`
  - Example: `github.com/CiscoDevNet/api-insights-openapi-rulesets`

- **`sourceVersion`** (required): Source repo version or dump date
  - Use repo's native version if available (e.g., `v1.2.0`)
  - Otherwise use ISO date (e.g., `2025-11-19`)

- **`entrypoint`** (required): Main Spectral file to load
  - Filename only (e.g., `contract.js`, `pubhub.yaml`)
  - Must exist in `{sourceRepo}/{sourceVersion}/`

- **`loader`** (optional): Which mechanism to use when loading the entrypoint
  - `bundler` *(default)*: Spectral's Rollup-based
    `@stoplight/spectral-ruleset-bundler`. Handles YAML, ESM JavaScript,
    `extends: 'spectral:oas'` token resolution, and named imports from CJS
    npm packages (via Rollup interop). The right choice for almost every
    ruleset — explicit or absent, this is the default.
  - `native`: Node's built-in `await import()`. Use when the entrypoint is a
    CommonJS dist file (typically produced by Babel or `tsc --module commonjs`)
    that the bundler chokes on with `exports is not defined`. Only valid for
    `.js` / `.cjs` / `.mjs` entrypoints; not applicable to YAML or
    `spectral:*` tokens.
  - **When to use `native`:** if `spectify rulesets check` reports
    `exports is not defined` for a JavaScript entrypoint, add
    `loader: native` to that version entry.

- **`releaseDate`** (required): When this version was released
  - Format: ISO 8601 date (`YYYY-MM-DD`)

- **`deprecated`** (required): Is this version deprecated?
  - `false`: Active, supported version
  - `true`: Deprecated, may be removed in future

- **`changelog`** (optional): Brief description of changes
  - What's new in this version

---

## Exposed Rulesets

### User-Facing API

Users interact with rulesets through the orchestrator API:

```bash
# List all rulesets
GET /rulesets
→ Returns: Array of ruleset metadata (name, displayName, category, versions, etc.)

# Get specific ruleset details
GET /rulesets/pubhub
GET /rulesets/pubhub?version=1.1.0
→ Returns: Full ruleset details including all rules

# Submit lint job
POST /lint
{
  "documentId": "doc-123",
  "rulesetName": "pubhub",      # References exposed ruleset
  "rulesetVersion": "1.1.0"     # Spectify version
}
```

### Version Resolution

When a user requests a ruleset:

```
User Request: GET /rulesets/pubhub?version=1.1.0
       ↓
RulesetLoader: Load config from rulesets/config/rulesets.yaml
       ↓
Config Entry:
  - name: pubhub
    versions:
      - version: "1.1.0"
        sourceRepo: "wwwin-github.cisco.com/DevNet/PubHub-Analyzer"
        sourceVersion: "1.1.0"
        entrypoint: "pubhub.yaml"
       ↓
Resolve Path:
  rulesets/sources/wwwin-github.cisco.com/DevNet/PubHub-Analyzer/1.1.0/pubhub.yaml
       ↓
Load & Parse: Spectral loads YAML, resolves extends, extracts rules
       ↓
Return: RulesetVersion object with rules[]
```

### Default Version

If no version specified in request:

```
User Request: GET /rulesets/pubhub
       ↓
Check: defaults.pubhub in config
       ↓
Use: Version "1.1.0" (from defaults)
       ↓
Proceed: As above
```

---

## Implementation Details

### TypeScript Types

```typescript
// Configuration layer types
export interface RulesetConfig {
  name: string;
  displayName: string;
  category: 'publishing' | 'contract' | 'security' | 'documentation' | 'validation' | 'other';
  origin: 'internal' | 'external' | 'third-party';
  description: string;
  tags: string[];
  metadata: {
    team: string;
    repository: string;
    license: string;
    documentation?: string;
    maintainer?: string;
  };
  versions: RulesetVersionConfig[];
}

export interface RulesetVersionConfig {
  version: string;          // Spectify version (semver)
  sourceRepo: string;       // Path relative to sources/
  sourceVersion: string;    // Source version or date
  entrypoint: string;       // Main file to load
  releaseDate: string;      // ISO date
  deprecated: boolean;
  changelog?: string;
}

// Runtime types (loaded rulesets)
export interface RulesetVersion {
  version: string;
  sourceRepo: string;
  sourceVersion: string;
  entrypoint: string;
  releaseDate: string;
  deprecated: boolean;
  changelog?: string;
  path: string;            // Resolved filesystem path
  rules: RuleDefinition[]; // Extracted rules
}

export interface RulesetMetadata extends Omit<RulesetConfig, 'versions'> {
  versions: string[];      // Just version numbers for listing
  defaultVersion: string;
  ruleCount: number;       // Total rules in default version
}
```

### RulesetLoader Implementation

```typescript
export class RulesetLoader {
  private config: RulesetConfig;
  private rulesets: Map<string, RulesetConfig> = new Map();
  private cache: Map<string, RulesetVersion> = new Map();
  private configPath: string;

  constructor(config: { directory: string; cacheEnabled: boolean }) {
    this.config = config;
    this.configPath = path.join(config.directory, 'config', 'rulesets.yaml');
  }

  async initialize(): Promise<void> {
    // Load master configuration
    const configYaml = await fs.readFile(this.configPath, 'utf-8');
    const config = yaml.parse(configYaml);
    
    // Index rulesets by name
    for (const ruleset of config.rulesets) {
      this.rulesets.set(ruleset.name, ruleset);
    }
    
    this.defaults = config.defaults || {};
  }

  async loadVersion(
    name: string, 
    version?: string
  ): Promise<RulesetVersion> {
    // 1. Get ruleset config
    const rulesetConfig = this.rulesets.get(name);
    if (!rulesetConfig) {
      throw new Error(`Ruleset '${name}' not found`);
    }
    
    // 2. Determine version to load
    const targetVersion = version || this.defaults[name] || 
      rulesetConfig.versions[0].version;
    
    // 3. Check cache
    const cacheKey = `${name}:${targetVersion}`;
    if (this.config.cacheEnabled && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }
    
    // 4. Find version config
    const versionConfig = rulesetConfig.versions.find(
      v => v.version === targetVersion
    );
    if (!versionConfig) {
      throw new Error(
        `Version '${targetVersion}' not found for ruleset '${name}'`
      );
    }
    
    // 5. Resolve source path
    const sourcePath = path.join(
      this.config.directory,
      'sources',
      versionConfig.sourceRepo,
      versionConfig.sourceVersion,
      versionConfig.entrypoint
    );
    
    // 6. Parse Spectral ruleset
    const rules = await this.parseSpectralRuleset(sourcePath);
    
    // 7. Build result
    const result: RulesetVersion = {
      ...versionConfig,
      path: sourcePath,
      rules
    };
    
    // 8. Cache if enabled
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, result);
    }
    
    return result;
  }

  async listRulesets(): Promise<RulesetMetadata[]> {
    const results: RulesetMetadata[] = [];
    
    for (const [name, config] of this.rulesets) {
      // Load default version to get rule count
      const defaultVersion = await this.loadVersion(name);
      
      results.push({
        name: config.name,
        displayName: config.displayName,
        category: config.category,
        origin: config.origin,
        description: config.description,
        tags: config.tags,
        metadata: config.metadata,
        versions: config.versions.map(v => v.version),
        defaultVersion: this.defaults[name] || config.versions[0].version,
        ruleCount: defaultVersion.rules.length
      });
    }
    
    return results;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async parseSpectralRuleset(
    entrypointPath: string
  ): Promise<RuleDefinition[]> {
    // Implementation details in Phase 3
    // Uses @stoplight/spectral-core to load and parse
  }
}
```

---

## Examples

### Example 1: PubHub Ruleset (Single Entrypoint)

**Source Location:**
```
rulesets/sources/
  wwwin-github.cisco.com/DevNet/PubHub-Analyzer/1.1.0/
    ├── pubhub.yaml                    # Main entrypoint
    ├── devxPublishingRequirements.js  # Extended by pubhub.yaml
    ├── pubhubRendering.js             # Extended by pubhub.yaml
    └── functions/
```

**Configuration:**
```yaml
rulesets:
  - name: pubhub
    displayName: "PubHub Readiness Analyzer"
    category: publishing
    origin: internal
    description: "Validates OpenAPI documents for PubHub publishing requirements"
    tags: [devnet, pubhub, publishing, cisco]
    metadata:
      team: "DevNet"
      repository: "https://wwwin-github.cisco.com/DevNet/PubHub-Analyzer"
      license: "Apache-2.0"
    versions:
      - version: "1.1.0"
        sourceRepo: "wwwin-github.cisco.com/DevNet/PubHub-Analyzer"
        sourceVersion: "1.1.0"
        entrypoint: "pubhub.yaml"
        releaseDate: "2024-06-15"
        deprecated: false
        changelog: "Initial Spectify integration"

defaults:
  pubhub: "1.1.0"
```

**User Access:**
```bash
GET /rulesets/pubhub
→ Loads pubhub.yaml
→ Spectral resolves extends to devxPublishingRequirements.js, pubhubRendering.js
→ Returns ~50 rules
```

### Example 2: Contract Rulesets (Multiple Entrypoints)

**Source Location:**
```
rulesets/sources/
  github.com/CiscoDevNet/api-insights-openapi-rulesets/2025-11-19/
    ├── contract.js           # Entrypoint 1
    ├── completeness.js       # Entrypoint 2
    ├── documentation.js      # Entrypoint 3
    ├── validation.js         # Entrypoint 4
    └── functions/
```

**Configuration (Multiple Logical Rulesets):**
```yaml
rulesets:
  # Ruleset 1: Contract analyzer
  - name: contract
    displayName: "API Contract Analyzer"
    category: contract
    origin: external
    description: "Validates API contract completeness and quality"
    tags: [api-insights, contract, cisco]
    metadata:
      team: "API Insights Team"
      repository: "https://github.com/CiscoDevNet/api-insights-openapi-rulesets"
      license: "MIT"
    versions:
      - version: "1.0.0"
        sourceRepo: "github.com/CiscoDevNet/api-insights-openapi-rulesets"
        sourceVersion: "2025-11-19"
        entrypoint: "contract.js"
        releaseDate: "2025-11-19"
        deprecated: false

  # Ruleset 2: Documentation checker (same source!)
  - name: contract-documentation
    displayName: "API Documentation Quality"
    category: documentation
    origin: external
    description: "Validates API documentation completeness"
    tags: [api-insights, documentation]
    metadata:
      team: "API Insights Team"
      repository: "https://github.com/CiscoDevNet/api-insights-openapi-rulesets"
      license: "MIT"
    versions:
      - version: "2.0.0"                # Different Spectify version
        sourceRepo: "github.com/CiscoDevNet/api-insights-openapi-rulesets"
        sourceVersion: "2025-11-19"     # Same source!
        entrypoint: "documentation.js"  # Different file!
        releaseDate: "2025-11-19"
        deprecated: false

  # Ruleset 3: Completeness checker
  - name: contract-completeness
    displayName: "API Completeness Checker"
    category: validation
    origin: external
    description: "Validates API completeness standards"
    tags: [api-insights, completeness]
    metadata:
      team: "API Insights Team"
      repository: "https://github.com/CiscoDevNet/api-insights-openapi-rulesets"
      license: "MIT"
    versions:
      - version: "1.5.0"
        sourceRepo: "github.com/CiscoDevNet/api-insights-openapi-rulesets"
        sourceVersion: "2025-11-19"
        entrypoint: "completeness.js"
        releaseDate: "2025-11-19"
        deprecated: false

defaults:
  contract: "1.0.0"
  contract-documentation: "2.0.0"
  contract-completeness: "1.5.0"
```

**Result:** 3 logical rulesets from 1 source directory!

---

## Maintenance Workflows

### Workflow 1: Update Existing Source Repo

**Scenario:** PubHub-Analyzer releases version 1.2.0

**Steps:**

1. **Add new source version:**
   ```bash
   cd rulesets/sources/wwwin-github.cisco.com/DevNet/PubHub-Analyzer
   git clone --branch v1.2.0 <repo-url> 1.2.0
   ```

2. **Update configuration:**
   ```yaml
   # rulesets/config/rulesets.yaml
   rulesets:
     - name: pubhub
       versions:
         # Keep old version
         - version: "1.1.0"
           sourceRepo: "wwwin-github.cisco.com/DevNet/PubHub-Analyzer"
           sourceVersion: "1.1.0"
           entrypoint: "pubhub.yaml"
           releaseDate: "2024-06-15"
           deprecated: false
         
         # Add new version
         - version: "1.2.0"
           sourceRepo: "wwwin-github.cisco.com/DevNet/PubHub-Analyzer"
           sourceVersion: "1.2.0"
           entrypoint: "pubhub.yaml"
           releaseDate: "2025-11-19"
           deprecated: false
           changelog: "Updated rules for improved validation"
   
   defaults:
     pubhub: "1.2.0"  # Update default to new version
   ```

3. **Clear cache (if API supports):**
   ```bash
   POST /admin/cache/clear
   ```

4. **Test new version:**
   ```bash
   GET /rulesets/pubhub?version=1.2.0
   ```

### Workflow 2: Add New Ruleset from Existing Source

**Scenario:** Expose `validation.js` from API Insights as separate ruleset

**Steps:**

1. **Source already exists** (no changes needed):
   ```
   rulesets/sources/
     github.com/CiscoDevNet/api-insights-openapi-rulesets/2025-11-19/
       └── validation.js  ← Already there!
   ```

2. **Add configuration entry:**
   ```yaml
   # rulesets/config/rulesets.yaml
   rulesets:
     # ... existing rulesets ...
     
     # NEW: Add validation ruleset
     - name: contract-validation
       displayName: "API Validation Rules"
       category: validation
       origin: external
       description: "Validates API structure and conventions"
       tags: [api-insights, validation]
       metadata:
         team: "API Insights Team"
         repository: "https://github.com/CiscoDevNet/api-insights-openapi-rulesets"
         license: "MIT"
       versions:
         - version: "1.0.0"
           sourceRepo: "github.com/CiscoDevNet/api-insights-openapi-rulesets"
           sourceVersion: "2025-11-19"
           entrypoint: "validation.js"  # New entrypoint!
           releaseDate: "2025-11-19"
           deprecated: false
   
   defaults:
     contract-validation: "1.0.0"
   ```

3. **Restart service** (or clear cache)

4. **Verify:**
   ```bash
   GET /rulesets
   → Should now include "contract-validation"
   ```

### Workflow 3: Deprecate Old Version

**Scenario:** Mark pubhub v1.1.0 as deprecated

**Steps:**

1. **Update configuration:**
   ```yaml
   rulesets:
     - name: pubhub
       versions:
         - version: "1.1.0"
           deprecated: true  # ← Change to true
           # ... rest unchanged
         
         - version: "1.2.0"
           deprecated: false
   
   defaults:
     pubhub: "1.2.0"  # Ensure default is not deprecated version
   ```

2. **Update CHANGELOG:**
   ```markdown
   ## [Unreleased]
   
   ### Deprecated
   - pubhub v1.1.0 (use v1.2.0 instead)
   ```

3. **Users can still use v1.1.0:**
   ```bash
   GET /rulesets/pubhub?version=1.1.0  # Still works!
   → Response includes "deprecated": true
   ```

### Workflow 4: Add Brand New Source Repository

**Scenario:** Add Cisco Security Ruleset from new repo

**Steps:**

1. **Clone source:**
   ```bash
   cd rulesets/sources
   mkdir -p wwwin-github.cisco.com/Security/openapi-security-rules
   git clone <repo-url> wwwin-github.cisco.com/Security/openapi-security-rules/v1.0.0
   ```

2. **Document source:**
   ```markdown
   ## wwwin-github.cisco.com/Security/openapi-security-rules
   
   - **Repository:** https://wwwin-github.cisco.com/Security/openapi-security-rules
   - **License:** Cisco Internal
   - **Maintainer:** Security Team
   
   ### Versions
   
   | Version | Date       | Notes              |
   |---------|------------|--------------------|
   | v1.0.0  | 2025-11-19 | Initial integration |
   ```

3. **Add configuration:**
   ```yaml
   rulesets:
     # ... existing rulesets ...
     
     - name: security
       displayName: "Cisco Security Rules"
       category: security
       origin: internal
       description: "Security validation rules for OpenAPI"
       tags: [security, cisco, vulnerability]
       metadata:
         team: "Security Team"
         repository: "https://wwwin-github.cisco.com/Security/openapi-security-rules"
         license: "Cisco Internal"
         maintainer: "security-team@cisco.com"
       versions:
         - version: "1.0.0"
           sourceRepo: "wwwin-github.cisco.com/Security/openapi-security-rules"
           sourceVersion: "v1.0.0"
           entrypoint: "security.yaml"
           releaseDate: "2025-11-19"
           deprecated: false
   
   defaults:
     security: "1.0.0"
   ```

---

## API Integration

### Cache Refresh API (Future Enhancement)

While not in Phase 3, the design supports future cache management:

```bash
# Clear entire cache
POST /admin/cache/clear
→ Clears all cached rulesets

# Clear specific ruleset cache
POST /admin/cache/clear/pubhub
→ Clears cache for pubhub ruleset (all versions)

# Clear specific version cache
POST /admin/cache/clear/pubhub/1.1.0
→ Clears cache for pubhub v1.1.0 only

# Reload configuration
POST /admin/config/reload
→ Reloads rulesets/config/rulesets.yaml
```

### Metadata in API Responses

All API responses include traceability:

```json
{
  "name": "pubhub",
  "version": "1.1.0",
  "category": "publishing",
  "origin": "internal",
  "source": {
    "repository": "wwwin-github.cisco.com/DevNet/PubHub-Analyzer",
    "version": "1.1.0",
    "entrypoint": "pubhub.yaml"
  },
  "metadata": {
    "team": "DevNet",
    "license": "Apache-2.0"
  },
  "rules": [ /* ... */ ]
}
```

---

## Rule Management Philosophy

### MVP Approach: Rules are Scoped to Rulesets

**Design Decision:** Rules are treated as **part of their ruleset**, not global entities.

#### Key Principles

1. **No Global Rule Registry** - Rules belong to rulesets, not a global catalog
2. **No Automatic Deduplication** - Accept some redundant execution for simplicity
3. **Version via Ruleset** - Rule "version" is implicitly the ruleset version
4. **Optimize Later** - Add optimization only if performance becomes critical

#### Rationale

**Why This Approach?**

✅ **Simplicity** - Matches how Spectral works natively  
✅ **Correctness** - Preserves ruleset author's intent (different rulesets MAY have different implementations)  
✅ **Flexibility** - Rulesets can customize rule severity, messages, configurations  
✅ **MVP-Ready** - Ship faster, add optimization later if needed  
✅ **Worker Pool Wins** - Worker-per-ruleset + document caching are bigger optimizations

**Performance Trade-off:**

```typescript
// Current approach (simple):
const pubhubResults = await spectral.run(document, pubhubRuleset);    // 500ms
const contractResults = await spectral.run(document, contractRuleset); // 500ms
// Total: 1000ms - acceptable for MVP!

// Optimized approach (complex):
const allRules = [...pubhubRules, ...contractRules];
const deduplicatedRules = fingerprint(allRules); // Complex fingerprinting
const results = await spectral.run(document, deduplicatedRules); // 600ms
const mappedResults = mapBackToRulesets(results); // Complex mapping
// Total: 600ms - Only 40% faster, 10x complexity
```

**Verdict:** Premature optimization. The 400ms savings doesn't justify the complexity.

#### Rule Identification

Rules are uniquely identified by: `{rulesetName}:{rulesetVersion}:{ruleName}`

**Examples:**
- `pubhub:1.1.0:operationId-required-and-unique`
- `contract:1.0.0:operationId-required-and-unique`

These are treated as **two separate rules**, even if the implementation is identical.

#### What About Duplicate Execution?

**Q:** If multiple rulesets have the same rule, won't we run it multiple times?

**A:** Yes, and that's okay for MVP because:

1. **Spectral is fast** - Typically <1s per ruleset, even with duplicates
2. **Worker pool parallelism** - Bigger performance win (2-5x speedup)
3. **Document caching** - Bigger performance win (10-200ms saved)
4. **Complexity trade-off** - Simple code > small optimization
5. **Measure first** - Optimize only if >10s execution time observed

#### TypeScript Representation

```typescript
export interface RuleDefinition {
  name: string;              // "operationId-required-and-unique"
  rulesetName: string;        // "pubhub" (scoped to this ruleset)
  rulesetVersion: string;     // "1.1.0"
  severity: 'error' | 'warn' | 'info';
  message: string;
  description?: string;
  // ... Spectral rule details
}

// No global ruleId
// No rule fingerprinting (yet)
// No cross-ruleset tracking (yet)
```

### Future: Global Rule Optimization (Post-MVP)

**When to implement:** Only if performance measurements show >10s execution time

**Potential approach:**

1. **Rule Fingerprinting** - Hash function code + configuration
2. **Global Rule Catalog** - Track all rules across all rulesets
3. **Execution Deduplication** - Run identical rules once, map results to multiple rulesets
4. **Cross-Ruleset Documentation** - Show all rulesets using rule X

**Decision Point:** Add this complexity only when:
- User complaints about slowness
- Measurements show >10s execution time
- Clear evidence of redundant execution bottleneck

**Until then:** Keep it simple, ship fast, measure, optimize later.

---

## Benefits Summary

### For Maintainers

✅ **Clean Updates:** Drop new source folder + edit config = done  
✅ **Version Control:** Multiple versions coexist peacefully  
✅ **Flexibility:** Multiple rulesets from one source  
✅ **Traceability:** Always know source of each ruleset  
✅ **Safety:** Old versions remain available, no breaking changes  
✅ **Simple Rules:** Rules scoped to rulesets, no global registry complexity

### For Users

✅ **Stable API:** Versions don't change unexpectedly  
✅ **Version Pinning:** Can specify exact version needed  
✅ **Clarity:** Know category, origin, team for each ruleset  
✅ **Documentation:** Metadata includes repo, license, team  
✅ **Defaults:** Can omit version and get sensible default  
✅ **Fast Execution:** Worker pool + caching provide good performance

### For the System

✅ **Scalable:** Easy to add 10, 100, 1000 rulesets  
✅ **Maintainable:** Clear separation of concerns  
✅ **Testable:** Configuration changes don't require code changes  
✅ **Extensible:** Can add new metadata fields without breaking changes  
✅ **Cacheable:** Rulesets loaded once, cached for performance  
✅ **Optimizable:** Can add rule deduplication later if needed

---

## Related Documentation

- [PHASE_3_RULESET_MANAGEMENT.md](./PHASE_3_RULESET_MANAGEMENT.md) - Implementation plan
- [LINT_ORCHESTRATOR_DESIGN.md](./LINT_ORCHESTRATOR_DESIGN.md) - Overall system design
- [AGENTS.md](../AGENTS.md) - Implementation guide for AI agents

---

**Version History:**

- **1.0** (2025-11-19): Initial design specification
