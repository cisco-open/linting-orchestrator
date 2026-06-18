// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * `spectify rulesets check` — load-only validation of a ruleset catalogue.
 *
 * Runs entirely in-process: no embedded server is started, no worker threads
 * are spawned. For each `{ruleset, version}` selected, the command:
 *
 *   1. Reads the catalogue's `config/rulesets.yaml` (same code path as
 *      `spectifyd` startup).
 *   2. Resolves the version's entrypoint (or built-in token for embedded
 *      origins).
 *   3. Hands the entrypoint to Spectral's ruleset bundler (the exact same
 *      call the worker pool makes when it instantiates a worker).
 *   4. Reports success (with the rule count) or failure (with the bundler
 *      error and an optional hint).
 *
 * Selection rules:
 *   - no flags         → every ruleset, every configured version
 *   - --name N         → every configured version of N
 *   - --name N --version V → just that one entry
 *   - --version V without --name → error
 *
 * Exit codes:
 *   0  every selected ruleset loaded successfully
 *   1  at least one selected ruleset failed to load
 *   2  the catalogue itself could not be read (bad path, malformed YAML)
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import chalk from 'chalk';
import { loadConfig } from '../../../config.js';
import { RulesetLoader } from '../../../ruleset-loader.js';

export interface CheckRulesetsOptions {
    /** Restrict the check to a single ruleset by name. */
    name?: string;
    /** Restrict the check to a single version. Requires --name. */
    version?: string;
    /** Override the catalogue directory (otherwise: SPECTIFYD_RULESETS_DIR or config default). */
    rulesetsDirectory?: string;
    /** Output format. */
    format?: 'text' | 'json';
}

interface CheckResult {
    name: string;
    version: string;
    origin: string;
    status: 'ok' | 'failed';
    durationMs: number;
    ruleCount: number | null;
    error: { message: string; hint?: string } | null;
}

interface CheckReport {
    configPath: string;
    summary: { total: number; ok: number; failed: number };
    results: CheckResult[];
}

/**
 * Heuristics that turn known load-failure messages into actionable hints.
 * The original error is always preserved; the hint is purely advisory.
 */
function inferHint(message: string): string | undefined {
    // .ts entrypoint without a build step
    if (/\.ts:/.test(message) && /Unexpected token/.test(message)) {
        return 'Entrypoint points to a .ts file. The source tree probably needs to be built. Run `bash scripts/install.sh` (which builds JS sources after `npm install`).';
    }

    // CommonJS exports in a file Spectral's bundler is trying to parse as ESM.
    // Spectral's bundler expects rulesets to be authored as ESM (or YAML);
    // CJS build outputs from Babel / `tsc --module commonjs` will hit this.
    if (/exports is not defined/.test(message) || /module is not defined/.test(message)) {
        return 'Entrypoint appears to be a CommonJS module. Either rebuild the source repo as ESM (`--module esnext` or similar) so its dist is ESM, OR add `loader: native` to this version in `config/rulesets.yaml` to load it via Node\'s built-in `await import()` (which handles CJS transparently).';
    }

    // Sibling module not found — typically a missing build output
    if (/Could not resolve '\.\//.test(message)) {
        return 'A sibling module could not be resolved. The source tree may not be built. Run `bash scripts/install.sh`.';
    }

    // Missing npm dep
    if (/Cannot find module/.test(message)) {
        return 'An npm dependency is missing. Run `bash scripts/install.sh` in this catalogue.';
    }

    // Entrypoint path does not exist on disk
    if (/Ruleset file not found/.test(message)) {
        return 'The configured entrypoint does not exist on disk. Check `entrypoint` / `sourceVersion` in `config/rulesets.yaml`, then re-run `bash scripts/vendor.sh`.';
    }

    return undefined;
}

/**
 * Resolve the catalogue directory. Precedence:
 *   1. --rulesets-directory CLI flag
 *   2. SPECTIFYD_RULESETS_DIR env var (applied by loadConfig)
 *   3. The orchestrator's bundled default
 */
async function resolveRulesetsDirectory(override?: string): Promise<string> {
    if (override) {
        return path.resolve(override);
    }
    const config = await loadConfig();
    return config.rulesets.directory;
}

