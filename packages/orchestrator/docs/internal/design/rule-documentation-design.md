# Rule Documentation Design

**Version:** 1.0  
**Status:** DESIGN  
**Created:** December 18, 2025  
**Purpose:** Design for exposing rule-level documentation and metadata

---

## Table of Contents

1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [Current State](#current-state)
4. [Design Goals](#design-goals)
5. [Proposed Architecture](#proposed-architecture)
6. [API Design](#api-design)
7. [Data Model](#data-model)
8. [Implementation Options](#implementation-options)
9. [Maintenance Workflow](#maintenance-workflow)
10. [CLI Integration](#cli-integration)
11. [Timeline](#timeline)

---

## Overview

Currently, Spectify exposes **rulesets** but not **individual rules**. Users can see which rule failed but don't have access to:
- What the rule checks
- Why the rule exists
- How to fix violations
- Rule configuration options

This design adds rule-level documentation capabilities while keeping descriptions **in the source code** (Spectral ruleset files) rather than maintaining separate documentation files.

---

## Problem Statement

### User Story

**As a developer**, when I get a lint error like:
```json
{
  "ruleId": "success-status-code",
  "message": "No success status codes found",
  "severity": 0
}
```

**I want to know:**
1. What is "success-status-code" checking?
2. Why does this matter?
3. How do I fix it?
4. What are the rule's options/configuration?

**Currently:** I have to:
- Search the ruleset source code manually
- Ask the ruleset maintainer
- Google the rule name (if it's a standard rule)
- Guess based on the error message

**Desired:** Simple API/CLI commands to explore rules and their documentation.

---

## Current State

### What We Have

**1. Rich Metadata in Source Files**

Spectral rulesets already contain descriptions:

```javascript
// rulesets/sources/.../PubHub-Analyzer/1.1.0/devxPublishingRequirements.js
'success-status-code': {
  'description': 'For every operation in the OAS document, there should be at least one success status code defined. A successful status code is in the 1xx, 2xx or 3xx range series, and generally a 200, 201 or 204.',
  'message': '{{description}}; {{error}}',
  'severity': 'error',
  'given': '$.paths.*.*.responses',
  'then': {
    'function': keyMatchAnyPattern,
    'functionOptions': {
      'patterns': ['/^([123]\\d{2}|default)$/'],
    },
  },
}
```

**2. Extracted in RulesetLoader**

```typescript
// src/ruleset-loader.ts
private extractRules(spectralRuleset: any, ...): RuleDefinition[] {
  const ruleDefinition: RuleDefinition = {
    name: ruleName,
    rulesetName,
    rulesetVersion,
    severity: this.mapSeverity(rule.severity),
    message: rule.message || rule.description || '',
    description: rule.description || '',  // ✅ Already extracted!
    given: Array.isArray(rule.given) ? rule.given : [rule.given],
    then: rule.then,
    recommended: rule.recommended !== false,
    formats: rule.formats,
  };
}
```

**3. Current API Endpoints**

```
GET /rulesets              # List rulesets (no rule details)
GET /lint/:jobId/results   # Results (ruleId, message, but no description)
```

### What We're Missing

```
❌ GET /rulesets/:name/rules          # List all rules in a ruleset
❌ GET /rulesets/:name/rules/:ruleId  # Get detailed rule documentation
❌ spectify rules <ruleset>            # CLI to explore rules
```

---

## Design Goals

### Primary Goals

1. **No Duplication**: Keep descriptions in source code (Spectral files), don't maintain separate docs
2. **Developer-Friendly**: Easy to discover and understand rules
3. **API-First**: Expose via HTTP API, then wrap in CLI
4. **Extensible**: Support future enhancements (examples, fix suggestions)
5. **Performance**: Efficient rule lookup (pre-indexed at startup)

### Non-Goals

- **Not a rule editor**: Just documentation/metadata exposure
- **Not a tutorial system**: Basic docs only, link to external guides
- **Not versioned separately**: Rule docs version with ruleset version

---

## Proposed Architecture

### Three-Layer Approach

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1: SOURCE (Spectral Ruleset Files)                   │
│  Location: rulesets/sources/.../pubhub.yaml + .js files     │
│                                                              │
│  Content: Spectral rule definitions with descriptions       │
│  Maintenance: Ruleset owners maintain descriptions in code  │
│  Format: Standard Spectral format (YAML/JS)                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2: LOADER (RulesetLoader)                            │
│  Location: src/ruleset-loader.ts                            │
│                                                              │
│  Action: Extract rules + descriptions at startup            │
│  Indexing: Build fast lookup: ruleset → version → ruleId   │
│  Enhancement: Optionally merge with extended metadata       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: API (HTTP + CLI)                                  │
│  Endpoints:                                                  │
│    GET /rulesets/:name/rules                                │
│    GET /rulesets/:name/rules/:ruleId                        │
│    CLI: spectify rules <ruleset>                            │
│                                                              │
│  Response: JSON with rule metadata + documentation          │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

**Decision 1: Use Existing `description` Field**

✅ **Chosen Approach**: Extract from `rule.description` in Spectral files

**Why:**
- Already exists in most Spectral rules
- No new files to maintain
- Standard Spectral practice
- Single source of truth

**Alternative (Rejected):** Separate markdown files per rule
- ❌ Duplication - two places to maintain
- ❌ Sync issues - code and docs drift
- ❌ More complexity

**Decision 2: Optional Extended Metadata**

For rules that need MORE than just description (examples, fix suggestions, links):

```
rulesets/
├── sources/                     # Original Spectral files (descriptions here)
└── metadata/                    # Optional extended metadata (if needed)
    └── pubhub/
        └── 1.1.0/
            └── rules-extended.yaml  # OPTIONAL enhancements
```

**rules-extended.yaml** (optional):
```yaml
rules:
  success-status-code:
    examples:
      - |
        ✅ Good:
        responses:
          200:
            description: Success
          
        ❌ Bad:
        responses:
          400:
            description: Error
    
    fixSuggestion: "Add a 2xx status code to your operation responses"
    learnMore: "https://docs.example.com/success-codes"
    category: "best-practices"
  
  # Only rules with extended metadata need to be listed
  # Others use description from Spectral file only
```

**Why Optional:**
- 90% of rules: description is enough
- 10% of rules: need examples, fix suggestions, links
- Don't force overhead on simple rules

---

## API Design

### Endpoint 1: List Rules in Ruleset

**Request:**
```http
GET /rulesets/:name/rules
GET /rulesets/:name/rules?version=1.1.0
GET /rulesets/:name/rules?severity=error
GET /rulesets/:name/rules?category=publishing
```

**Response:**
```json
{
  "ruleset": "pubhub",
  "version": "1.1.0",
  "ruleCount": 53,
  "rules": [
    {
      "name": "success-status-code",
      "severity": "error",
      "description": "For every operation in the OAS document...",
      "category": "best-practices",
      "recommended": true
    },
    {
      "name": "info-version",
      "severity": "error",
      "description": "API version must be present. Add 'info.version'.",
      "category": "required-fields",
      "recommended": true
    }
  ]
}
```

**Query Parameters:**
- `version` - Ruleset version (default: latest)
- `severity` - Filter by severity (error | warn | info | hint)
- `category` - Filter by category (if metadata available)
- `recommended` - Filter by recommended flag (true | false)

### Endpoint 2: Get Rule Details

**Request:**
```http
GET /rulesets/:name/rules/:ruleId
GET /rulesets/:name/rules/:ruleId?version=1.1.0
```

**Response:**
```json
{
  "ruleset": "pubhub",
  "version": "1.1.0",
  "rule": {
    "name": "success-status-code",
    "severity": "error",
    "description": "For every operation in the OAS document, there should be at least one success status code defined. A successful status code is in the 1xx, 2xx or 3xx range series, and generally a 200, 201 or 204.",
    "message": "{{description}}; {{error}}",
    "given": "$.paths.*.*.responses",
    "recommended": true,
    "formats": ["oas3"],
    
    // Extended metadata (if available)
    "examples": [
      "✅ Good:\nresponses:\n  200:\n    description: Success"
    ],
    "fixSuggestion": "Add a 2xx status code to your operation responses",
    "learnMore": "https://pubhub.cisco.com/docs/success-codes",
    "category": "best-practices"
  }
}
```

### Endpoint 3: Search Rules Across Rulesets

**Request:**
```http
GET /rules/search?q=status+code
GET /rules/search?q=operationId&severity=error
```

**Response:**
```json
{
  "query": "status code",
  "matches": [
    {
      "ruleset": "pubhub",
      "version": "1.1.0",
      "rule": "success-status-code",
      "severity": "error",
      "description": "For every operation in the OAS document...",
      "relevance": 0.95
    },
    {
      "ruleset": "spectral-oas",
      "version": "6.11.0",
      "rule": "operation-status-code-defined",
      "severity": "warn",
      "description": "Operation should have status codes defined",
      "relevance": 0.82
    }
  ]
}
```

---

## Data Model

### Core Type: RuleDefinition (Enhanced)

```typescript
export interface RuleDefinition {
  // Core fields (already exist)
  name: string;                     // e.g., "success-status-code"
  rulesetName: string;              // e.g., "pubhub"
  rulesetVersion: string;           // e.g., "1.1.0"
  severity: RuleSeverity;           // error | warn | info | hint
  message: string;                  // Template: "{{description}}; {{error}}"
  description: string;              // ✅ FROM SPECTRAL FILE
  given: string | string[];         // JSONPath: $.paths.*.*.responses
  then: any;                        // Validation logic
  recommended?: boolean;            // Default: true
  formats?: string[];               // e.g., ["oas3"]
  
  // Extended metadata (optional, from rules-extended.yaml)
  examples?: string[];              // Code examples (good/bad)
  fixSuggestion?: string;           // How to fix violations
  learnMore?: string;               // Documentation URL
  category?: string;                // Custom categorization
  tags?: string[];                  // Searchable tags
}
```

### Extended Metadata File Format

**rulesets/metadata/{ruleset}/{version}/rules-extended.yaml:**

```yaml
# Extended metadata for rules (optional)
# Only include rules that need MORE than description from Spectral file

rules:
  success-status-code:
    category: "best-practices"
    tags:
      - "responses"
      - "http-status"
      - "success-codes"
    
    examples:
      - |
        ✅ GOOD:
        responses:
          200:
            description: Success response
          201:
            description: Created
      - |
        ❌ BAD:
        responses:
          400:
            description: Bad request
          500:
            description: Server error
    
    fixSuggestion: |
      Add at least one success status code (2xx, 3xx) to your operation.
      Common choices: 200 (OK), 201 (Created), 204 (No Content).
    
    learnMore: "https://pubhub.cisco.com/guides/http-status-codes"
  
  operation-operationId-valid-in-url:
    category: "naming-conventions"
    tags:
      - "operationId"
      - "url-safety"
    
    examples:
      - |
        ✅ GOOD: operationId: "get-user-profile"
        ❌ BAD:  operationId: "get user profile" (spaces)
    
    fixSuggestion: "Use kebab-case or camelCase for operationId values"
    learnMore: "https://pubhub.cisco.com/guides/operation-ids"

# Rules not listed here use description from Spectral file only
```

---

## Implementation Options

### Option A: Description Only (Simple, Fast)

**Pros:**
- ✅ No new files needed
- ✅ Works immediately (descriptions already extracted)
- ✅ Zero maintenance overhead
- ✅ Single source of truth

**Cons:**
- ❌ Limited to description field only
- ❌ No examples, fix suggestions, or links
- ❌ Less helpful for complex rules

**Implementation:**
```typescript
// src/index.ts
fastify.get<{ Params: { name: string } }>(
  '/rulesets/:name/rules',
  async (request, reply) => {
    const { name } = request.params;
    const version = request.query.version || undefined;
    
    const ruleset = rulesetLoader.getRuleset(name, version);
    
    return {
      ruleset: ruleset.name,
      version: ruleset.version,
      ruleCount: ruleset.rules.length,
      rules: ruleset.rules.map(rule => ({
        name: rule.name,
        severity: rule.severity,
        description: rule.description,
        recommended: rule.recommended
      }))
    };
  }
);
```

### Option B: Description + Optional Extended Metadata (Flexible)

**Pros:**
- ✅ Descriptions from Spectral files (primary source)
- ✅ Extended metadata ONLY when needed (optional)
- ✅ Low maintenance (most rules don't need extended metadata)
- ✅ Future-proof (can add examples/links gradually)

**Cons:**
- ❌ Slightly more complex (two sources to merge)
- ❌ Need to define extended metadata format

**Implementation:**
```typescript
// src/ruleset-loader.ts
class RulesetLoader {
  private extendedMetadata: Map<string, ExtendedRuleMetadata> = new Map();
  
  async initialize() {
    // Load rulesets (existing)
    await this.loadRulesets();
    
    // Load optional extended metadata
    await this.loadExtendedMetadata();
  }
  
  private async loadExtendedMetadata() {
    const metadataDir = path.join(this.baseDir, 'metadata');
    
    // Only load if metadata directory exists
    if (!fs.existsSync(metadataDir)) {
      return; // No extended metadata - OK!
    }
    
    // Load metadata files for each ruleset/version
    // Format: metadata/{ruleset}/{version}/rules-extended.yaml
    // ...
  }
  
  getRuleset(name: string, version?: string): LoadedRuleset {
    const ruleset = this.loadedRulesets.get(key);
    
    // Merge extended metadata if available
    const enhanced = this.enhanceRules(ruleset.rules);
    
    return { ...ruleset, rules: enhanced };
  }
  
  private enhanceRules(rules: RuleDefinition[]): RuleDefinition[] {
    return rules.map(rule => {
      const key = `${rule.rulesetName}:${rule.rulesetVersion}:${rule.name}`;
      const extended = this.extendedMetadata.get(key);
      
      if (!extended) {
        return rule; // No extended metadata - use description only
      }
      
      return {
        ...rule,
        examples: extended.examples,
        fixSuggestion: extended.fixSuggestion,
        learnMore: extended.learnMore,
        category: extended.category,
        tags: extended.tags
      };
    });
  }
}
```

### Option C: Build-Time Generation (Pre-computed)

**Pros:**
- ✅ Zero runtime overhead
- ✅ Can generate rich HTML/Markdown docs
- ✅ Index for fast search

**Cons:**
- ❌ Adds build step complexity
- ❌ Generated files need to be tracked
- ❌ Harder to keep in sync

**Not Recommended** - Option B is better (lazy load at startup).

---

## Maintenance Workflow

### For Ruleset Owners (90% of cases)

**Update rule description in Spectral file:**

```javascript
// rulesets/sources/.../pubhub.js
'success-status-code': {
  // Just update description here - that's it!
  'description': 'Updated description explaining the rule better',
  'message': '{{description}}; {{error}}',
  'severity': 'error',
  // ...
}
```

**No other files to maintain.** Spectify automatically picks up changes on next reload.

### For Complex Rules (10% of cases)

If a rule needs examples, fix suggestions, or links:

**Create optional extended metadata:**

```bash
# Create metadata file
mkdir -p rulesets/metadata/pubhub/1.1.0
nano rulesets/metadata/pubhub/1.1.0/rules-extended.yaml
```

```yaml
rules:
  success-status-code:
    examples:
      - "✅ Good: responses: { 200: ... }"
      - "❌ Bad: responses: { 400: ... }"
    fixSuggestion: "Add a 2xx status code"
    learnMore: "https://example.com/docs"
```

### Update Process

```bash
# 1. Update ruleset source (always)
cd rulesets/sources/.../PubHub-Analyzer/1.1.0
nano devxPublishingRequirements.js  # Update description

# 2. Optionally add extended metadata (if needed)
cd rulesets/metadata/pubhub/1.1.0
nano rules-extended.yaml  # Add examples, links, etc.

# 3. Restart Spectify
npm run build
npm start
# Rules automatically reloaded with new descriptions
```

---

## CLI Integration

### New Commands

```bash
# List all rules in a ruleset
spectify rules pubhub

# List rules with details
spectify rules pubhub --detailed

# Get specific rule
spectify rules pubhub success-status-code

# Search rules
spectify rules --search "status code"

# Filter by severity
spectify rules pubhub --severity error
```

### Example Output

```bash
$ spectify rules pubhub

Ruleset: pubhub (v1.1.0)
Rules: 53 total

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Error Rules (12)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  success-status-code
    For every operation in the OAS document, there should be...
  
  info-version
    API version must be present. Add "info.version".
  
  operation-operationId-valid-in-url
    OperationId must be URL-safe (no spaces, valid characters)

Warning Rules (8)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ...

💡 Get rule details: spectify rules pubhub <rule-name>


$ spectify rules pubhub success-status-code

Rule: success-status-code
Ruleset: pubhub v1.1.0
Severity: error ❌
Category: best-practices

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Description
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For every operation in the OAS document, there should be at 
least one success status code defined. A successful status code 
is in the 1xx, 2xx or 3xx range series, and generally a 200, 
201 or 204.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Examples
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ GOOD:
responses:
  200:
    description: Success response
  201:
    description: Created

❌ BAD:
responses:
  400:
    description: Bad request
  500:
    description: Server error

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
How to Fix
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Add at least one success status code (2xx, 3xx) to your 
operation. Common choices: 200 (OK), 201 (Created), 
204 (No Content).

Learn more: https://pubhub.cisco.com/guides/http-status-codes
```

---

## Timeline

### Phase 1: API Endpoints (2-3 days)
- ✅ Design document (this document)
- ⏳ Add `GET /rulesets/:name/rules` endpoint
- ⏳ Add `GET /rulesets/:name/rules/:ruleId` endpoint
- ⏳ Return rules with descriptions (from Spectral files)
- ⏳ Add query parameters (severity, recommended)
- ⏳ Unit tests
- ⏳ Update API documentation

### Phase 2: Extended Metadata Support (2 days)
- ⏳ Define rules-extended.yaml format
- ⏳ Implement metadata loader
- ⏳ Merge extended metadata with rule definitions
- ⏳ Create example metadata for pubhub ruleset
- ⏳ Documentation for ruleset owners

### Phase 3: CLI Commands (1-2 days)
- ⏳ `spectify rules <ruleset>` command
- ⏳ `spectify rules <ruleset> <rule-id>` command
- ⏳ `spectify rules --search <query>` command
- ⏳ Formatters (table, detailed)
- ⏳ CLI documentation

### Phase 4: Enhanced Results (1 day)
- ⏳ Include rule descriptions in lint results (optional)
- ⏳ Add `--explain` flag to lint command
- ⏳ Format violations with rule descriptions

**Total Estimate:** 6-8 days

---

## The Real Problem: Rulesets Are Not Self-Contained

### Current State (Broken)

```
rulesets/sources/
└── wwwin-github.cisco.com/DevNet/PubHub-Analyzer/1.1.0/
    ├── pubhub.yaml                        # Spectral rules (code)
    ├── devxPublishingRequirements.js      # Spectral rules (code)
    └── pubhubRendering.js                 # Spectral rules (code)

docs/materials/.../reference/analyzers/
├── ruleset-pubhub-readiness.md            # ❌ Separate documentation
└── ruleset-reference.md                   # ❌ Detailed rule docs

# PROBLEMS:
# 1. Documentation created AFTER THE FACT
# 2. Two places to maintain (code + docs)
# 3. Sync issues when rules change
# 4. Can't package ruleset independently
# 5. Documentation not versioned with ruleset
```

### Desired State: Self-Contained Ruleset Packages

```
rulesets/sources/
└── wwwin-github.cisco.com/DevNet/PubHub-Analyzer/
    └── 1.1.0/
        ├── pubhub.yaml                    # Spectral rules (code)
        ├── devxPublishingRequirements.js  # Spectral rules (code)
        ├── pubhubRendering.js             # Spectral rules (code)
        │
        ├── ruleset.json                   # ✅ Metadata (name, version, description)
        ├── README.md                      # ✅ Ruleset overview
        │
        └── rules/                         # ✅ Rule documentation
            ├── success-status-code.md     # Description, examples, mitigation
            ├── info-version.md
            ├── operation-operationId-valid-in-url.md
            └── ...

# BENEFITS:
# 1. Everything in one place
# 2. Single source of truth
# 3. Ruleset is independently distributable
# 4. Documentation versions with code
# 5. Easy to expose via API (just load from package)
```

## Proposed Refactoring: Ruleset Package Structure

### Ruleset Package Format

Each ruleset version should be a complete, self-contained package:

```
{ruleset-name}/{version}/
├── ruleset.json              # Package metadata
├── README.md                 # Overview, usage, configuration
├── pubhub.yaml              # Spectral ruleset file(s)
├── *.js                     # Custom functions
├── functions/               # Helper functions
└── rules/                   # Rule documentation (one file per rule)
    ├── success-status-code.md
    ├── info-version.md
    └── ...
```

### ruleset.json (Package Metadata)

```json
{
  "name": "pubhub",
  "version": "1.1.0",
  "displayName": "PubHub Readiness Analyzer",
  "description": "Evaluates OpenAPI document readiness for developer.cisco.com",
  "source": "wwwin-github.cisco.com/DevNet/PubHub-Analyzer",
  "spectralFiles": [
    "pubhub.yaml",
    "devxPublishingRequirements.js",
    "pubhubRendering.js"
  ],
  "tags": ["publishing", "devnet", "pubhub"],
  "mode": "whole",
  "variants": ["summary", "label"],
  "rulesDirectory": "rules/",
  "documentation": {
    "readme": "README.md",
    "rulesFormat": "markdown"
  }
}
```

### Rule Documentation Format: rules/{rule-name}.md

**Example: rules/success-status-code.md**

```markdown
# success-status-code

**Severity:** error  
**Category:** best-practices  
**OpenAPI Versions:** v2, v3  

## Description

For every operation in the OAS document, there should be at least one success status code defined. A successful status code is in the `1xx`, `2xx` or `3xx` range series, and generally a 200, 201 or 204.

## Why This Matters

Success status codes indicate that an API operation completed successfully. Without them, API consumers cannot determine if their request was processed correctly.

## Compliant Example

```yaml
paths:
  /pets:
    get:
      responses:
        '200':
          description: A list of pets
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Pet'
        '400':
          description: Bad request
```

✅ **Good:** Operation has a 200 success status code.

## Non-Compliant Example

```yaml
paths:
  /pets:
    get:
      responses:
        '400':
          description: Bad request
        '500':
          description: Server error
```

❌ **Bad:** Operation only has error codes, no success status.

## How to Fix

Add at least one success status code (2xx, 3xx) to your operation. Common choices:
- **200 OK**: General success response
- **201 Created**: Resource successfully created
- **204 No Content**: Success with no response body

## Configuration

This rule has no configuration options.

## Learn More

- [HTTP Status Codes (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)
- [REST API Design Guide](https://pubhub.cisco.com/guides/rest-design)
```

---

## Migration Strategy

### Phase 1: Refactor One Ruleset (PubHub)

**Goal:** Establish the pattern with one ruleset

1. **Create ruleset package structure:**
   ```bash
   cd rulesets/sources/.../PubHub-Analyzer/1.1.0
   mkdir rules
   echo '{"name":"pubhub","version":"1.1.0",...}' > ruleset.json
   ```

2. **Extract rule documentation from existing markdown:**
   - Source: `docs/materials/.../ruleset-reference.md`
   - Create: `rules/success-status-code.md`, etc.
   - One markdown file per rule

3. **Update RulesetLoader to load rule docs:**
   ```typescript
   async loadRuleDocumentation(rulesetDir: string): Promise<Map<string, RuleDoc>> {
     const rulesDir = path.join(rulesetDir, 'rules');
     // Load all .md files
     // Parse frontmatter + markdown
     // Return Map<ruleName, RuleDoc>
   }
   ```

4. **Validate:**
   - All rules have documentation files
   - API can serve rule docs
   - CLI can display rule details

### Phase 2: Apply Pattern to All Rulesets

**Goal:** Migrate all rulesets to package format

1. **For each ruleset:**
   - Create `ruleset.json`
   - Create `rules/` directory
   - Extract docs from `docs/materials/.../`
   - Move docs into `rules/{rule-name}.md`

2. **Deprecate old documentation:**
   - Keep `docs/materials/` as historical reference
   - Mark as deprecated in favor of ruleset packages
   - Update links to point to new location

3. **Update documentation:**
   - Document ruleset package format
   - Provide migration guide for ruleset owners
   - Update RULESET_MANAGEMENT.md

### Phase 3: Enable Distribution

**Goal:** Rulesets are independently distributable packages

1. **Package validation:**
   - Script to validate ruleset package structure
   - Check all rules have documentation
   - Verify ruleset.json completeness

2. **Distribution mechanisms:**
   - Git submodules (current)
   - NPM packages (future)
   - Registry API (future)

---

## Updated Implementation Plan

### Option D: Self-Contained Ruleset Packages (RECOMMENDED)

**Pros:**
- ✅ Single source of truth (code + docs together)
- ✅ No duplication
- ✅ Easy to distribute rulesets
- ✅ Documentation versions with code
- ✅ Simple API implementation (load from package)
- ✅ Ruleset owners manage everything in one place

**Cons:**
- ❌ Requires refactoring existing rulesets
- ❌ Migration effort for existing docs
- ❌ Need to define package format

**Implementation:**

1. **Define Ruleset Package Spec** (1 day)
   - ruleset.json schema
   - rules/{rule-name}.md format
   - Package validation rules

2. **Refactor PubHub Ruleset** (2 days)
   - Migrate docs from `docs/materials/` to `rules/`
   - Create ruleset.json
   - Test package structure

3. **Update RulesetLoader** (2 days)
   - Load ruleset.json metadata
   - Load rule documentation from rules/ directory
   - Parse markdown files
   - Build rule index

4. **Add API Endpoints** (1 day)
   - GET /rulesets/:name/rules (return docs from package)
   - GET /rulesets/:name/rules/:ruleId (return specific doc)

5. **CLI Commands** (1 day)
   - spectify rules <ruleset>
   - spectify rules <ruleset> <rule-id>

6. **Migration Guide** (1 day)
   - Document package format
   - Provide migration scripts
   - Update RULESET_MANAGEMENT.md

**Total Estimate:** 8 days (includes refactoring)

---

## Open Questions

1. **Should we migrate all rulesets at once or gradually?**
   - **Recommendation**: Start with PubHub, validate pattern, then migrate others
   - Allows us to refine the format based on real-world experience

2. **Should ruleset.json be generated or manually maintained?**
   - **Recommendation**: Manually maintained (gives ruleset owners control)
   - Could add validation/linting scripts to check completeness

3. **Should rule docs support frontmatter metadata?**
   ```markdown
   ---
   severity: error
   category: best-practices
   openapi: [v2, v3]
   ---
   # success-status-code
   ...
   ```
   - **Recommendation**: Yes, makes parsing easier and allows rich metadata

4. **Where should shared assets live (images, diagrams)?**
   - **Recommendation**: `{ruleset}/{version}/assets/` directory
   - Reference in markdown as `./assets/diagram.png`

5. **Should we keep docs/materials/ as legacy documentation?**
   - **Recommendation**: Keep as historical reference, mark as deprecated
   - Add redirect/warning: "Documentation moved to ruleset packages"

---

## Refactoring Considerations

### Current Pain Points

**1. Documentation Drift**
- Developers update Spectral rules but forget to update markdown docs
- Description in code vs description in docs can differ
- No automated validation of doc completeness

**2. Maintenance Burden**
- Two repositories to update (ruleset repo + docs repo)
- Different stakeholders (ruleset owners vs doc writers)
- Pull requests in multiple places

**3. Version Mismatch**
- Ruleset version 1.1.0 might reference docs for 1.0.0
- No guarantee docs exist for all rule versions
- Hard to track which docs match which code

**4. Distribution Challenges**
- Can't package ruleset independently
- External users can't get docs with ruleset
- Need centralized doc server to serve docs

**5. Discovery Issues**
- Developers don't know where to find rule docs
- CLI/API can't easily locate documentation
- No standard format or location

### Refactoring Goals

1. **Co-location**: Rules and documentation in same directory
2. **Versioning**: Documentation versions with ruleset code
3. **Automation**: Generate rule index automatically
4. **Distribution**: Package includes everything needed
5. **Discoverability**: Standard location and format
6. **Validation**: Automated checks for doc completeness

### Backward Compatibility

**What to Preserve:**
- ✅ Existing Spectral rule files (pubhub.yaml, *.js)
- ✅ RulesetLoader interface
- ✅ API response formats (add docs, don't break existing)
- ✅ Git submodule structure (rulesets/sources/...)

**What Can Change:**
- ✅ Add new files (ruleset.json, rules/*.md, README.md)
- ✅ Add new fields to API responses (documentation)
- ✅ Add new API endpoints (GET /rulesets/:name/rules/:ruleId)
- ✅ Deprecate docs/materials/ (keep for reference)

**Migration Impact:**
- ⚠️ Ruleset owners need to add documentation files
- ⚠️ Old docs become stale (mark as deprecated)
- ⚠️ CI/CD pipelines may need updates
- ✅ Existing API clients continue to work

---

## Implementation Plan (Detailed)

### Phase 0: Preparation (1-2 days)

**Goal:** Define standards and create tooling foundation

**Tasks:**

1. **Define Ruleset Package Specification**
   - Create `docs/RULESET_PACKAGE_SPEC.md`
   - Document required files: ruleset.json, README.md, rules/
   - Define ruleset.json JSON schema
   - Define rules/*.md markdown template
   - Document frontmatter format

2. **Create Validation Scripts**
   ```bash
   scripts/
   ├── validate-ruleset-package.sh     # Validate package structure
   ├── extract-rule-names.sh           # List all rules in Spectral files
   └── check-rule-docs-completeness.sh # Check all rules have docs
   ```

3. **Create Migration Scripts**
   ```bash
   scripts/
   ├── migrate-ruleset-to-package.sh   # Migrate one ruleset
   └── extract-docs-from-reference.sh  # Extract from docs/materials/
   ```

**Deliverables:**
- ✅ RULESET_PACKAGE_SPEC.md
- ✅ Validation scripts
- ✅ Migration scripts
- ✅ ruleset.json JSON schema

---

### Phase 1: Pilot with PubHub Ruleset (3-4 days)

**Goal:** Refactor PubHub as proof of concept

#### Step 1.1: Create Package Structure (0.5 days)

```bash
cd rulesets/sources/wwwin-github.cisco.com/DevNet/PubHub-Analyzer/1.1.0

# Create directories
mkdir -p rules assets

# Create ruleset.json
cat > ruleset.json <<EOF
{
  "name": "pubhub",
  "version": "1.1.0",
  "displayName": "PubHub Readiness Analyzer",
  "description": "Evaluates OpenAPI document readiness for developer.cisco.com",
  "source": "wwwin-github.cisco.com/DevNet/PubHub-Analyzer",
  "spectralFiles": [
    "pubhub.yaml",
    "devxPublishingRequirements.js",
    "pubhubRendering.js"
  ],
  "tags": ["publishing", "devnet", "pubhub"],
  "mode": "whole",
  "variants": ["summary", "label"],
  "rulesDirectory": "rules/",
  "documentation": {
    "readme": "README.md",
    "rulesFormat": "markdown"
  }
}
EOF

# Create README.md (ruleset overview)
cat > README.md <<EOF
# PubHub Readiness Analyzer

Evaluates OpenAPI documents for readiness to publish on developer.cisco.com.

## Overview
...
EOF
```

#### Step 1.2: Extract Rule Documentation (1 day)

Extract from existing docs and create one markdown file per rule:

```bash
# Source files:
# - docs/materials/.../ruleset-pubhub-readiness.md
# - docs/materials/.../ruleset-reference.md

# Create individual rule docs
cd rules/

# Example: success-status-code.md
cat > success-status-code.md <<EOF
---
severity: error
category: best-practices
openapi: [v2, v3]
recommended: true
---

# success-status-code

## Description

For every operation in the OAS document, there should be at least one success status code defined...

## Why This Matters

...

## Compliant Example

\`\`\`yaml
...
\`\`\`

## Non-Compliant Example

\`\`\`yaml
...
\`\`\`

## How to Fix

...

## Learn More

- [HTTP Status Codes](https://developer.mozilla.org/...)
EOF
```

**Rules to migrate (PubHub has ~12 rules):**
- success-status-code
- tag-capitalization-consistent
- info-version
- typed-enum
- duplicated-entry-in-enum
- operation-parameters
- path-params
- path-not-include-query
- operation-operationId-valid-in-url
- no-eval-in-markdown
- no-script-tags-in-markdown
- short-summaries
- operationId-required-and-unique

#### Step 1.3: Update RulesetLoader (1.5 days)

**Add rule documentation loading:**

```typescript
// src/types.ts
export interface RuleDocumentation {
  name: string;
  severity: RuleSeverity;
  category?: string;
  openapiVersions?: string[];
  recommended?: boolean;
  description: string;
  whyThisMatters?: string;
  compliantExample?: string;
  nonCompliantExample?: string;
  howToFix?: string;
  learnMore?: string[];
}

export interface RulesetPackageMetadata {
  name: string;
  version: string;
  displayName: string;
  description: string;
  source: string;
  spectralFiles: string[];
  tags?: string[];
  mode: 'whole' | 'split';
  variants?: string[];
  rulesDirectory?: string;
  documentation?: {
    readme?: string;
    rulesFormat?: 'markdown' | 'yaml';
  };
}

// src/ruleset-loader.ts
class RulesetLoader {
  private ruleDocumentation: Map<string, RuleDocumentation> = new Map();
  
  async initialize() {
    await this.loadRulesets();
    await this.loadRuleDocumentation(); // New
  }
  
  private async loadRuleDocumentation() {
    for (const [key, ruleset] of this.loadedRulesets) {
      const rulesetDir = this.getRulesetDirectory(ruleset);
      
      // Check if ruleset package exists
      const metadataPath = path.join(rulesetDir, 'ruleset.json');
      if (!fs.existsSync(metadataPath)) {
        logger.debug(`No ruleset.json for ${key}, skipping docs`);
        continue;
      }
      
      // Load ruleset package metadata
      const metadata: RulesetPackageMetadata = JSON.parse(
        await fs.promises.readFile(metadataPath, 'utf-8')
      );
      
      // Load rule documentation
      const rulesDir = path.join(rulesetDir, metadata.rulesDirectory || 'rules');
      if (!fs.existsSync(rulesDir)) {
        logger.warn(`Rules directory not found: ${rulesDir}`);
        continue;
      }
      
      const docFiles = await fs.promises.readdir(rulesDir);
      for (const file of docFiles) {
        if (!file.endsWith('.md')) continue;
        
        const ruleName = path.basename(file, '.md');
        const docPath = path.join(rulesDir, file);
        const doc = await this.parseRuleDocumentation(docPath);
        
        const docKey = `${ruleset.name}:${ruleset.version}:${ruleName}`;
        this.ruleDocumentation.set(docKey, doc);
      }
    }
  }
  
  private async parseRuleDocumentation(filePath: string): Promise<RuleDocumentation> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    
    // Parse frontmatter (YAML)
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    const frontmatter = frontmatterMatch 
      ? yaml.parse(frontmatterMatch[1]) 
      : {};
    
    // Parse markdown sections
    const markdown = frontmatterMatch 
      ? content.slice(frontmatterMatch[0].length) 
      : content;
    
    const sections = this.extractMarkdownSections(markdown);
    
    return {
      name: frontmatter.name || path.basename(filePath, '.md'),
      severity: frontmatter.severity || 'error',
      category: frontmatter.category,
      openapiVersions: frontmatter.openapi,
      recommended: frontmatter.recommended,
      description: sections.description || '',
      whyThisMatters: sections['why-this-matters'],
      compliantExample: sections['compliant-example'],
      nonCompliantExample: sections['non-compliant-example'],
      howToFix: sections['how-to-fix'],
      learnMore: sections['learn-more']?.split('\n').filter(l => l.trim())
    };
  }
  
  private extractMarkdownSections(markdown: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const lines = markdown.split('\n');
    
    let currentSection = '';
    let currentContent: string[] = [];
    
    for (const line of lines) {
      if (line.startsWith('## ')) {
        if (currentSection) {
          sections[currentSection.toLowerCase().replace(/\s+/g, '-')] = 
            currentContent.join('\n').trim();
        }
        currentSection = line.slice(3).trim();
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }
    
    if (currentSection) {
      sections[currentSection.toLowerCase().replace(/\s+/g, '-')] = 
        currentContent.join('\n').trim();
    }
    
    return sections;
  }
  
  getRuleDocumentation(
    rulesetName: string, 
    rulesetVersion: string, 
    ruleName: string
  ): RuleDocumentation | undefined {
    const key = `${rulesetName}:${rulesetVersion}:${ruleName}`;
    return this.ruleDocumentation.get(key);
  }
  
  getAllRuleDocumentation(
    rulesetName: string, 
    rulesetVersion?: string
  ): RuleDocumentation[] {
    const version = rulesetVersion || this.getDefaultVersion(rulesetName);
    const prefix = `${rulesetName}:${version}:`;
    
    return Array.from(this.ruleDocumentation.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([, doc]) => doc);
  }
}
```

#### Step 1.4: Add API Endpoints (1 day)

```typescript
// src/index.ts

// List rules with documentation
fastify.get<{ 
  Params: { name: string };
  Querystring: { version?: string; severity?: string };
}>(
  '/rulesets/:name/rules',
  async (request, reply) => {
    const { name } = request.params;
    const { version, severity } = request.query;
    
    const ruleset = rulesetLoader.getRuleset(name, version);
    if (!ruleset) {
      return reply.code(404).send({ error: 'Ruleset not found' });
    }
    
    // Get documentation
    const docs = rulesetLoader.getAllRuleDocumentation(name, ruleset.version);
    
    // Merge with rule definitions
    let rules = ruleset.rules.map(rule => {
      const doc = docs.find(d => d.name === rule.name);
      return {
        name: rule.name,
        severity: rule.severity,
        description: doc?.description || rule.description,
        category: doc?.category,
        recommended: rule.recommended,
        // Include basic metadata
      };
    });
    
    // Filter by severity
    if (severity) {
      rules = rules.filter(r => r.severity === severity);
    }
    
    return {
      ruleset: ruleset.name,
      version: ruleset.version,
      ruleCount: rules.length,
      rules
    };
  }
);

// Get specific rule documentation
fastify.get<{ 
  Params: { name: string; ruleId: string };
  Querystring: { version?: string };
}>(
  '/rulesets/:name/rules/:ruleId',
  async (request, reply) => {
    const { name, ruleId } = request.params;
    const { version } = request.query;
    
    const ruleset = rulesetLoader.getRuleset(name, version);
    if (!ruleset) {
      return reply.code(404).send({ error: 'Ruleset not found' });
    }
    
    // Find rule definition
    const rule = ruleset.rules.find(r => r.name === ruleId);
    if (!rule) {
      return reply.code(404).send({ error: 'Rule not found' });
    }
    
    // Get documentation
    const doc = rulesetLoader.getRuleDocumentation(name, ruleset.version, ruleId);
    
    return {
      ruleset: name,
      version: ruleset.version,
      rule: {
        name: rule.name,
        severity: rule.severity,
        description: doc?.description || rule.description,
        message: rule.message,
        given: rule.given,
        recommended: rule.recommended,
        formats: rule.formats,
        
        // Extended documentation (if available)
        category: doc?.category,
        openapiVersions: doc?.openapiVersions,
        whyThisMatters: doc?.whyThisMatters,
        compliantExample: doc?.compliantExample,
        nonCompliantExample: doc?.nonCompliantExample,
        howToFix: doc?.howToFix,
        learnMore: doc?.learnMore
      }
    };
  }
);
```

#### Step 1.5: Validation & Testing (0.5 days)

```bash
# Validate package structure
./scripts/validate-ruleset-package.sh \
  rulesets/sources/.../PubHub-Analyzer/1.1.0

# Check all rules have docs
./scripts/check-rule-docs-completeness.sh \
  rulesets/sources/.../PubHub-Analyzer/1.1.0

# Test API endpoints
curl http://localhost:3003/rulesets/pubhub/rules
curl http://localhost:3003/rulesets/pubhub/rules/success-status-code

# Run unit tests
npm test -- ruleset-loader.test.ts
```

**Success Criteria:**
- ✅ All 12 PubHub rules have documentation files
- ✅ ruleset.json validates against schema
- ✅ RulesetLoader loads documentation successfully
- ✅ API endpoints return rule documentation
- ✅ Validation scripts pass
- ✅ Existing tests still pass

---

### Phase 2: Migrate Remaining Rulesets (3-5 days)

**Goal:** Apply package format to all rulesets

**Rulesets to migrate:**
1. spectral-oas (standard Spectral ruleset)
2. contract (Cisco contract validation)
3. documentation (documentation quality)
4. inclusive-language (inclusive language checker)
5. validation (OpenAPI validation)

**Per-ruleset effort:** ~0.5-1 day each

**Tasks per ruleset:**
1. Create ruleset.json
2. Extract/write rule documentation
3. Create README.md
4. Validate package structure
5. Test API endpoints

**Parallel execution:** Can be done by multiple team members

---

### Phase 3: Update Documentation (1 day)

**Goal:** Document the new package format for ruleset owners

**Tasks:**

1. **Create RULESET_PACKAGE_SPEC.md**
   - Package structure requirements
   - ruleset.json schema
   - Rule documentation format
   - Examples and templates

2. **Update RULESET_MANAGEMENT.md**
   - Add section on package format
   - Migration guide for ruleset owners
   - Link to validation scripts

3. **Deprecate docs/materials/**
   - Add deprecation notice
   - Redirect to ruleset packages
   - Keep as historical reference

4. **Update main README.md**
   - Mention self-contained ruleset packages
   - Link to ruleset package documentation

---

### Phase 4: Tooling & Automation (2 days)

**Goal:** Make package management easy

**Tasks:**

1. **Package Validation CLI**
   ```bash
   spectify validate-ruleset ./rulesets/sources/.../PubHub-Analyzer/1.1.0
   # Checks:
   # - ruleset.json exists and valid
   # - All Spectral files exist
   # - All rules have documentation
   # - Markdown formatting correct
   ```

2. **Documentation Generator (Optional)**
   ```bash
   spectify generate-rule-docs ./rulesets/sources/.../PubHub-Analyzer/1.1.0
   # Generates rule doc stubs from Spectral files
   # Developer fills in examples and explanations
   ```

3. **CI/CD Integration**
   - Add GitHub Actions workflow
   - Validate on every commit
   - Block merge if validation fails

4. **Documentation Preview**
   ```bash
   spectify docs-preview ./rulesets/sources/.../PubHub-Analyzer/1.1.0
   # Starts local server showing formatted docs
   ```

---

### Phase 5: CLI Integration (1 day)

**Goal:** Expose rule documentation via CLI

**Commands:**

```bash
# List rules
spectify rules pubhub

# Show rule details
spectify rules pubhub success-status-code

# Search rules
spectify rules --search "status code"
```

**Implementation:** Use new API endpoints

---

## Rollout Strategy

### Week 1: Foundation
- [ ] Define package specification
- [ ] Create validation scripts
- [ ] Create migration scripts

### Week 2: Pilot
- [ ] Migrate PubHub ruleset
- [ ] Update RulesetLoader
- [ ] Add API endpoints
- [ ] Validate and test

### Week 3: Scale
- [ ] Migrate remaining rulesets
- [ ] Update documentation
- [ ] CI/CD integration

### Week 4: Polish
- [ ] Tooling improvements
- [ ] CLI integration
- [ ] Final validation

---

## Risk Mitigation

### Risk 1: Breaking Changes

**Risk:** Refactoring breaks existing functionality

**Mitigation:**
- ✅ Keep backward compatibility
- ✅ Extensive unit tests
- ✅ Integration tests
- ✅ Gradual rollout (one ruleset at a time)

### Risk 2: Incomplete Documentation

**Risk:** Not all rules get documentation

**Mitigation:**
- ✅ Validation scripts enforce completeness
- ✅ CI/CD blocks merges without docs
- ✅ Migration scripts help extract existing docs
- ✅ Templates make it easy

### Risk 3: Ruleset Owner Resistance

**Risk:** Ruleset owners don't want to maintain docs

**Mitigation:**
- ✅ Show clear benefits (discoverability, distribution)
- ✅ Provide migration assistance
- ✅ Make it easy with tooling
- ✅ Lead by example (PubHub first)

### Risk 4: Documentation Quality

**Risk:** Documentation is low quality or inconsistent

**Mitigation:**
- ✅ Provide templates and examples
- ✅ Documentation review in PRs
- ✅ Validation checks formatting
- ✅ Style guide for consistency

---

## Success Metrics

### Phase 1 Success (PubHub)
- ✅ All 12 rules have complete documentation
- ✅ API endpoints return docs
- ✅ Validation scripts pass
- ✅ Zero regression in existing functionality

### Phase 2 Success (All Rulesets)
- ✅ 100% of rulesets in package format
- ✅ 100% of rules documented
- ✅ docs/materials/ marked as deprecated
- ✅ CI/CD enforces package format

### Overall Success
- ✅ Single source of truth for rules + docs
- ✅ Easy to distribute rulesets
- ✅ Easy to discover rule documentation
- ✅ Automated validation prevents drift
- ✅ Ruleset owners empowered to maintain their packages

---

## Success Criteria

✅ **Functionality**
- Users can list all rules in a ruleset
- Users can get detailed documentation for any rule
- API returns descriptions from Spectral files
- Optional extended metadata works when present

✅ **Usability**
- Clear API documentation
- CLI commands intuitive
- Easy for ruleset owners to maintain

✅ **Performance**
- Rules loaded at startup (no runtime overhead)
- Fast lookup by ruleId
- Minimal memory footprint

✅ **Maintainability**
- Single source of truth (Spectral files)
- Extended metadata optional (low overhead)
- Clear documentation for ruleset owners

---

## References

- [Ruleset Management](../../ruleset-management.md)
- [Spectral Documentation](https://stoplight.io/open-source/spectral)
- [src/types.ts](../../../src/types.ts) - RuleDefinition interface
- [src/ruleset-loader.ts](../../../src/ruleset-loader.ts) - Rule extraction logic
