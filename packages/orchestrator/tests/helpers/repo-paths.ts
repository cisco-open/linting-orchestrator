/**
 * Resolve filesystem paths that the orchestrator package needs at test time.
 *
 * The orchestrator is an npm workspace at `packages/orchestrator/`. Its
 * `rulesets/` directory ships inside the package (so a globally installed
 * `spectifyd` finds rulesets next to its `build/` output). Tests must not
 * rely on `process.cwd()` because it depends on how `npm test` is invoked
 * (root vs. workspace).
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// tests/helpers/repo-paths.ts -> ../../ = the orchestrator package root
export const ORCHESTRATOR_ROOT = path.resolve(__dirname, '..', '..');

export const RULESETS_DIR = path.join(ORCHESTRATOR_ROOT, 'rulesets');
export const RULESETS_CONFIG = path.join(RULESETS_DIR, 'config', 'rulesets.yaml');
export const RULESETS_SOURCES = path.join(RULESETS_DIR, 'sources');