export async function checkRulesetsCommand(options: CheckRulesetsOptions): Promise<void> {
    if (options.version && !options.name) {
        console.error(chalk.red('Error: --version requires --name (cannot select a version across all rulesets).'));
        process.exit(2);
    }

    const rulesetsDir = await resolveRulesetsDirectory(options.rulesetsDirectory);
    const configPath = path.join(rulesetsDir, 'config', 'rulesets.yaml');

    // Confirm the catalogue exists before instantiating the loader so we can
    // emit a clean error rather than a stack trace.
    try {
        await fs.access(configPath);
    } catch {
        console.error(chalk.red(`Error: ruleset catalogue not found at ${configPath}`));
        console.error(chalk.dim('Set --rulesets-directory or SPECTIFYD_RULESETS_DIR to a directory that contains config/rulesets.yaml.'));
        process.exit(2);
    }

    const loader = new RulesetLoader({
        configPath,
        sourcesBasePath: path.join(rulesetsDir, 'sources'),
        // Caching would silently mask repeated failures across versions, and
        // it has no benefit for a one-shot check.
        enableCache: false,
    });

    try {
        await loader.initialize();
    } catch (error) {
        console.error(chalk.red(`Error: failed to read ruleset catalogue at ${configPath}`));
        console.error(chalk.red(`  ${error instanceof Error ? error.message : String(error)}`));
        process.exit(2);
    }

    // Build the (ruleset, version) work list.
    const all = loader.listRulesets();
    let targets: Array<{ name: string; origin: string; version: string }> = [];

    if (options.name) {
        const entry = all.find(r => r.name === options.name);
        if (!entry) {
            console.error(chalk.red(`Error: ruleset '${options.name}' is not configured in ${configPath}.`));
            console.error(chalk.dim(`Available: ${all.map(r => r.name).join(', ')}`));
            process.exit(2);
        }
        const versions = options.version ? [options.version] : entry.versions;
        if (options.version && !entry.versions.includes(options.version)) {
            console.error(chalk.red(`Error: ruleset '${options.name}' has no version '${options.version}'.`));
            console.error(chalk.dim(`Available versions: ${entry.versions.join(', ')}`));
            process.exit(2);
        }
        targets = versions.map(v => ({ name: entry.name, origin: entry.origin, version: v }));
    } else {
        for (const r of all) {
            for (const v of r.versions) {
                targets.push({ name: r.name, origin: r.origin, version: v });
            }
        }
    }

    const format = options.format ?? 'text';

    if (format === 'text') {
        console.log('');
        console.log(`Checking ${targets.length} ruleset version${targets.length === 1 ? '' : 's'} in ${configPath}`);
        console.log('');
    }

    const results: CheckResult[] = [];
    for (const target of targets) {
        const startedAt = Date.now();
        let result: CheckResult;
        try {
            const loaded = await loader.loadVersion(target.name, target.version);
            result = {
                name: target.name,
                version: target.version,
                origin: target.origin,
                status: 'ok',
                durationMs: Date.now() - startedAt,
                ruleCount: loaded.rules.length,
                error: null,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const hint = inferHint(message);
            result = {
                name: target.name,
                version: target.version,
                origin: target.origin,
                status: 'failed',
                durationMs: Date.now() - startedAt,
                ruleCount: null,
                error: { message, ...(hint ? { hint } : {}) },
            };
        }

        if (format === 'text') {
            printResultLine(result);
        }
        results.push(result);
    }

    const okCount = results.filter(r => r.status === 'ok').length;
    const failedCount = results.length - okCount;

    if (format === 'json') {
        const report: CheckReport = {
            configPath,
            summary: { total: results.length, ok: okCount, failed: failedCount },
            results,
        };
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log('');
        if (failedCount === 0) {
            console.log(chalk.green(`Summary: ${okCount} ok, ${failedCount} failed`));
        } else {
            console.log(chalk.red(`Summary: ${okCount} ok, ${failedCount} failed`));
        }
        console.log('');
    }

    process.exit(failedCount === 0 ? 0 : 1);
}

/**
 * One-line-per-ruleset text formatter. Failed entries get the error message
 * (and hint) indented below.
 */
function printResultLine(r: CheckResult): void {
    // 36-char label so the status column lines up. Names are short
    // (kebab-case identifiers); long ones wrap rather than corrupting layout.
    const label = `${r.name}@${r.version}`.padEnd(36);
    const origin = `(${r.origin})`.padEnd(11);
    const duration = `${r.durationMs}ms`.padStart(6);

    if (r.status === 'ok') {
        const rules = r.ruleCount !== null ? `${String(r.ruleCount).padStart(4)} rules` : '          ';
        console.log(`  ${chalk.green('✅')} ${label} ${chalk.dim(origin)}  ${rules}  ${chalk.dim(duration)}`);
        return;
    }

    console.log(`  ${chalk.red('❌')} ${label} ${chalk.dim(origin)}  ${chalk.red('FAILED'.padStart(10))}  ${chalk.dim(duration)}`);
    if (r.error) {
        const indent = '       ';
        for (const line of r.error.message.split('\n')) {
            console.log(`${indent}${chalk.red(line)}`);
        }
        if (r.error.hint) {
            const hintLines = r.error.hint.split('\n');
            console.log(`     ${chalk.yellow('→ Hint:')} ${hintLines[0]}`);
            for (const line of hintLines.slice(1)) {
                console.log(`${indent}${chalk.yellow(line)}`);
            }
        }
    }
}
