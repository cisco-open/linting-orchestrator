# Ruleset curation guide for product managers

Audience: a product manager (PM) or tech lead who owns one or more
Spectral rulesets on behalf of an organisation and is responsible for
making them available to users of the orchestrator.

This guide is not about *writing* Spectral rules — it is about
**curating** them: keeping the source repos healthy, producing release
artifacts, and getting a coherent catalogue in front of users.

There are two distinct activities, and we recommend keeping them
separate:

1. **Maintaining individual rulesets** — one repo per ruleset (or per
   coherent ruleset family).  Owned by the team that writes the rules.
2. **Curating the orchestrator catalogue** — one *catalogue* repo that
   selects which rulesets, and which versions of each, the
   organisation's orchestrator deployment should expose.

The two activities use different tools, have different release
cadences, and should generally have different maintainers (the
catalogue PM picks from what the ruleset teams publish).

---

## 1. Maintaining individual rulesets

### 1.1 Conventions

For each ruleset repo you own, agree on and document the following
conventions up-front:

- **Versioning.**  Use [semver](https://semver.org).  Bump the
  *major* when removing a rule or tightening a rule from `warn` to
  `error`; bump the *minor* when adding a rule or loosening a rule;
  bump the *patch* for message wording, regex tweaks, doc-only
  changes.
- **Branch model.**  `main` is always releasable.  Cut a tag (`vX.Y.Z`)
  for every release.  Never force-push tags.
- **Entrypoint.**  Pick one canonical ruleset file (`ruleset.yaml`,
  `<repo-name>.yaml`, or the package `main` for JS rulesets) and keep
  it stable.  Renaming the entrypoint is a breaking change for every
  downstream catalogue.
- **Custom functions.**  Keep them under `functions/` and write Jest
  tests for each.  Treat the function source as part of the ruleset
  contract — silent behaviour changes in a function are the most
  common source of "the rules suddenly fail differently" incidents.
- **No silent dependency upgrades.**  Pin Spectral and any
  function-side library in `package.json` and commit
  `package-lock.json`.  When you upgrade Spectral, treat it as a
  release.

### 1.2 Use `spectral-catalog` to manage release artifacts

The
[`spectral-catalog`](https://github.com/DevNet/spectral-catalog) CLI
(npm package: `spectral-catalog`, also known as `rulesets-util`) is a
build-time tool for ruleset maintainers.  It does not run inside
the orchestrator — it produces *metadata artifacts* that go alongside each
release.

For every release of a ruleset:

```bash
# One-time, per repo
spectral-catalog config init

# At release time (run inside the ruleset repo)
spectral-catalog catalog generate --catalog-version vX.Y.Z --output dist/vX.Y.Z
spectral-catalog diff dist/vX.Y.Z-1 dist/vX.Y.Z --output dist/vX.Y.Z
spectral-catalog document dist/vX.Y.Z/catalog.json --output dist/vX.Y.Z/docs
```

This produces, under `dist/vX.Y.Z/`:

| File | Purpose |
|---|---|
| `catalog.json` | Machine-readable inventory of every rule with checksums and FQIDs.  Consumed by docs sites, MCP servers, and the catalogue-curation tooling described below. |
| `diff.json` | Structured diff against the previous version. |
| `changelog.md` | Human-readable changelog rendered from the diff. |
| `docs/` | Markdown rule documentation, one page per ruleset plus an index. |

**Recommended practice:**

- Commit `dist/<version>/` for every released version.  It is small,
  text-only, and lets downstream consumers diff history without
  re-running Spectral.
- Run `spectral-catalog catalog generate` as a required CI check on
  pull requests so reviewers can see the rule-level diff before
  merging.
- Use the rendered `changelog.md` as the canonical release note —
  attach it to the GitHub release.

### 1.3 Communicating with consumers

Every ruleset release should answer three questions for the catalogue
PMs who consume it:

1. **What changed?**  → link to `dist/vX.Y.Z/changelog.md`.
2. **Is upgrading safe?**  → semver tells half the story; the diff
   summary (`rulesAdded`, `rulesRemoved`, `instancesModified`) tells
   the rest.
3. **What is the upgrade window?**  → if you intend to deprecate a
   version, announce it in the release note and mark the old version
   `deprecated: true` in your own internal references.

---

## 2. Curating the orchestrator catalogue

A *catalogue* is the set of rulesets — and the specific versions of
each — that a orchestrator deployment exposes.  It is configuration, not
code.

We recommend that each organisation (or each orchestrator deployment)
has **one catalogue repo** owned by a PM whose job is to decide
*what users see*.  That repo is a clone of
[`openapi-rulesets-template`](https://github.com/DevNet/openapi-rulesets-template).

### 2.1 Bootstrapping the catalogue

```bash
# Fork or clone the template
git clone https://github.com/your-org/openapi-rulesets-template.git my-org-rulesets
cd my-org-rulesets

# Remove the example ruleset
rm -rf sources/example
# Edit config/rulesets.yaml to remove the example entry
```

Then, for every ruleset the PM wants to expose:

1. **Copy or vendor the ruleset source** into
   `sources/{sourceRepo}/{sourceVersion}/`.
   *Recommended:* use the same `{domain}/{org}/{repo}/{version}`
   layout that the orchestrator uses internally — it is unambiguous and
   diff-friendly.
2. **Register it** in `config/rulesets.yaml`, picking a stable
   `name` (the public ruleset id that users will type) and listing
   one or more `versions`.
3. **Set a default** under `defaults:` for that ruleset name.

For rulesets that live elsewhere on disk (a separate monorepo
checkout, an OS package, an NFS mount), you can skip vendoring and
use the `absolutePath` field on the version entry instead — see
[ruleset-externalization.md](ruleset-externalization.md) for the full
schema.

#### Classifying each entry: the `origin` field

Every ruleset entry in `config/rulesets.yaml` must declare an
`origin`.  The value classifies *who controls the source files* and
drives both display (`spectify rulesets <name>`) and toolchain
behaviour (`vendor.sh`, `validate.sh`, `install.sh`):

| `origin` | Meaning | Source location |
|---|---|---|
| `embedded` | Rules bundled inside an npm package that the orchestrator already depends on — today: Spectral's built-in rulesets (`spectral:oas`, `spectral:asyncapi`, `spectral:arazzo`). | Inside `node_modules/`; no `sources/` tree is vendored. |
| `internal` | Rules authored and maintained by your team in a repo you control. | `sources/{sourceRepo}/{sourceVersion}/` |
| `external` | Rules sourced from a repository you do **not** own (public OSS, partner, vendor); vendored as a snapshot for reproducibility. | `sources/{sourceRepo}/{sourceVersion}/` |

Decision rule: *who wrote and ships these rules, and where do the
files live?*

1. Bundled inside an npm package the consumer already installs? →
   **`embedded`**.
2. Written by your team, in a repo you control? → **`internal`**.
3. Anything else (public OSS, partner, vendor): → **`external`**.

If you start with `embedded` and later need to **pin a specific
historical version** of those rules (because you don't want to track
whatever ships with the installed npm package), switch the entry's
`origin` to `external` and vendor the snapshot under `sources/` like
any other external ruleset.  Mixing both inside a single entry is
deliberately not supported — pick one model per entry.

#### Required `metadata` fields

Every entry must populate these fields:

| Field | Required | Purpose |
|---|---|---|
| `team` | yes | Owning team name (display) |
| `maintainer` | yes | Person, team, or organisation accountable for the ruleset.  Free-form (`"API Council"`, `"Jane Doe <jane@acme.com>"`, `"Stoplight"`). |
| `contact` | no | URL or `mailto:` for reaching the maintainer (issue tracker, mailing list). |
| `repository` | yes | URL of the source repository. |
| `license` | yes | SPDX identifier. |
| `documentation` | no | URL of user-facing documentation. |

`maintainer` is intentionally required even for `embedded` entries:
it names the upstream (e.g. `"Stoplight"`) so consumers know who to
contact.  `validate.sh` rejects any entry missing `maintainer`.

### 2.2 Verifying the catalogue before deployment

The template ships with two scripts that the PM should run before
publishing any change:

```bash
# 1. Static validation — must pass before merging any PR
bash scripts/validate.sh

# 2. Install per-source npm dependencies (only needed for JS rulesets)
bash scripts/install.sh
```

`validate.sh` checks: YAML syntax, required fields, that every
referenced source path exists, that ruleset names are unique, and
that every `defaults` entry resolves to a known version.  Wire it
into CI as a required check.

For a stronger guarantee that the orchestrator will actually load
each ruleset, the PM can also run the orchestrator locally against the
candidate catalogue:

```bash
# Point the orchestrator at the candidate catalogue
SPECTIFYD_RULESETS_DIR="$PWD" spectifyd &

# List what the orchestrator sees
spectify rulesets

# Lint a representative spec against each ruleset to catch
# any load-time errors that static validation cannot detect
for r in $(spectify rulesets --json | jq -r '.[].name'); do
  spectify lint examples/petstore.yaml --ruleset "$r"
done
```

This is the catalogue PM's equivalent of "compile the project before
releasing".

### 2.3 Producing catalogue-level metadata (optional but recommended)

Just as ruleset maintainers run `spectral-catalog` per ruleset,
catalogue PMs can run it across the catalogue at release time to
produce a single aggregate `catalog.json` that lists every rule
exposed by the deployment.  This is useful for:

- Publishing a docs site that covers the whole catalogue.
- Driving MCP servers / AI agents that need to introspect available
  rules without talking to a running orchestrator.
- Producing release notes that show what changed in the catalogue
  between two versions, even when the underlying ruleset repos did
  not change (e.g., the catalogue switched `pubhub` from `1.1.0` to
  `2.0.0`).

We do not yet ship a one-shot "catalogue-wide generate" command;
for now, run `spectral-catalog catalog generate` per ruleset and
stitch the outputs together, or just publish the per-ruleset
catalogs alongside the catalogue repo.

### 2.4 Deployment models

There is **no auto-update** mechanism inside the orchestrator.  Whoever runs
the orchestrator picks when to adopt a new catalogue version.  Plan
the rollout accordingly:

**Model A — shared orchestrator (one team operates spectifyd for many users)**

The catalogue PM coordinates directly with the operator (often the
same person).  Recommended flow:

1. PM tags a release on the catalogue repo (`vX.Y.Z`).
2. Operator pulls the tag onto the orchestrator host.
3. Operator restarts `spectifyd` (or invokes a future
   cache-refresh API) to pick up the new catalogue.
4. PM announces the new version to users with a link to the
   per-ruleset changelogs that changed.

The Docker deployment model (see
[docker-architecture.md](docker-architecture.md)) makes this a
volume swap + container restart.

**Model B — self-hosted orchestrators (each user runs their own spectifyd)**

The catalogue PM publishes a tagged release and announces it.  Users
choose when to update by re-cloning or `git pull`-ing the catalogue
repo and pointing `SPECTIFYD_RULESETS_DIR` at it.

In neither model does the orchestrator pull updates by itself.  Make this
explicit in the release announcement so users understand they need
to act.

### 2.5 Release cadence and naming

Recommended conventions for the catalogue repo:

- Use semver on the *catalogue* itself, independent of the rulesets
  it contains.
- Patch = a metadata-only change (description, tags).
  Minor = added a ruleset version, bumped a default to a non-breaking
  version, deprecated an old version.
  Major = removed a ruleset, switched a default to a breaking
  version, renamed a ruleset.
- Keep a `CHANGELOG.md` at the catalogue root that records *every*
  change (not just version bumps of the underlying rulesets) — this
  is the document users read to decide whether to upgrade.

---

## 3. Applying this to the Cisco internal catalogue

The Cisco-internal rulesets (pubhub, contract, completeness,
documentation, validation, plus the api-insights rest-guidelines
bundle) used to ship inside the orchestrator package itself.  As of June
2026 they have been externalised (see
[ruleset-externalization.md](ruleset-externalization.md)) and
The orchestrator ships only a minimal `oas-recommended` example.  We need to
re-establish them as a proper internal catalogue using the
methodology above.

### 3.1 Proposed repository layout

| Repo | Role | Owner |
|---|---|---|
| `wwwin-github.cisco.com/DevNet/api-insights-openapi-rulesets` | Ruleset source (rest-guidelines, contract, completeness, documentation, validation).  Already exists. | API Insights team |
| `wwwin-github.cisco.com/DevNet/PubHub-Analyzer` | Ruleset source (pubhub).  Already exists. | PubHub team |
| `wwwin-github.cisco.com/DevNet/spectify-rulesets-cisco` *(new)* | Catalogue repo. Forked from `openapi-rulesets-template`.  Vendors the above ruleset sources, registers them in `config/rulesets.yaml`, sets defaults. | Catalogue PM |

This mirrors the public template structure exactly — there is no
Cisco-specific schema or tooling.  The catalogue PM uses the same
`validate.sh` / `install.sh` scripts and the same `rulesets.yaml`
format that any external team would use.

### 3.2 Per-ruleset hygiene (one-time backfill)

For each existing Cisco ruleset repo:

1. Add `spectral-catalog.config.yaml` (run `spectral-catalog config
   init`).  *PubHub-Analyzer already has this.*
2. Backfill `dist/<version>/catalog.json` for the current released
   version so downstream tooling has something to point at.
3. Add `bash scripts/validate.sh`-equivalent (i.e.,
   `spectral-catalog catalog generate --dry-run`) as a required CI
   check.
4. Document the entrypoint and version conventions in the repo's
   `README.md`.

### 3.3 Bootstrapping `spectify-rulesets-cisco`

1. Clone `openapi-rulesets-template` to create the new repo.
2. Remove the `example/` source and entry.
3. For each Cisco ruleset, vendor a known-good version under
   `sources/{domain}/{org}/{repo}/{version}/` and register it in
   `config/rulesets.yaml`.  Initial entries should pin to the
   versions that were previously bundled (`api-insights@2026-01-30`,
   `pubhub@1.1.0`, etc.) so nothing changes for users on day one.
4. Run `bash scripts/validate.sh` and `bash scripts/install.sh`.
5. Bring up a local `spectifyd` with
   `SPECTIFYD_RULESETS_DIR=$PWD` and confirm `spectify rulesets`
   lists everything previously available.
6. Tag `v1.0.0` — this represents the "lift and shift" of the old
   built-in catalogue.

### 3.4 Ongoing operation

- **Cadence.**  Aim for one catalogue release per quarter, plus
  out-of-band patches when a ruleset team ships a security or
  correctness fix.
- **Source of truth for what users see.**  Once `spectify-rulesets-cisco`
  exists, do not patch rulesets inside the orchestrator build any more.
  Every change to a Cisco-exposed rule goes through:
  upstream ruleset repo → tag → catalogue repo bumps version →
  catalogue tag → operator deploys.
- **Operator.**  The team running the shared Cisco `spectifyd`
  instance(s) — likely the same team that runs the orchestrator
  today — adopts catalogue tags on their own schedule, with the
  catalogue PM nudging them when there is something users have been
  asking for.
- **Visibility.**  Users discover what is available with
  `spectify rulesets`; what changed with the catalogue's
  `CHANGELOG.md`; what each rule does with the per-ruleset
  `dist/*/docs/`.  None of this needs the orchestrator itself to change.

### 3.5 Resolved decisions

- **Visibility.**  `spectify-rulesets-cisco` is **Cisco-internal only**
  (`wwwin-github.cisco.com/DevNet/spectify-rulesets-cisco`).  It will
  not be mirrored to `github.com/cisco-open`.  The underlying ruleset
  repos (`api-insights-openapi-rulesets`, `PubHub-Analyzer`) keep
  whatever visibility they have today.
- **Catalogue PM.**  **Stève Sfartz** (`stsfartz@cisco.com`).  Listed
  as `metadata.team` on every catalogue entry and as the `CODEOWNER`
  on the catalogue repo.
- **Per-project rule overrides.**  Yes, end users will eventually be
  able to lower severity or disable specific rules on a per-project
  basis, but that information lives in the **API Inventory** (where
  projects and their settings are already tracked), *not* in the
  catalogue.  The catalogue's job is "here is the menu"; the API
  Inventory's job is "here is what project X chose from the menu".
  The catalogue design must remain compatible with this — concretely:
  every rule exposed by the catalogue must have a stable FQID
  (`{ruleset}/{rule-name}`) that the API Inventory can reference, and
  the catalogue must not silently rename rules across versions.

---

## Future work

- **Managing Spectral's embedded rulesets.**  See the dedicated note
  [managing-spectral-embedded-rulesets.md](managing-spectral-embedded-rulesets.md):
  how to find the effective version of an `embedded` entry at runtime,
  the recommended quarterly review cadence, when to switch to
  `external` to pin or evaluate, and a proposal for a
  `spectral-rulesets-mirror` catalogue (itself built from the
  template) that publishes a vendorable
  snapshot per upstream patch (1.22.0, 1.22.1, 1.22.2, …) so
  catalogue PMs can test new releases side-by-side without waiting
  for an orchestrator-side Spectral CLI bump.
- **`spectral-catalog` vocabulary alignment.**  ✅ Done in
  [`spectral-catalog` v0.6.0](https://github.com/DevNet/spectral-catalog/blob/main/CHANGELOG.md)
  (catalog schema v1.3.0).  The per-ruleset CLI now emits an optional
  `origin` field (`embedded | internal | external`) on every entry of
  `dependencies` and `compositionGraph.nodes`, alongside the
  pre-existing `resolution` (`referenced | expanded`).  The two are
  orthogonal: `resolution` is the composition strategy, `origin` is
  the provenance of the rules.  The change is additive and
  non-breaking — older v1.2.0 catalogs remain valid.
- **Runtime `resolvedVersion` reporting.**  The orchestrator should
  populate `resolvedVersion` on `embedded` entries by reading the
  installed npm package's `package.json`, and surface it through
  `spectify rulesets <name>` and `/rulesets`.  Schema is in place
  (`package`, `resolvedVersion` on `RulesetVersionConfig`);
  loader/CLI wiring follows.

---

## See also

- [ruleset-externalization.md](ruleset-externalization.md) — the
  architecture and schema that makes external catalogues possible.
- [openapi-rulesets-template](https://github.com/DevNet/openapi-rulesets-template)
  — the template repo to fork.
- [spectral-catalog](https://github.com/DevNet/spectral-catalog) —
  the per-ruleset metadata CLI.
