# npm Registry Strategy

Status: **Resolved — published under `@cisco_open`** · Last updated: 2026-06-30

This document captures the options that were considered for publishing the
three packages to npm, and the fallback plan if the chosen scope could not
host node executables.

> **Naming note — npm scope vs. GitHub org.** The packages publish to npmjs.com
> under the scope **`@cisco_open`** (underscore), whereas the GitHub org is
> **`github.com/cisco-open/...`** (hyphen). The two identifiers differ by that
> single character. Use the underscore form for anything npm-related
> (`npm install`, `package.json` `name`, workspace specifiers) and the hyphen
> form for repository URLs. The one exception is GitHub Packages (Option D
> below), whose registry scope follows the GitHub org name (`@cisco-open`).

---

## Published scope: `@cisco_open`

The packages are published as:

| Package | npm name | Binaries |
|---------|----------|----------|
| Orchestrator | `@cisco_open/linting-orchestrator` | `spectify`, `spectifyd` |
| Reports | `@cisco_open/linting-reports` | `spectifyr` |
| Document store | `@cisco_open/linting-document-store` | — (library) |

The npm scope `@cisco_open` (underscore) mirrors the GitHub org
`github.com/cisco-open/...` (hyphen) as closely as npm naming allows, so
discovery stays consistent across the two registries.

**Resolved blockers:**
- The `@cisco_open` npm org admin allows publishing packages that ship
  node executables (CLI binaries).
- Publish credentials / automation (tokens, 2FA policy) are in place.

---

## Fallback options if `@cisco_open` cannot host CLIs

### Option A: `@spectify` org scope (recommended fallback)

```
npm install -g @spectify/orchestrator
npm install -g @spectify/reports
npm install    @spectify/document-store
```

| Aspect | Detail |
|--------|--------|
| Install UX | Short, memorable: `npm i -g @spectify/orchestrator` |
| Ownership | Create org on npmjs.com (free, instant, first-come) |
| Matches brand | Users already type `spectify` / `spectifyd` / `spectifyr` |
| Discoverability | Clear package-to-binary mapping |
| Drawback | Decouples npm identity from GitHub org — users must know `@spectify/*` ↔ `github.com/cisco-open/openapi-*` |
| Migration cost | Low: one `npm deprecate` + publish under `@cisco_open` later |

**Package names under this option:**

```json
"@spectify/orchestrator"   // bin: spectify, spectifyd
"@spectify/reports"        // bin: spectifyr
"@spectify/document-store" // library
```

### Option B: Personal scope (`@stsfartz` or similar)

```
npm install -g @stsfartz/spectify
```

| Aspect | Detail |
|--------|--------|
| Process | Zero — you own your npm user scope already |
| Good for | Soft-launch, testing publish pipeline before going official |
| Drawback | Looks personal / unofficial for an open-source project |
| Drawback | Ownership transfer awkward if maintainers change |
| Drawback | Longer install command |

Recommended only as a temporary testing step, not for the final
public identity.

### Option C: Unscoped package names

```
npm install -g spectify
```

| Aspect | Detail |
|--------|--------|
| Install UX | Shortest possible |
| Availability | Must check `npm info spectify` — may be taken |
| Drawback | No namespace protection; squatting risk |
| Drawback | Cannot be migrated to a scoped name later without a breaking change (consumers must update `package.json`) |
| Drawback | Harder to associate with the GitHub org |

### Option D: GitHub Packages (`npm.pkg.github.com`)

```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com"
}
```

Users must add to their `.npmrc`:
```
@cisco-open:registry=https://npm.pkg.github.com
```

| Aspect | Detail |
|--------|--------|
| Tied to org | Automatically scoped to `cisco-open` |
| No separate npm org approval | Publishes to GitHub's registry |
| Drawback | Breaks default `npm install` UX — users must configure `.npmrc` |
| Drawback | GitHub Packages has had reliability and performance issues |
| Drawback | Not indexable on npmjs.com search |
| Drawback | Global CLI installs become confusing with registry config |

Not recommended for CLIs that users install globally.

### Option E: Source-only (no npm publish)

```bash
npm install -g github:cisco-open/linting-orchestrator
```

| Aspect | Detail |
|--------|--------|
| Process | Zero registry dependency |
| Drawback | No version resolution, no semver ranges in dependents |
| Drawback | Slow (clones full repo on each install) |
| Drawback | Cannot be a clean transitive dependency |
| Drawback | No `npx spectify` support |

Acceptable only as an interim measure while waiting for registry
access, not as a permanent solution.

### Option F: Dual-publish (Cisco scope for libraries, separate scope for CLIs)

```
@cisco_open/linting-document-store   → library (no bin), under Cisco scope
@spectify/cli                        → umbrella CLI package with all 3 binaries
```

| Aspect | Detail |
|--------|--------|
| Separation | Libraries live under official Cisco scope |
| CLI brand | Gets the short memorable `@spectify/cli` |
| Drawback | Extra package to maintain |
| Drawback | More confusing dependency graph |

---

## Recommendation

1. **Ask for `@cisco_open` first.** It's the plan, and org alignment
   is the cleanest setup.

2. **If the answer is "no CLIs" or "takes months":**
   - Create `@spectify` on npmjs.com immediately (free, instant).
   - Publish as `@spectify/orchestrator`, `@spectify/reports`,
     `@spectify/document-store`.
   - Document in each `package.json` and in this file that a scope
     migration to `@cisco_open` is planned.

3. **When `@cisco_open` becomes available:**
   - `npm deprecate @spectify/orchestrator "moved to @cisco_open/linting-orchestrator"`
   - Publish under the new scope.
   - Update README install instructions.
   - One-line change in each `package.json`.

The cost of a scope migration later is **low** (deprecation notice +
one publish + README update). The cost of waiting months with no
public package is **high** if you want early community adoption.

---

## Publishing checklist (once scope is confirmed)

- [ ] Add `"files"` field to each `package.json` (whitelist what ships)
- [ ] Add `"publishConfig": { "access": "public" }` to each package
- [ ] Verify `npm pack --dry-run` produces a reasonable tarball size
- [ ] Set up npm automation token or use `npm publish --otp`
- [ ] Tag the release: `git tag v1.0.0-rc.1`
- [ ] Publish in topological order: document-store → reports → orchestrator
- [ ] Verify: `npx @<scope>/spectify --version`
- [ ] Update `README.md` install instructions with final scope

---

## References

- [opensourcing.md](opensourcing.md) — full open-source rollout plan
- Decision #6 in opensourcing.md: npm scope resolved to `@cisco_open`
- Decision #14 in opensourcing.md: hybrid workspace → publish path
