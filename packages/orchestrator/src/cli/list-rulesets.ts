#!/usr/bin/env node
/**
 * CLI Tool: list-rulesets
 * 
 * Lists all available rulesets with details including versions,
 * rules count, and metadata.
 * 
 * Usage:
 *   npm run list-rulesets
 *   npm run list-rulesets -- --verbose
 *   npm run list-rulesets -- --name pubhub
 *   npm run list-rulesets -- --format json
 */

import { RulesetLoader } from '../ruleset-loader.js';
import { loadConfig } from '../config.js';

interface CLIOptions {
  verbose: boolean;
  name?: string;
  format: 'table' | 'json';
  version?: string;
}

/**
 * Parse command-line arguments
 */
function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    verbose: false,
    format: 'table',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--name' || arg === '-n') {
      options.name = args[++i];
    } else if (arg === '--version') {
      options.version = args[++i];
    } else if (arg === '--format' || arg === '-f') {
      const format = args[++i];
      if (format === 'json' || format === 'table') {
        options.format = format;
      }
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Usage: list-rulesets [options]

List all available rulesets with details.

Options:
  -n, --name <name>       Show details for specific ruleset
  --version <version>     Show specific version (requires --name)
  -f, --format <format>   Output format: table (default) or json
  -v, --verbose           Show detailed information
  -h, --help             Show this help message

Examples:
  list-rulesets
  list-rulesets --verbose
  list-rulesets --name pubhub
  list-rulesets --name pubhub --version 1.1.0
  list-rulesets --format json
`);
}

/**
 * Format table output
 */
function printTable(rulesets: any[]): void {
  console.log('\n📋 Available Rulesets:\n');
  console.log('┌─────────────────────────────────────────────────────────────────────────┐');

  for (const ruleset of rulesets) {
    console.log(`│ ${ruleset.displayName.padEnd(40)} │`);
    console.log(`│   Name:     ${ruleset.name.padEnd(60)} │`);
    console.log(`│   Category: ${ruleset.category.padEnd(60)} │`);
    console.log(`│   Origin:   ${ruleset.origin.padEnd(60)} │`);
    console.log(`│   Versions: ${ruleset.versions.join(', ').padEnd(60)} │`);
    console.log(`│   Default:  ${ruleset.defaultVersion.padEnd(60)} │`);
    console.log(`│   Rules:    ${String(ruleset.ruleCount).padEnd(60)} │`);
    console.log(`│   Tags:     ${ruleset.tags.join(', ').padEnd(60)} │`);
    console.log('├─────────────────────────────────────────────────────────────────────────┤');
  }

  console.log(`\nTotal: ${rulesets.length} ruleset(s)\n`);
}

/**
 * Print detailed ruleset version information
 */
function printRulesetDetails(ruleset: any, verbose: boolean): void {
  console.log(`\n📦 Ruleset: ${ruleset.metadata.displayName}\n`);
  console.log(`Name:         ${ruleset.metadata.name}`);
  console.log(`Version:      ${ruleset.version}${ruleset.resolvedVersion ? ` (effective: ${ruleset.resolvedVersion}, from ${ruleset.package || 'npm'})` : ''}`);
  console.log(`Category:     ${ruleset.metadata.category}`);
  console.log(`Origin:       ${ruleset.metadata.origin}`);
  console.log(`Description:  ${ruleset.metadata.description}`);
  console.log(`Source Repo:  ${ruleset.sourceRepo}`);
  console.log(`Entry Point:  ${ruleset.entrypoint}`);
  if (ruleset.releaseDate) {
    console.log(`Release Date: ${ruleset.releaseDate}`);
  }
  console.log(`Deprecated:   ${ruleset.deprecated ? 'Yes' : 'No'}`);
  console.log(`Rules Count:  ${ruleset.rules.length}`);

  if (ruleset.changelog) {
    console.log(`\nChangelog:\n  ${ruleset.changelog}`);
  }

  console.log(`\nMetadata:`);
  console.log(`  Team:         ${ruleset.metadata.metadata.team}`);
  console.log(`  Repository:   ${ruleset.metadata.metadata.repository}`);
  console.log(`  License:      ${ruleset.metadata.metadata.license}`);
  if (ruleset.metadata.metadata.documentation) {
    console.log(`  Docs:         ${ruleset.metadata.metadata.documentation}`);
  }
  if (ruleset.metadata.metadata.maintainer) {
    console.log(`  Maintainer:   ${ruleset.metadata.metadata.maintainer}`);
  }
  if (ruleset.metadata.metadata.contact) {
    console.log(`  Contact:      ${ruleset.metadata.metadata.contact}`);
  }

  if (verbose) {
    console.log(`\n📜 Rules (${ruleset.rules.length}):\n`);
    for (const rule of ruleset.rules) {
      console.log(`  • ${rule.name}`);
      console.log(`    Severity:    ${rule.severity}`);
      console.log(`    Message:     ${rule.message}`);
      if (rule.description) {
        console.log(`    Description: ${rule.description}`);
      }
      console.log(`    Recommended: ${rule.recommended !== false ? 'Yes' : 'No'}`);
      console.log();
    }
  } else {
    console.log(`\n📜 Rules: ${ruleset.rules.length} total (use --verbose to see details)\n`);
  }
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  try {
    const options = parseArgs();

    // Load configuration
    const config = await loadConfig();

    // Initialize ruleset loader
    const loader = new RulesetLoader({
      configPath: `${config.rulesets.directory}/config/rulesets.yaml`,
      sourcesBasePath: `${config.rulesets.directory}/sources`,
      enableCache: config.rulesets.cacheEnabled,
    });

    await loader.initialize();

    // Specific ruleset requested
    if (options.name) {
      const version = options.version || undefined;
      const ruleset = await loader.loadVersion(options.name, version);

      if (options.format === 'json') {
        console.log(JSON.stringify(ruleset, null, 2));
      } else {
        printRulesetDetails(ruleset, options.verbose);
      }
    } else {
      // List all rulesets
      const rulesets = loader.listRulesets();

      if (options.format === 'json') {
        console.log(JSON.stringify(rulesets, null, 2));
      } else {
        printTable(rulesets);

        if (options.verbose) {
          console.log('\nCache Statistics:');
          const stats = loader.getCacheStats();
          console.log(`  Cached entries: ${stats.size}`);
          console.log(`  Cache keys:     ${stats.keys.join(', ')}`);
          console.log();
        }
      }
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run CLI
main();
