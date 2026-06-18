// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * RulesetLoader - Loads and manages Spectral rulesets from configuration
 * 
 * Responsibilities:
 * - Load rulesets.yaml configuration
 * - Resolve source repository paths
 * - Parse Spectral ruleset files (YAML/JS)
 * - Extract rule definitions
 * - Cache loaded rulesets for performance
 * - Provide ruleset metadata and rule listings
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { parse as parseYAML } from 'yaml';
// @ts-ignore - ESM export resolution issue with TypeScript
import { bundleAndLoadRuleset } from '@stoplight/spectral-ruleset-bundler/with-loader';
import spectralCore from '@stoplight/spectral-core';
const { Ruleset } = spectralCore;
import type {
  RulesetsConfig,
  RulesetConfigEntry,
  RulesetVersionConfig,
  RulesetMetadata,
  RulesetVersion,
  RuleDefinition,
  RulesetSourceMetadata,
} from './types.js';

export interface RulesetLoaderConfig {
  configPath: string;           // Path to rulesets.yaml
  sourcesBasePath: string;      // Path to rulesets/sources/
  enableCache?: boolean;        // Enable ruleset caching (default: true)
}

/**
 * RulesetLoader - Manages loading and caching of Spectral rulesets
 */
export class RulesetLoader {
  private config: RulesetsConfig | null = null;
  private cache: Map<string, RulesetVersion> = new Map();
  private loaderConfig: RulesetLoaderConfig;

  constructor(config: RulesetLoaderConfig) {
    this.loaderConfig = {
      enableCache: true,
      ...config,
    };
  }

