/**
 * Reproduction Markdown Generator
 * 
 * Generates step-by-step Markdown instructions for reproducing an orchestrator
 * lint job using only the native Spectral CLI.
 */

import type { LintJobResult, RulesetSourceMetadata, RuleOverrides } from '../types.js';

/**
 * Determine the git checkout target from the source version.
 * Date-based versions (e.g., "2025-11-19") → "main" (no tag exists).
 * Semver-like versions → use as tag (e.g., "v1.1.0" or "1.1.0").
 */
function getCheckoutTarget(sourceVersion: string): { ref: string; isDateBased: boolean } {
  // Date pattern: YYYY-MM-DD (with optional suffix)
  if (/^\d{4}-\d{2}-\d{2}/.test(sourceVersion)) {
    return { ref: 'main', isDateBased: true };
  }
  // Assume semver — prefix with "v" if not already present
  const ref = sourceVersion.startsWith('v') ? sourceVersion : `v${sourceVersion}`;
  return { ref, isDateBased: false };
}

/**
 * Extract the repository name from its URL.
 * "https://github.com/CiscoDevNet/api-insights-openapi-rulesets" → "api-insights-openapi-rulesets"
 */
function getRepoName(repositoryUrl: string): string {
  const cleaned = repositoryUrl.replace(/\/+$/, '').replace(/\.git$/, '');
  return cleaned.split('/').pop() || 'ruleset';
}

/**
 * Generate the rule overrides section of the Markdown, including:
 * - Summary table of overrides
 * - YAML wrapper ruleset example
 * - JS wrapper fallback note
 */
function generateOverridesSection(ruleOverrides: RuleOverrides, entrypoint: string): string {
  const entries = Object.entries(ruleOverrides);
  if (entries.length === 0) return '';

  // Build overrides table
  const tableRows = entries.map(([rule, severity]) => {
    const effect = severity === 'off'
      ? 'Rule excluded from results'
      : `Severity changed to ${severity}`;
    return `| \`${rule}\` | \`${severity}\` | ${effect} |`;
  });

  // Build YAML rules block for wrapper
  const yamlRules = entries
    .map(([rule, severity]) => `      ${rule}: "${severity}"`)
    .join('\n');

  // Build JS rules object for fallback
  const jsRules = entries
    .map(([rule, severity]) => `        '${rule}': '${severity}'`)
    .join(',\n');

  return `
## Step 3: Configure Rule Overrides

The original lint run applied the following rule overrides:

| Rule | Override | Effect |
|------|----------|--------|
${tableRows.join('\n')}

To reproduce the same behavior with Spectral, create a **wrapper ruleset** that extends the original and adds an [overrides section](https://docs.stoplight.io/docs/spectral/293426e270fac-overrides).

Save the following as \`spectify-overrides.yaml\` in the same directory as the cloned ruleset:

\`\`\`yaml
extends:
  - ./${entrypoint}
overrides:
  - files:
      - "**"
    rules:
${yamlRules}
\`\`\`

> **Note:** This is provided as an example. You can also add the \`overrides\` section directly to \`${entrypoint}\` instead of creating a wrapper file.

> **Troubleshooting:** If overrides don't take effect (rare edge case with deeply nested \`extends\` chains), use a JavaScript wrapper instead:
> \`\`\`js
> // spectify-overrides.mjs
> export default {
>   extends: ['./${entrypoint}'],
>   overrides: [
>     {
>       files: ['**'],
>       rules: {
${jsRules}
>       }
>     }
>   ]
> };
> \`\`\`
`;
}

/**
 * Generate Markdown reproduction instructions for a completed lint job.
 * 
 * Pure function — no I/O, no side effects.
 */
export function generateReproductionMarkdown(
  jobResult: LintJobResult,
  sourceMetadata: RulesetSourceMetadata
): string {
  const repoName = getRepoName(sourceMetadata.repositoryUrl);
  const { ref, isDateBased } = getCheckoutTarget(sourceMetadata.sourceVersion);
  const hasOverrides = jobResult.ruleOverrides && Object.keys(jobResult.ruleOverrides).length > 0;
  const rulesetFile = hasOverrides ? 'spectify-overrides.yaml' : sourceMetadata.entrypoint;
  const overrideCount = hasOverrides ? Object.keys(jobResult.ruleOverrides!).length : 0;

  // Step numbering shifts when overrides are present
  const runStepNumber = hasOverrides ? 4 : 3;

  const lines: string[] = [];

  // ── Header ──
  lines.push(`# Spectral Reproduction: ${sourceMetadata.displayName}`);
  lines.push('');

  // ── Job Information ──
  lines.push('## Job Information');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Job ID | \`${jobResult.jobId}\` |`);
  lines.push(`| Ruleset | ${sourceMetadata.rulesetName} (${sourceMetadata.displayName}) |`);
  lines.push(`| Version | ${sourceMetadata.version} |`);
  lines.push(`| Document ID | \`${jobResult.documentId}\` |`);
  lines.push(`| Timestamp | ${jobResult.timestamp instanceof Date ? jobResult.timestamp.toISOString() : jobResult.timestamp} |`);
  if (hasOverrides) {
    lines.push(`| Rule Overrides | ${overrideCount} rule${overrideCount !== 1 ? 's' : ''} modified (see below) |`);
  }
  lines.push('');

  // ── Prerequisites ──
  lines.push('## Prerequisites');
  lines.push('');
  lines.push('```bash');
  lines.push('# Install Spectral CLI (if not already installed)');
  lines.push('npm install -g @stoplight/spectral-cli');
  lines.push('');
  lines.push('# Verify installation');
  lines.push('spectral --version');
  lines.push('```');
  lines.push('');

  // ── Step 1: Clone ──
  lines.push('## Step 1: Clone the Ruleset');
  lines.push('');
  lines.push('```bash');
  lines.push(`git clone ${sourceMetadata.repositoryUrl}`);
  lines.push(`cd ${repoName}`);
  if (isDateBased) {
    lines.push(`# Source is a snapshot from ${sourceMetadata.sourceVersion} — using main branch`);
    lines.push(`git checkout ${ref}`);
  } else {
    lines.push(`git checkout ${ref}`);
  }
  lines.push('```');
  lines.push('');

  // ── Step 2: Install Dependencies ──
  if (sourceMetadata.hasPackageJson) {
    lines.push('## Step 2: Install Dependencies');
    lines.push('');
    lines.push('```bash');
    lines.push('npm install');
    lines.push('```');
    lines.push('');
  }

  // ── Step 3 (optional): Rule Overrides ──
  if (hasOverrides) {
    lines.push(generateOverridesSection(jobResult.ruleOverrides!, sourceMetadata.entrypoint));
  }

  // ── Run Spectral ──
  lines.push(`## Step ${runStepNumber}: Run Spectral`);
  lines.push('');
  lines.push('```bash');
  lines.push(`spectral lint <your-document.yaml> --ruleset ${rulesetFile}`);
  lines.push('```');
  lines.push('');
  lines.push('Replace `<your-document.yaml>` with the path to your OpenAPI document.');
  lines.push('');

  // ── Footer ──
  lines.push('---');
  lines.push('');
  lines.push(`*Generated by the linting orchestrator — reproduced from job \`${jobResult.jobId}\`*`);
  lines.push('');

  return lines.join('\n');
}
