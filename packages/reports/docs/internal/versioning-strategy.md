# Versioning Strategy

## Overview

Spectify Reports uses a **monorepo approach with version metadata** to track both server and client library versions independently while maintaining a single npm package.

## Version Structure

### Package Version (Server Version)
- **Location:** `package.json` → `version`
- **Scope:** Report Service server API, database schema, infrastructure
- **Follows:** Semantic Versioning 2.0.0
- **Exposed:** Health endpoint, npm registry

### Client Library Version
- **Location:** 
  - `package.json` → `clientVersion` (metadata)
  - `src/client/index.ts` → `CLIENT_VERSION` (exported constant)
- **Scope:** ReportServiceClient API surface, client library behavior
- **Follows:** Semantic Versioning 2.0.0
- **Exposed:** Health endpoint, exported constant, client status

## Semantic Versioning Rules

### Server Version (Main Package)

**MAJOR** (x.0.0) - Breaking changes to:
- API endpoint contracts (request/response schemas)
- Database schema (requires migration)
- Authentication mechanism
- Configuration structure

**MINOR** (0.x.0) - Backward-compatible additions:
- New API endpoints
- New optional configuration parameters
- New database indexes (non-breaking)
- New features (Web UI pages, etc.)

**PATCH** (0.0.x) - Backward-compatible fixes:
- Bug fixes
- Performance improvements
- Documentation updates
- Internal refactoring

### Client Library Version

**MAJOR** (x.0.0) - Breaking changes to:
- `ReportServiceClient` constructor signature
- Public method signatures
- Required configuration parameters
- Behavior changes affecting integrations

**MINOR** (0.x.0) - Backward-compatible additions:
- New optional methods
- New optional configuration parameters
- New exported types/interfaces
- Feature additions

**PATCH** (0.0.x) - Backward-compatible fixes:
- Bug fixes in retry logic
- Performance improvements
- Internal refactoring

## Version Compatibility Matrix

| Server Version | Client Version | Compatibility |
|----------------|----------------|---------------|
| 0.1.x          | N/A            | No client yet |
| 0.2.0          | 1.0.0          | ✅ Compatible |
| 0.2.1+         | 1.0.x          | ✅ Compatible |
| 0.3.x          | 1.0.x          | ✅ Compatible |
| 1.0.0+         | 1.x.x          | ✅ Compatible |
| 1.0.0+         | 2.x.x          | ⚠️ Check release notes |

**Server declares compatibility:** Health endpoint includes `clientLibrary.compatible` field with semver range.

## Version Checking

### Health Endpoint Response

```json
{
  "status": "ok",
  "timestamp": "2026-02-04T10:30:00Z",
  "server": {
    "version": "0.2.1",
    "environment": "production",
    "uptime": 3600,
    "nodeVersion": "v18.20.0"
  },
  "clientLibrary": {
    "version": "1.0.0",
    "compatible": "^1.0.0"
  },
  "database": {
    "connected": true,
    "type": "sqlite",
    "totalJobs": 1234,
    "oldestJob": "2026-01-01T00:00:00Z",
    "newestJob": "2026-02-04T09:00:00Z"
  },
  "storage": {
    "dbSizeBytes": 52428800,
    "pendingNotifications": 0
  },
  "features": {
    "authEnabled": true,
    "retryEnabled": true
  }
}
```

### Client Version Check

Spectify (or any integrator) can validate version compatibility:

```typescript
import { ReportServiceClient, CLIENT_VERSION } from 'spectify-reports/client';

const client = new ReportServiceClient({ url, apiKey });
await client.initialize();

// Check versions
const health = await fetch(`${url}/health`).then(r => r.json());
console.log(`Server: ${health.server.version}, Client: ${CLIENT_VERSION}`);

// Validate compatibility
if (!semver.satisfies(CLIENT_VERSION, health.clientLibrary.compatible)) {
  console.warn(`Client ${CLIENT_VERSION} may not be compatible with server ${health.server.version}`);
}
```

## Release Process

### Releasing Server Changes

1. Update `package.json` → `version` (semver)
2. Update `CHANGELOG.md` with changes
3. Run tests: `npm test`
4. Build: `npm run build`
5. Commit: `git commit -m "chore: Release v0.x.x"`
6. Tag: `git tag v0.x.x`
7. Push: `git push --tags`

### Releasing Client Changes

1. Update `package.json` → `clientVersion` (semver)
2. Update `src/client/index.ts` → `CLIENT_VERSION`
3. Update server compatibility range in health endpoint if needed
4. Update `CHANGELOG.md` with client changes
5. Follow server release process above

### Breaking Change Example

**Scenario:** Client library v2.0.0 requires server v0.3.0+

```json
// package.json
{
  "version": "0.3.0",
  "clientVersion": "2.0.0"
}
```

```typescript
// Health endpoint compatibility update
clientLibrary: {
  version: "2.0.0",
  compatible: "^2.0.0"  // ← Server now requires client 2.x
}
```

## Migration Guide

### When to Bump Server Version

| Change | Version Bump | Example |
|--------|--------------|---------|
| New Web UI page | MINOR (0.x.0) | 0.2.1 → 0.3.0 |
| Fix retry bug | PATCH (0.0.x) | 0.2.1 → 0.2.2 |
| Change DB schema | MAJOR (x.0.0) | 0.2.1 → 1.0.0 |
| Add optional config | MINOR (0.x.0) | 0.2.1 → 0.3.0 |

### When to Bump Client Version

| Change | Version Bump | Example |
|--------|--------------|---------|
| Add new method | MINOR (0.x.0) | 1.0.0 → 1.1.0 |
| Fix retry logic | PATCH (0.0.x) | 1.0.0 → 1.0.1 |
| Change constructor | MAJOR (x.0.0) | 1.0.0 → 2.0.0 |
| Add optional param | MINOR (0.x.0) | 1.0.0 → 1.1.0 |

### Both Versions Bump Together

When a change affects both server and client:
- Bump **both** versions according to their respective rules
- Document the relationship in CHANGELOG
- Update compatibility matrix

**Example:**
```
Server: 0.2.1 → 0.3.0 (added new endpoint)
Client: 1.0.0 → 1.1.0 (added method to call new endpoint)
```

## Deprecation Policy

### Server API Deprecation

1. Mark endpoint as deprecated in OpenAPI spec (future)
2. Add deprecation warning to response headers
3. Maintain for at least 2 MINOR versions
4. Remove in next MAJOR version

### Client API Deprecation

1. Mark method with `@deprecated` JSDoc
2. Log warning when called
3. Maintain for at least 2 MINOR versions
4. Remove in next MAJOR version

## Version History

| Date | Server | Client | Notes |
|------|--------|--------|-------|
| 2026-02-04 | 0.1.0 | - | Phase 1: Foundation |
| 2026-02-04 | 0.2.0 | 1.0.0 | Phase 2: Client library |
| 2026-02-04 | 0.2.1 | 1.0.0 | Phase 2.5: Tests |
| 2026-02-04 | 0.2.2 | 1.0.0 | Enhanced health endpoint |

## Future Considerations

### Separate Packages (If Needed Later)

If the project grows significantly, consider splitting:

```
@spectify/reports-server@1.0.0
@spectify/reports-client@2.0.0
```

**Migration Path:**
1. Create separate repos
2. Publish both packages
3. Update imports in consuming projects
4. Deprecate old unified package

**Not needed now** - monorepo approach is simpler for current scope.