  /**
   * Initialize the loader by loading the configuration file
   */
  async initialize(): Promise<void> {
    const configContent = await fs.readFile(this.loaderConfig.configPath, 'utf-8');
    try {
      this.config = parseYAML(configContent) as RulesetsConfig;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse rulesets configuration: ${msg}`);
    }

    if (!this.config || !this.config.rulesets) {
      throw new Error('Invalid rulesets configuration: missing rulesets array');
    }
  }

  /**
   * Get a specific ruleset version
   * @param name Ruleset name
   * @param version Ruleset version (optional, uses default if not specified)
   */
  async loadVersion(name: string, version?: string): Promise<RulesetVersion> {
    if (!this.config) {
      throw new Error('RulesetLoader not initialized. Call initialize() first.');
    }

    // Find ruleset configuration
    const rulesetConfig = this.config.rulesets.find(r => r.name === name);
    if (!rulesetConfig) {
      throw new Error(`Ruleset '${name}' not found in configuration`);
    }

    // Determine version to load
    const versionToLoad = version || this.getDefaultVersion(name);
    if (!versionToLoad) {
      throw new Error(`No default version configured for ruleset '${name}'`);
    }

    // Check cache
    const cacheKey = `${name}:${versionToLoad}`;
    if (this.loaderConfig.enableCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Find version configuration
    const versionConfig = rulesetConfig.versions.find(v => v.version === versionToLoad);
    if (!versionConfig) {
      throw new Error(
        `Version '${versionToLoad}' not found for ruleset '${name}'. ` +
        `Available versions: ${rulesetConfig.versions.map(v => v.version).join(', ')}`
      );
    }

    // Load the ruleset
    const rulesetVersion = await this.loadRulesetVersion(rulesetConfig, versionConfig);

    // Cache it
    if (this.loaderConfig.enableCache) {
      this.cache.set(cacheKey, rulesetVersion);
    }

    return rulesetVersion;
  }

  /**
   * Load a specific ruleset version from filesystem
   */
  private async loadRulesetVersion(
    rulesetConfig: RulesetConfigEntry,
    versionConfig: RulesetVersionConfig
  ): Promise<RulesetVersion> {
    const isEmbedded = rulesetConfig.origin === 'embedded';

    // Validate config:
    //   embedded: entrypoint must be a `spectral:*` token
    //   else: absolutePath OR (sourceRepo + sourceVersion + entrypoint) required
    if (isEmbedded) {
      if (!versionConfig.entrypoint?.startsWith('spectral:')) {
        throw new Error(
          `Ruleset '${rulesetConfig.name}' version '${versionConfig.version}': ` +
          `origin 'embedded' requires entrypoint to be a Spectral built-in token ` +
          `(e.g. 'spectral:oas'), got: '${versionConfig.entrypoint}'`
        );
      }
    } else if (!versionConfig.absolutePath && (!versionConfig.sourceRepo || !versionConfig.sourceVersion)) {
      throw new Error(
        `Ruleset '${rulesetConfig.name}' version '${versionConfig.version}': ` +
        `either absolutePath or all of sourceRepo, sourceVersion, and entrypoint must be set`
      );
    }

    // Resolve source path (ensure absolute path)
    //   embedded: write a tiny shim file that `extends` the built-in token,
    //             so the bundler's normal token-resolution path handles it.
    let sourcePath: string;
    let cleanupShim: (() => Promise<void>) | null = null;

    if (isEmbedded) {
      const shimDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spectify-embedded-'));
      sourcePath = path.join(shimDir, `${rulesetConfig.name}.yaml`);
      await fs.writeFile(sourcePath, `extends: ${versionConfig.entrypoint}\n`, 'utf8');
      cleanupShim = async () => { await fs.rm(shimDir, { recursive: true, force: true }); };
    } else {
      sourcePath = versionConfig.absolutePath
        ? path.resolve(versionConfig.absolutePath)
        : path.resolve(
          this.loaderConfig.sourcesBasePath,
          versionConfig.sourceRepo!,
          versionConfig.sourceVersion!,
          versionConfig.entrypoint
        );

      // Check if file exists
      try {
        await fs.access(sourcePath);
      } catch (error) {
        throw new Error(
          `Ruleset file not found: ${sourcePath}\n` +
          (versionConfig.absolutePath
            ? `Configured as absolutePath: ${versionConfig.absolutePath}`
            : `Expected: rulesets/sources/${versionConfig.sourceRepo}/${versionConfig.sourceVersion}/${versionConfig.entrypoint}`)
        );
      }
    }

    // Load and parse the Spectral ruleset.
    //
    // Two mutually-exclusive mechanisms are supported, selected by the
    // catalogue entry's `loader` field (defaulting to `bundler`):
    //
    //   bundler  Spectral's Rollup-based `@stoplight/spectral-ruleset-bundler`.
    //            Handles YAML, ESM JS, `extends: 'spectral:oas'` token
    //            resolution, and named imports from CJS npm packages
    //            (via Rollup interop). The right choice for almost
    //            every ruleset.
    //
    //   native   Node's built-in `await import()`. Use when the entrypoint
    //            is a CommonJS dist file (typically Babel/`tsc` output of
    //            a TypeScript ruleset) that the bundler chokes on with
    //            `exports is not defined`. Only valid for .js/.cjs/.mjs
    //            entrypoints. The `embedded` shim always uses the bundler
    //            (it's a generated YAML stub).
    const loaderKind: 'bundler' | 'native' = isEmbedded
      ? 'bundler'
      : (versionConfig.loader ?? 'bundler');

    let spectralRuleset;

    if (loaderKind === 'native') {
      if (!/\.(js|cjs|mjs)$/i.test(sourcePath)) {
        throw new Error(
          `Ruleset '${rulesetConfig.name}@${versionConfig.version}' is configured ` +
          `with loader: native but its entrypoint is not a JavaScript file ` +
          `(${sourcePath}). The native loader only supports .js / .cjs / .mjs.`
        );
      }
      try {
        const mod = await import(pathToFileURL(sourcePath).href);
        const def = extractRulesetDef(mod);
        if (!def || (!def.rules && !def.extends && !def.overrides)) {
          throw new Error(
            `module did not export a recognisable Spectral ruleset definition ` +
            `(expected an object with 'rules', 'extends', or 'overrides')`
          );
        }
        spectralRuleset = new Ruleset(def, { source: sourcePath });
      } catch (error) {
        throw new Error(
          `Failed to load Spectral ruleset from ${sourcePath} via loader: native: ` +
          (error instanceof Error ? error.message : String(error))
        );
      }
    } else {
      try {
        spectralRuleset = await bundleAndLoadRuleset(sourcePath, { fs: { promises: fs }, fetch });
      } catch (error) {
        throw new Error(
          `Failed to load Spectral ruleset from ${sourcePath}: ` +
          (error instanceof Error ? error.message : String(error))
        );
      }
    }

    // For embedded entries, resolve the installed package's version if `package` is set
    let resolvedVersion: string | undefined;
    if (isEmbedded && versionConfig.package) {
      resolvedVersion = await this.resolvePackageVersion(versionConfig.package);
      // Mutate config so subsequent reads (e.g. via /rulesets API) see it.
      versionConfig.resolvedVersion = resolvedVersion;
    }

    // Extract rules
    const rules = this.extractRules(spectralRuleset, rulesetConfig.name, versionConfig.version);

    // Build metadata
    const metadata: RulesetMetadata = {
      name: rulesetConfig.name,
      displayName: rulesetConfig.displayName,
      category: rulesetConfig.category,
      origin: rulesetConfig.origin,
      description: rulesetConfig.description,
      versions: rulesetConfig.versions.map(v => v.version),
      defaultVersion: this.getDefaultVersion(rulesetConfig.name) || versionConfig.version,
      ruleCount: rules.length,
      tags: rulesetConfig.tags || [],
      metadata: rulesetConfig.metadata,
    };

    // Build RulesetVersion
    const rulesetVersion: RulesetVersion = {
      metadata,
      version: versionConfig.version,
      sourceRepo: versionConfig.sourceRepo ?? '',
      sourceVersion: versionConfig.sourceVersion ?? '',
      entrypoint: versionConfig.entrypoint,
      rulesetPath: sourcePath,  // Store absolute path for worker initialization
      releaseDate: versionConfig.releaseDate,
      deprecated: versionConfig.deprecated || false,
      changelog: versionConfig.changelog,
      rules,
      spectralRuleset, // Store original Spectral ruleset for execution
      package: versionConfig.package,
      resolvedVersion,
      loader: loaderKind,
    };

    // Note: we intentionally keep the shim file on disk for the lifetime of
    // the process so worker pools that re-read `rulesetPath` continue to find
    // it. The OS reclaims it on tmp cleanup. If this becomes a footprint
    // concern, register `cleanupShim` with a process-exit hook.
    void cleanupShim;

    return rulesetVersion;
  }

  /**
   * Resolve an installed npm package's version by reading its package.json.
   * Returns undefined if the package cannot be located.
   */
  private async resolvePackageVersion(pkgName: string): Promise<string | undefined> {
    try {
      // require.resolve handles node_modules traversal correctly.
      const { createRequire } = await import('module');
      const req = createRequire(import.meta.url);
      const pkgJsonPath = req.resolve(`${pkgName}/package.json`);
      const raw = await fs.readFile(pkgJsonPath, 'utf8');
      const pkg = JSON.parse(raw);
      return typeof pkg.version === 'string' ? pkg.version : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Extract rule definitions from a Spectral ruleset
   */
  private extractRules(
    spectralRuleset: any,
    rulesetName: string,
    rulesetVersion: string
  ): RuleDefinition[] {
    const rules: RuleDefinition[] = [];

    if (!spectralRuleset.rules) {
      return rules;
    }

    for (const [ruleName, ruleConfig] of Object.entries(spectralRuleset.rules)) {
      if (typeof ruleConfig !== 'object' || ruleConfig === null) {
        continue;
      }

      const rule = ruleConfig as any;

      // Skip rules that are disabled (severity -1, or enabled === false).
      // Spectral keeps all inherited rules in the map but marks disabled ones
      // with enabled=false (set by extends: [["ruleset", "off"]]). Including
      // them would inflate the rule count with rules that never fire.
      if (rule.enabled === false || rule.severity === -1) {
        continue;
      }

      // Extract rule definition
      const ruleDefinition: RuleDefinition = {
        name: ruleName,
        rulesetName,
        rulesetVersion,
        severity: this.mapSeverity(rule.severity),
        message: rule.message || rule.description || '',
        description: rule.description || '',
        given: Array.isArray(rule.given) ? rule.given : [rule.given].filter(Boolean),
        then: rule.then,
        recommended: rule.recommended !== false, // Default to true
        formats: rule.formats,
      };

      rules.push(ruleDefinition);
    }

    return rules;
  }

  /**
   * Map Spectral severity to our severity type
   */
  private mapSeverity(severity: any): 'error' | 'warn' | 'info' | 'hint' {
    if (typeof severity === 'string') {
      const lower = severity.toLowerCase();
      if (lower === 'error' || lower === 'warn' || lower === 'info' || lower === 'hint') {
        return lower as 'error' | 'warn' | 'info' | 'hint';
      }
    }

    // Spectral numeric severities: 0=error, 1=warn, 2=info, 3=hint
    if (typeof severity === 'number') {
      const severityMap: Record<number, 'error' | 'warn' | 'info' | 'hint'> = {
        0: 'error',
        1: 'warn',
        2: 'info',
        3: 'hint',
      };
      return severityMap[severity] || 'warn';
    }

    return 'warn'; // Default
  }

  /**
   * Get default version for a ruleset
   */
  getDefaultVersion(name: string): string | undefined {
    if (!this.config) {
      throw new Error('RulesetLoader not initialized');
    }

    return this.config.defaults?.[name];
  }

  /**
   * Get source metadata for a specific ruleset version.
   * Used to generate Spectral CLI reproduction instructions.
   */
  async getSourceMetadata(rulesetName: string, version: string): Promise<RulesetSourceMetadata | null> {
    if (!this.config) {
      throw new Error('RulesetLoader not initialized');
    }

    const rulesetConfig = this.config.rulesets.find(r => r.name === rulesetName);
    if (!rulesetConfig) {
      return null;
    }

    const versionConfig = rulesetConfig.versions.find(v => v.version === version);
    if (!versionConfig) {
      return null;
    }

    // Check if package.json exists in the source directory
    // For embedded entries, there is no sources/ tree — skip the check.
    const isEmbedded = rulesetConfig.origin === 'embedded';
    let hasPackageJson = false;
    if (!isEmbedded) {
      const sourceDir = versionConfig.absolutePath
        ? path.dirname(path.resolve(versionConfig.absolutePath))
        : path.resolve(
          this.loaderConfig.sourcesBasePath,
          versionConfig.sourceRepo!,
          versionConfig.sourceVersion!
        );
      try {
        await fs.access(path.join(sourceDir, 'package.json'));
        hasPackageJson = true;
      } catch {
        // No package.json
      }
    }

    return {
      rulesetName: rulesetConfig.name,
      displayName: rulesetConfig.displayName,
      version: versionConfig.version,
      repositoryUrl: rulesetConfig.metadata.repository,
      sourceRepo: versionConfig.sourceRepo ?? '',
      sourceVersion: versionConfig.sourceVersion ?? '',
      entrypoint: versionConfig.entrypoint,
      hasPackageJson,
      license: rulesetConfig.metadata.license,
    };
  }

  /**
   * List all available rulesets
   */
  listRulesets(): RulesetMetadata[] {
    if (!this.config) {
      throw new Error('RulesetLoader not initialized');
    }

    return this.config.rulesets.map(r => {
      const defaultVersion = this.getDefaultVersion(r.name);

      return {
        name: r.name,
        displayName: r.displayName,
        category: r.category,
        origin: r.origin,
        description: r.description,
        versions: r.versions.map(v => v.version),
        defaultVersion: defaultVersion || r.versions[0].version,
        ruleCount: 0, // Will be populated when version is loaded
        tags: r.tags || [],
        metadata: r.metadata,
      };
    });
  }

  /**
   * List all available rulesets with rule counts (loads default versions)
   */
  async listRulesetsWithCounts(): Promise<RulesetMetadata[]> {
    if (!this.config) {
      throw new Error('RulesetLoader not initialized');
    }

    const metadataPromises = this.config.rulesets.map(async (r) => {
      const defaultVersion = this.getDefaultVersion(r.name) || r.versions[0].version;

      try {
        // Load the default version to get accurate rule count (cached after first load)
        const rulesetVersion = await this.loadVersion(r.name, defaultVersion);

        return {
          name: r.name,
          displayName: r.displayName,
          category: r.category,
          origin: r.origin,
          description: r.description,
          versions: r.versions.map(v => v.version),
          defaultVersion,
          ruleCount: rulesetVersion.rules.length,
          tags: r.tags || [],
          metadata: r.metadata,
        };
      } catch (error) {
        // If loading fails, return metadata with 0 rule count
        console.error(`Failed to load ruleset ${r.name}:`, error);
        return {
          name: r.name,
          displayName: r.displayName,
          category: r.category,
          origin: r.origin,
          description: r.description,
          versions: r.versions.map(v => v.version),
          defaultVersion,
          ruleCount: 0,
          tags: r.tags || [],
          metadata: r.metadata,
        };
      }
    });

    return Promise.all(metadataPromises);
  }

  /**
   * List all versions for a specific ruleset
   */
  listVersions(name: string): string[] {
    if (!this.config) {
      throw new Error('RulesetLoader not initialized');
    }

    const rulesetConfig = this.config.rulesets.find(r => r.name === name);
    if (!rulesetConfig) {
      throw new Error(`Ruleset '${name}' not found`);
    }

    return rulesetConfig.versions.map(v => v.version);
  }

  /**
   * Get ruleset metadata without loading the full ruleset
   */
  getMetadata(name: string): RulesetMetadata {
    if (!this.config) {
      throw new Error('RulesetLoader not initialized');
    }

    const rulesetConfig = this.config.rulesets.find(r => r.name === name);
    if (!rulesetConfig) {
      throw new Error(`Ruleset '${name}' not found`);
    }

    const defaultVersion = this.getDefaultVersion(name);

    return {
      name: rulesetConfig.name,
      displayName: rulesetConfig.displayName,
      category: rulesetConfig.category,
      origin: rulesetConfig.origin,
      description: rulesetConfig.description,
      versions: rulesetConfig.versions.map(v => v.version),
      defaultVersion: defaultVersion || rulesetConfig.versions[0].version,
      ruleCount: 0, // Will be populated when version is loaded
      tags: rulesetConfig.tags || [],
      metadata: rulesetConfig.metadata,
    };
  }

  /**
   * Clear the cache (useful for testing or reloading)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

/**
 * Extract a Spectral ruleset definition object from the namespace returned
 * by Node's `await import()`. Handles the common module shapes:
 *
 *   ESM:        `export default { rules: ... }`         → { default: { rules } }
 *   CJS:        `module.exports = { rules: ... }`        → { default: { rules } }
 *   CJS named:  `module.exports.default = { rules: ... }`→ { default: { rules } }
 *   Babel CJS:  Both of the above wrapped under          → { __esModule, default: { default: { rules } } }
 *               Babel's `_interopRequireDefault` shape
 *
 * Returns `null` if no plausible ruleset definition was found.
 */
function extractRulesetDef(mod: unknown): { rules?: unknown; extends?: unknown; overrides?: unknown } | null {
  if (!mod || typeof mod !== 'object') return null;
  const ns = mod as Record<string, unknown>;
  let candidate = (ns.default ?? ns) as Record<string, unknown>;

  // Babel CJS interop wraps the real definition under a second `.default`.
  // Detect this by checking that the outer candidate has none of the
  // top-level ruleset keys but does have a `.default` that looks like one.
  if (
    candidate
    && typeof candidate === 'object'
    && !('rules' in candidate)
    && !('extends' in candidate)
    && !('overrides' in candidate)
    && candidate.default
    && typeof candidate.default === 'object'
  ) {
    candidate = candidate.default as Record<string, unknown>;
  }

  return candidate as { rules?: unknown; extends?: unknown; overrides?: unknown };
}
