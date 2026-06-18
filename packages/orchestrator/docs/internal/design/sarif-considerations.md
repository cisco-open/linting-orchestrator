## 1) Walk through a real SARIF example

Here’s a small-but-realistic SARIF 2.1.0 file that reports **one finding** (“hardcoded password”) in a repo.

```json
{
  "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ExampleSAST",
          "informationUri": "https://example.com/examplesast",
          "version": "1.2.3",
          "rules": [
            {
              "id": "EXSAST001",
              "name": "hardcoded-password",
              "shortDescription": { "text": "Hardcoded credential" },
              "fullDescription": {
                "text": "Detects hardcoded credentials in source code."
              },
              "helpUri": "https://example.com/rules/EXSAST001",
              "defaultConfiguration": { "level": "error" },
              "properties": {
                "tags": ["security", "credentials"],
                "securitySeverity": "9.0"
              }
            }
          ]
        }
      },
      "artifacts": [
        {
          "location": { "uri": "src/auth/login.js" },
          "roles": ["analysisTarget"]
        }
      ],
      "results": [
        {
          "ruleId": "EXSAST001",
          "level": "error",
          "message": {
            "text": "Possible hardcoded password assigned to variable 'pwd'."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "src/auth/login.js" },
                "region": {
                  "startLine": 42,
                  "startColumn": 13,
                  "endLine": 42,
                  "endColumn": 41,
                  "snippet": { "text": "const pwd = \"P@ssw0rd123\";" }
                }
              }
            }
          ],
          "fingerprints": {
            "primaryLocationLineHash": "6c4b6d2d86c2d7b6"
          }
        }
      ]
    }
  ]
}
```

### What’s going on, line-by-line (conceptually)

* **`version`**: SARIF version (2.1.0 is the common one).
* **`runs[]`**: One “execution” of a tool. A SARIF file can contain multiple runs (e.g., different tools, or same tool with different configs).
* **`tool.driver`**: The reporting tool metadata.
* **`tool.driver.rules[]`**: The *catalog* of rules this tool can report.

  * `id`: the stable rule identifier used by findings (`ruleId`).
  * `defaultConfiguration.level`: default severity (“error”, “warning”, “note”, “none”).
  * `properties`: a flexible place for extra info (tags, CWE, severity score, etc.).
* **`artifacts[]`**: The files involved in the run; can include hashes, MIME type, etc.
* **`results[]`**: The actual findings.

  * `ruleId`: points back to the rule definition.
  * `level`: the severity for *this* instance (can differ from default).
  * `message.text`: human readable.
  * `locations[]`: where the issue is (file URI + region line/col + snippet).
  * `fingerprints`: stable-ish IDs used to dedupe findings across runs (useful for “this is the same issue as last week”).

### 3 practical tips when you produce SARIF

1. **Keep rule IDs stable** (don’t rename every release), or your trend/dedupe will be noisy.
2. **Populate regions/snippets** when possible—this is what makes results “developer-friendly” in UIs.
3. **Use fingerprints** for tracking, but don’t rely on a single scheme—combine a few (path+rule+normalized snippet hash, etc.).

---

## 2) How SARIF fits into LLM-based quality agents in a doc or API pipeline

Think of SARIF as your **common “issue envelope”**. LLM agents become *producers* (and optionally *triagers/fixers*) of issues, but SARIF is how you **ship the results** into existing ecosystems (GitHub code scanning, dashboards, PR annotations, etc.).

### A clean architecture pattern

**Pipeline stages (typical):**

1. **Collect artifacts**

   * Markdown docs, OpenAPI specs, changelogs, examples, SDK snippets.
2. **Deterministic checks first**

   * Linters (Spectral, redocly lint, markdownlint, style rules).
3. **LLM-based agents**

   * Heuristics and semantic checks that deterministic tools can’t do well.
4. **Unify outputs**

   * Convert everything to **SARIF** (including deterministic tools if they don’t already output it).
5. **Publish**

   * Upload SARIF to your scanner UI, annotate PRs, create tickets, run quality gates.

### What LLM agents can report as SARIF findings

In your world (docs + OpenAPI governance), agents can generate findings like:

* **OpenAPI**

  * “Operation summary not verb-first / >7 words”
  * “Breaking change not documented in changelog”
  * “Inconsistent error model across operations”
  * “Security scheme described but not applied to endpoints”
  * “Pagination semantics unclear / missing”
* **Docs**

  * “Example contradicts schema”
  * “Prerequisite missing (auth scopes not mentioned)”
  * “Unclear/misleading parameter description”
  * “Non-actionable error section”
  * “Tone/style violation (corporate standards)”

Each becomes a SARIF `result` with:

* `ruleId`: like `DOCS_SUMMARY_VERB` or `OAS_SECURITY_APPLIED`
* `level`: warning/error/note
* `message.text`: short and clear
* `locations`: file + line range (for Markdown and YAML you usually can locate)
* optional `properties`: confidence score, model name, prompt version, policy name, etc.

### Two important design choices

#### A) Don’t let the LLM invent rule catalogs

Create a **controlled rule registry** in your system and map agent output to it.

* Rule IDs are governance assets.
* You can version them like `API_SUMMARY_VERB@1` or store `properties.ruleVersion`.

This prevents “agent drift” from exploding your taxonomy.

#### B) Separate “detection” from “fix suggestion”

SARIF supports optional `fixes`, but you may want:

* First pass: agent produces **finding only**
* Second pass (optional): a “fixer” agent proposes edits (PR comment, patch, or suggestion)

This is safer and easier to gate.

### A practical “agent → SARIF” mapping

**Agent output (internal JSON)**

```json
{
  "ruleId": "API_SUMMARY_VERB",
  "severity": "warning",
  "confidence": 0.78,
  "file": "openapi.yaml",
  "startLine": 315,
  "endLine": 315,
  "message": "Summary should start with a verb and be <= 7 words.",
  "evidence": "summary: \"User profile retrieval\"",
  "suggestion": "Use: \"Retrieve user profile\""
}
```

**Converted SARIF `result`**

* `ruleId`: `"API_SUMMARY_VERB"`
* `level`: `"warning"`
* `message.text`: your message
* `locations[0].physicalLocation.region`: line(s) + snippet
* `properties`: include `confidence`, `agent`, `model`, `policyPack`, `promptId`

### Quality gates with SARIF (what to fail the build on)

Because LLMs are probabilistic, a good gating strategy is:

* **Block merge only on:**

  * deterministic errors, OR
  * LLM findings with `confidence >= X` *and* severity `error`
* **Report (non-blocking) on:**

  * medium confidence warnings
* **Always keep an audit trail:**

  * prompt version, model, timestamp, policy pack

SARIF’s `properties` fields are perfect for that.

### Where this shines

* One unified reporting channel for:

  * redocly/spectral results
  * your custom OpenAPI checks
  * LLM semantic checks
* Your PR UI / dashboards don’t care who produced the issue.
* You can trend quality over time by ruleId + fingerprint.

---

If you want something concrete next: I can sketch a **minimal SARIF schema for your doc/API rule registry**, including rule IDs that match your “summary must be verb-first and <7 words” policy, and show exactly how you’d encode a few findings from an OpenAPI YAML with line locations.
