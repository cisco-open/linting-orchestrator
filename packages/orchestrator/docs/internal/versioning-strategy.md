# Versioning Strategy

Spectify uses **independent versioning** for its two main components:

## Components

### 1. API Server (v0.5.0+)
**Location:** `src/index.ts`, `src/orchestrator.ts`, `src/worker-pool.ts`, etc.  
**Version Constant:** `API_VERSION` in `src/version.ts`  
**Changelog:** [CHANGELOG.md](../CHANGELOG.md) (root)

**Covers:**
- HTTP API endpoints (POST /lint, GET /documents, etc.)
- Job orchestration and task distribution
- Worker pool management
- Storage adapters (memory, Redis)
- Document store integration
- Ruleset loading and management

**Version displayed:**
- Startup banner: "Spectify API Server v0.5.0"
- GET /health response: `{ "version": "0.5.0", ... }`

### 2. CLI (v0.3.0+)
**Location:** `src/cli/`  
**Version Constant:** `CLI_VERSION` in `src/version.ts`  
**Changelog:** [src/cli/CHANGELOG.md](../src/cli/CHANGELOG.md)

**Covers:**
- Command-line interface (`spectify` command)
- Commands: lint, status, results, history, rulesets, health
- Terminal output formatting
- History management
- API client wrapper

**Version displayed:**
- `spectify --version` → "0.3.0"

## Why Independent Versioning?

**Benefits:**
1. **Clear Communication**: Users know if API or CLI changed
2. **Flexibility**: CLI can evolve faster without bumping API version
3. **Backward Compatibility**: API v0.5.0 works with CLI v0.3.0 or v0.4.0
4. **Focused Changes**: Breaking changes in one component don't force major bump in other

**Examples:**
- **CLI UX improvement** (new colors, better formatting) → CLI v0.3.1 (API stays v0.5.0)
- **New API endpoint** → API v0.6.0 (CLI stays v0.3.0 if not using new endpoint)
- **Breaking API change** → API v1.0.0 + CLI v0.4.0 (CLI updated to use new API)

## Semantic Versioning Rules

### API Server (Breaking Changes)
- **MAJOR**: Remove/rename endpoints, change response structure, remove features
  - Example: Remove GET /jobs endpoint → v0.5.0 → v1.0.0
- **MINOR**: Add new endpoints, add optional parameters, new features
  - Example: Add POST /documents → v0.4.0 → v0.5.0
- **PATCH**: Bug fixes, performance improvements, documentation
  - Example: Fix worker crash bug → v0.5.0 → v0.5.1

### CLI (Breaking Changes)
- **MAJOR**: Remove commands, change command syntax, remove flags
  - Example: Rename `spectify check` to `spectify status` → v0.3.0 → v1.0.0
- **MINOR**: Add new commands, add new flags, new features
  - Example: Add `spectify export` command → v0.3.0 → v0.4.0
- **PATCH**: Bug fixes, formatting improvements, documentation
  - Example: Fix color rendering on Windows → v0.3.0 → v0.3.1

## Version Compatibility Matrix

| API Version | Compatible CLI Versions | Notes |
|-------------|------------------------|-------|
| v0.5.0      | v0.3.0+                | Upload endpoints added |
| v0.4.0      | v0.3.0+ (broken standalone) | No upload endpoints |
| v0.3.0      | v0.3.0+                | Initial release |

**Recommendation:** Keep API and CLI versions in sync for best experience, but not required.

## Package Version

The npm package version (`package.json`) typically matches the **latest component version**:

```json
{
  "name": "spectify",
  "version": "0.5.0"  // Matches API_VERSION (latest change)
}
```

**When to bump package version:**
- Bump to highest component version after any release
- Example: API v0.5.0 + CLI v0.3.0 → package v0.5.0
- Example: API v0.5.0 + CLI v0.4.0 → package v0.5.0 (or v0.5.1 if released together)

## Release Process

### 1. Determine What Changed
- API changes? Update `API_VERSION` and root `CHANGELOG.md`
- CLI changes? Update `CLI_VERSION` and `src/cli/CHANGELOG.md`
- Both? Update both versions and changelogs

### 2. Update Version Constants
Edit `src/version.ts`:
```typescript
export const API_VERSION = '0.6.0';  // If API changed
export const CLI_VERSION = '0.4.0';  // If CLI changed
export const PACKAGE_VERSION = '0.6.0';  // Highest version
```

### 3. Update Package Version
Edit `package.json`:
```json
{
  "version": "0.6.0"  // Match PACKAGE_VERSION
}
```

### 4. Update Changelogs
- Move entries from [Unreleased] to new version section
- Add release date
- Add comparison link

### 5. Commit and Tag
```bash
git add src/version.ts package.json CHANGELOG.md src/cli/CHANGELOG.md
git commit -m "chore: release API v0.6.0 + CLI v0.4.0"
git tag v0.6.0
git push origin main --tags
```

### 6. Publish (if applicable)
```bash
npm publish
```

## Version Display Examples

### API Server Startup
```
🚀 Starting Lint Orchestrator...

✅ Configuration loaded
✅ Storage initialized
✅ Ruleset loader initialized
✅ Document store initialized
✅ Worker pool initialized
✅ Orchestrator initialized

✅ Spectify API Server v0.5.0
   HTTP API listening on http://0.0.0.0:3003

Available endpoints:
  POST   /documents               - Upload OpenAPI document
  ...
  GET    /health                   - Health check

🎯 Ready to accept lint requests!
```

### CLI Version Command
```bash
$ spectify --version
0.3.0

$ spectify health
✔ Spectify API Server is healthy
  Version: 0.5.0
  Uptime: 2h 15m
```

### Health Check Response
```json
{
  "status": "ok",
  "version": "0.5.0",
  "timestamp": "2025-12-18T10:30:00.000Z",
  "stats": {
    "totalJobs": 42,
    "activeWorkers": 8
  }
}
```

## Migration Notes

**Before:** Single version for entire project  
**After:** Separate API and CLI versions

**No breaking changes for users:**
- `spectify --version` still works (shows CLI version)
- GET /health still works (now includes API version)
- Package version still valid for npm installs

## Future Considerations

### When to Merge Versions?
If API and CLI become tightly coupled (e.g., CLI requires specific API features), consider:
- Synchronized versioning (both bump together)
- Minimum API version check in CLI
- Compatibility matrix in documentation

### Additional Components?
If adding more components (e.g., web UI, SDK), consider:
- `WEB_VERSION` for web interface
- `SDK_VERSION` for client SDKs
- Separate changelogs for each: `docs/WEB_CHANGELOG.md`, `docs/SDK_CHANGELOG.md`

## References

- [Semantic Versioning 2.0.0](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [API Versioning Best Practices](https://blog.restcase.com/restful-api-versioning-insights/)
