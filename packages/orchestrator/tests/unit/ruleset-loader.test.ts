/**
 * Unit tests for RulesetLoader
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RulesetLoader } from '../../src/ruleset-loader.js';
import type { RulesetMetadata, RulesetVersion } from '../../src/types.js';
import { RULESETS_CONFIG, RULESETS_SOURCES } from '../helpers/repo-paths.js';

describe('RulesetLoader', () => {
  let loader: RulesetLoader;

  beforeAll(async () => {
    loader = new RulesetLoader({
      configPath: RULESETS_CONFIG,
      sourcesBasePath: RULESETS_SOURCES,
      enableCache: true,
    });
    await loader.initialize();
  });

  afterAll(() => {
    loader.clearCache();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const freshLoader = new RulesetLoader({
        configPath: RULESETS_CONFIG,
        sourcesBasePath: RULESETS_SOURCES,
        enableCache: true,
      });
      await expect(freshLoader.initialize()).resolves.not.toThrow();
    });

    it('should throw error for missing config file', async () => {
      const badLoader = new RulesetLoader({
        configPath: './nonexistent.yaml',
        sourcesBasePath: './rulesets/sources',
        enableCache: false,
      });
      await expect(badLoader.initialize()).rejects.toThrow();
    });

    it('should throw error for invalid config path', async () => {
      const badLoader = new RulesetLoader({
        configPath: './src/types.ts', // Not a valid config file
        sourcesBasePath: './rulesets/sources',
        enableCache: false,
      });
      await expect(badLoader.initialize()).rejects.toThrow();
    });
  });

  describe('listRulesets', () => {
    it('should list all available rulesets', () => {
      const rulesets = loader.listRulesets();
      expect(rulesets).toBeDefined();
      expect(Array.isArray(rulesets)).toBe(true);
      expect(rulesets.length).toBeGreaterThan(0);
    });

    it('should return rulesets with required metadata fields', () => {
      const rulesets = loader.listRulesets();
      const ruleset = rulesets[0];

      expect(ruleset).toHaveProperty('name');
      expect(ruleset).toHaveProperty('displayName');
      expect(ruleset).toHaveProperty('category');
      expect(ruleset).toHaveProperty('origin');
      expect(ruleset).toHaveProperty('description');
      expect(ruleset).toHaveProperty('versions');
      expect(ruleset).toHaveProperty('defaultVersion');
      expect(ruleset).toHaveProperty('tags');
      expect(ruleset).toHaveProperty('metadata');
    });

    it('should include oas-recommended ruleset', () => {
      const rulesets = loader.listRulesets();
      const oasRecommended = rulesets.find(r => r.name === 'oas-recommended');

      expect(oasRecommended).toBeDefined();
      expect(oasRecommended?.displayName).toBe('OpenAPI Recommended');
      expect(oasRecommended?.category).toBe('validation');
      expect(oasRecommended?.origin).toBe('external');
    });

    it('should have valid version arrays', () => {
      const rulesets = loader.listRulesets();

      for (const ruleset of rulesets) {
        expect(Array.isArray(ruleset.versions)).toBe(true);
        expect(ruleset.versions.length).toBeGreaterThan(0);
        expect(ruleset.defaultVersion).toBeTruthy();
        expect(ruleset.versions).toContain(ruleset.defaultVersion);
      }
    });

    it('should have valid metadata structure', () => {
      const rulesets = loader.listRulesets();

      for (const ruleset of rulesets) {
        expect(ruleset.metadata).toHaveProperty('team');
        expect(ruleset.metadata).toHaveProperty('repository');
        expect(ruleset.metadata).toHaveProperty('license');
      }
    });
  });

  describe('listVersions', () => {
    it('should list versions for oas-recommended ruleset', () => {
      const versions = loader.listVersions('oas-recommended');
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
      expect(versions[0]).toMatch(/^\d+\.\d+\.\d+$/); // Semantic version
    });

    it('should throw error for non-existent ruleset', () => {
      expect(() => loader.listVersions('nonexistent')).toThrow('Ruleset \'nonexistent\' not found');
    });

    it('should return all configured versions', () => {
      const versions = loader.listVersions('oas-recommended');
      expect(versions).toContain('1.0.0');
      expect(versions).toContain('2.0.0');
    });
  });

  describe('getMetadata', () => {
    it('should get metadata for oas-recommended', () => {
      const metadata = loader.getMetadata('oas-recommended');

      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('oas-recommended');
      expect(metadata.displayName).toBe('OpenAPI Recommended');
      expect(metadata.category).toBe('validation');
      expect(metadata.origin).toBe('external');
    });

    it('should throw error for non-existent ruleset', () => {
      expect(() => loader.getMetadata('nonexistent')).toThrow('Ruleset \'nonexistent\' not found');
    });

    it('should return metadata without loading ruleset', () => {
      // Clear cache to ensure we're not loading
      loader.clearCache();

      const startTime = Date.now();
      const metadata = loader.getMetadata('oas-recommended');
      const duration = Date.now() - startTime;

      expect(metadata).toBeDefined();
      expect(duration).toBeLessThan(50); // Should be very fast (no file I/O)
    });
  });

  describe('loadVersion', () => {
    it('should load oas-recommended ruleset successfully', async () => {
      const ruleset = await loader.loadVersion('oas-recommended');

      expect(ruleset).toBeDefined();
      expect(ruleset.metadata.name).toBe('oas-recommended');
      expect(ruleset.version).toBe('2.0.0');
      expect(ruleset.rules).toBeDefined();
      expect(Array.isArray(ruleset.rules)).toBe(true);
    });

    it('should load default version when version not specified', async () => {
      const ruleset = await loader.loadVersion('oas-recommended');
      expect(ruleset.version).toBe('2.0.0'); // Default version
    });

    it('should load specific version when specified', async () => {
      const ruleset = await loader.loadVersion('oas-recommended', '1.0.0');
      expect(ruleset.version).toBe('1.0.0');
    });

    it('should throw error for non-existent ruleset', async () => {
      await expect(loader.loadVersion('nonexistent')).rejects.toThrow('Ruleset \'nonexistent\' not found');
    });

    it('should throw error for non-existent version', async () => {
      await expect(loader.loadVersion('oas-recommended', '99.99.99')).rejects.toThrow();
    });

    it('should extract rules from oas-recommended ruleset', async () => {
      const ruleset = await loader.loadVersion('oas-recommended');

      expect(ruleset.rules.length).toBeGreaterThan(0);
    });

    it('should have complete rule definitions', async () => {
      const ruleset = await loader.loadVersion('oas-recommended');
      const rule = ruleset.rules[0];

      expect(rule).toHaveProperty('name');
      expect(rule).toHaveProperty('rulesetName');
      expect(rule).toHaveProperty('rulesetVersion');
      expect(rule).toHaveProperty('severity');
      expect(rule).toHaveProperty('message');
      expect(rule).toHaveProperty('given');
      expect(rule).toHaveProperty('then');

      expect(rule.rulesetName).toBe('oas-recommended');
      expect(rule.rulesetVersion).toBe('2.0.0');
    });

    it('should have valid severity values', async () => {
      const ruleset = await loader.loadVersion('oas-recommended');
      const validSeverities = ['error', 'warn', 'info', 'hint'];

      for (const rule of ruleset.rules) {
        expect(validSeverities).toContain(rule.severity);
      }
    });

    it('should include Spectral ruleset object', async () => {
      const ruleset = await loader.loadVersion('oas-recommended');

      expect(ruleset.spectralRuleset).toBeDefined();
      expect(typeof ruleset.spectralRuleset).toBe('object');
    });

    it('should have complete metadata in loaded version', async () => {
      const ruleset = await loader.loadVersion('oas-recommended');

      expect(ruleset.metadata).toBeDefined();
      expect(ruleset.metadata.name).toBe('oas-recommended');
      expect(ruleset.metadata.versions).toContain('2.0.0');
      expect(ruleset.metadata.ruleCount).toBeGreaterThan(0);
    });

    it('should have source repository information', async () => {
      const ruleset = await loader.loadVersion('oas-recommended');

      expect(ruleset.sourceRepo).toBe('example/oas-recommended');
      expect(ruleset.entrypoint).toBe('ruleset.yaml');
      expect(ruleset.releaseDate).toBeTruthy();
    });
  });

  describe('caching', () => {
    it('should cache loaded rulesets', async () => {
      loader.clearCache();

      // First load
      const startTime1 = Date.now();
      await loader.loadVersion('oas-recommended');
      const duration1 = Date.now() - startTime1;

      // Second load (should be cached)
      const startTime2 = Date.now();
      await loader.loadVersion('oas-recommended');
      const duration2 = Date.now() - startTime2;

      expect(duration2).toBeLessThan(Math.max(duration1, 50) / 10); // Cache should be 10x faster (floor of 50ms on duration1 to avoid false failures on fast runtimes)
      expect(duration2).toBeLessThan(10); // Should be nearly instant
    });

    it('should return same object from cache', async () => {
      loader.clearCache();

      const ruleset1 = await loader.loadVersion('oas-recommended');
      const ruleset2 = await loader.loadVersion('oas-recommended');

      expect(ruleset1).toBe(ruleset2); // Same reference
    });

    it('should respect cache enabled setting', async () => {
      const noCacheLoader = new RulesetLoader({
        configPath: RULESETS_CONFIG,
        sourcesBasePath: RULESETS_SOURCES,
        enableCache: false,
      });
      await noCacheLoader.initialize();

      const ruleset1 = await noCacheLoader.loadVersion('oas-recommended');
      const ruleset2 = await noCacheLoader.loadVersion('oas-recommended');

      // Without cache, should load fresh each time
      expect(ruleset1).not.toBe(ruleset2);
    });

    it('should have correct cache stats', async () => {
      loader.clearCache();

      let stats = loader.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.keys.length).toBe(0);

      await loader.loadVersion('oas-recommended');

      stats = loader.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.keys).toContain('oas-recommended:2.0.0');
    });

    it('should clear cache successfully', async () => {
      await loader.loadVersion('oas-recommended');

      let stats = loader.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);

      loader.clearCache();

      stats = loader.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.keys.length).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle multiple concurrent loads', async () => {
      loader.clearCache();

      const promises = [
        loader.loadVersion('oas-recommended'),
        loader.loadVersion('oas-recommended'),
        loader.loadVersion('oas-recommended'),
      ];

      const results = await Promise.all(promises);

      expect(results[0]).toBeDefined();
      expect(results[1]).toBeDefined();
      expect(results[2]).toBeDefined();
    });

    it('should handle loading different versions of the same ruleset', async () => {
      const v1 = await loader.loadVersion('oas-recommended', '1.0.0');
      const v2 = await loader.loadVersion('oas-recommended', '2.0.0');

      expect(v1.version).toBe('1.0.0');
      expect(v2.version).toBe('2.0.0');
      // v2 has extra rules (operation-operationId, operation-tags, info-contact-email)
      expect(v2.rules.length).toBeGreaterThanOrEqual(v1.rules.length);
    });

    it('should preserve rule order', async () => {
      const ruleset1 = await loader.loadVersion('oas-recommended');
      loader.clearCache();
      const ruleset2 = await loader.loadVersion('oas-recommended');

      expect(ruleset1.rules.map(r => r.name)).toEqual(ruleset2.rules.map(r => r.name));
    });
  });

  describe('performance', () => {
    it('should load ruleset in reasonable time', async () => {
      loader.clearCache();

      const startTime = Date.now();
      await loader.loadVersion('oas-recommended');
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should load in under 1 second
    });

    it('should list rulesets quickly', () => {
      const startTime = Date.now();
      const rulesets = loader.listRulesets();
      const duration = Date.now() - startTime;

      expect(rulesets.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(50); // Should be very fast
    });
  });
});

