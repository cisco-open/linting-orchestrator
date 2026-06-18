/**
 * Version Management
 * 
 * Single source of truth: package.json
 * 
 * Reads version information at runtime from package.json to ensure
 * versions are always in sync. No manual updates needed in code.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, '../../package.json');

let packageJson: any;
try {
  packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
} catch (error) {
  console.error('Failed to read package.json:', error);
  packageJson = { version: '0.0.0', spectify: { components: { server: '0.0.0', cli: '0.0.0' } } };
}

/**
 * Package version (npm version)
 * Format: {server}-cli{cli}
 * Example: 0.7.0-cli0.9.0
 */
export const PACKAGE_VERSION = packageJson.version as string;

/**
 * API Server version
 * Covers:
 * - HTTP API endpoints (POST /lint, GET /documents, etc.)
 * - Job orchestration and worker pool
 * - Storage adapters
 * - Document store integration
 */
export const API_VERSION = packageJson.spectify?.components?.server || '0.0.0';

/**
 * CLI version
 * Covers:
 * - spectify command-line interface
 * - Commands: lint, status, results, history, rulesets, health, config
 * - Configuration management and mode selection
 * - Interactive prompts and port conflict resolution
 * - Output formatting and user experience
 */
export const CLI_VERSION = packageJson.spectify?.components?.cli || '0.0.0';

/**
 * Read installed version of a node_modules package.
 * Uses import.meta.resolve() so Node's module resolution finds the package
 * regardless of whether it's in a local or hoisted node_modules.
 * Returns the version string or 'unknown' if not resolvable.
 */
function readInstalledVersion(packageName: string): string {
  // First try: resolve the package's main entry, then locate package.json
  // by walking up until we find a directory that contains it.
  try {
    // import.meta.resolve returns a file:// URL
    const entryUrl = import.meta.resolve(packageName);
    const entryPath = fileURLToPath(entryUrl);
    // Walk up from the resolved entry file until we find package.json
    let dir = dirname(entryPath);
    for (let i = 0; i < 10; i++) {
      const candidate = join(dir, 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
        if (pkg.name === packageName) return pkg.version || 'unknown';
      } catch { /* not here, keep walking */ }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* package not installed or not resolvable */ }

  // Fallback: probe common relative paths
  for (const base of [join(__dirname, '../../node_modules'), join(__dirname, '../../../node_modules')]) {
    try {
      const pkgPath = join(base, packageName, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return pkg.version || 'unknown';
    } catch { /* not here */ }
  }

  return 'unknown';
}

/** Installed version of @stoplight/spectral-core */
export const SPECTRAL_CORE_VERSION = readInstalledVersion('@stoplight/spectral-core');

/** Installed version of @stoplight/spectral-rulesets */
export const SPECTRAL_RULESETS_VERSION = readInstalledVersion('@stoplight/spectral-rulesets');

/** Installed version of @stoplight/spectral-cli */
export const SPECTRAL_CLI_VERSION = readInstalledVersion('@stoplight/spectral-cli');
