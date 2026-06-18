/**
 * Integration tests for RulesetLoader + DocumentAccessor
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RulesetLoader } from '../../src/ruleset-loader.js';
import { DocumentAccessor } from '../../src/document-accessor.js';
import { loadConfig } from '../../src/config.js';

describe('Integration: RulesetLoader + DocumentAccessor', () => {
  let config: any;
  let rulesetLoader: RulesetLoader;
  let documentAccessor: DocumentAccessor;

  beforeAll(async () => {
    config = await loadConfig();

    rulesetLoader = new RulesetLoader({
      configPath: `${config.rulesets.directory}/config/rulesets.yaml`,
      sourcesBasePath: `${config.rulesets.directory}/sources`,
      enableCache: true,
    });
    await rulesetLoader.initialize();

    documentAccessor = new DocumentAccessor({
      documentStorePath: config.documentStore.baseDir,
      fallbackHttpUrl: config.documentStore.fallbackHttp,
    });
  });

  describe('Configuration Integration', () => {
    it('should load configuration successfully', () => {
      expect(config).toBeDefined();
      expect(config.rulesets).toBeDefined();
      expect(config.documentStore).toBeDefined();
    });

    it('should have valid ruleset configuration', () => {
      expect(config.rulesets.directory).toBeTruthy();
      expect(typeof config.rulesets.cacheEnabled).toBe('boolean');
    });

    it('should have valid document store configuration', () => {
      expect(config.documentStore.type).toBe('local');
      expect(config.documentStore.baseDir).toBeTruthy();
    });
  });

  describe('RulesetLoader Integration', () => {
    it('should initialize with config', () => {
      expect(rulesetLoader).toBeDefined();
    });

    it('should load multiple rulesets', async () => {
      const rulesets = rulesetLoader.listRulesets();
      expect(rulesets.length).toBeGreaterThanOrEqual(1);
    });

    it('should load oas-recommended with full rules', async () => {
      const ruleset = await rulesetLoader.loadVersion('oas-recommended');

      expect(ruleset.rules.length).toBeGreaterThan(0);
      expect(ruleset.spectralRuleset).toBeDefined();
      expect(ruleset.metadata.name).toBe('oas-recommended');
    });

    it('should cache ruleset after first load', async () => {
      rulesetLoader.clearCache();

      const start1 = Date.now();
      await rulesetLoader.loadVersion('oas-recommended');
      const duration1 = Date.now() - start1;

      const start2 = Date.now();
      await rulesetLoader.loadVersion('oas-recommended');
      const duration2 = Date.now() - start2;

      expect(duration2).toBeLessThan(duration1 / 5);
    });
  });

  describe('DocumentAccessor Integration', () => {
    it('should initialize with config', () => {
      expect(documentAccessor).toBeDefined();
    });

    it('should access document store path', () => {
      const docPath = documentAccessor.getDocumentPath('test-doc');
      expect(docPath).toContain('uploads');
      expect(docPath).toContain('test-doc.json');
    });
  });

  describe('End-to-End Workflow', () => {
    it('should support complete lint workflow', async () => {
      // 1. List available rulesets
      const rulesets = rulesetLoader.listRulesets();
      expect(rulesets.length).toBeGreaterThan(0);

      // 2. Get ruleset metadata
      const metadata = rulesetLoader.getMetadata('oas-recommended');
      expect(metadata.name).toBe('oas-recommended');

      // 3. Load full ruleset
      const ruleset = await rulesetLoader.loadVersion('oas-recommended');
      expect(ruleset.rules.length).toBeGreaterThan(0);

      // 4. Document accessor ready for file paths
      const docPath = documentAccessor.getDocumentPath('test-123');
      expect(docPath).toBeTruthy();
    });

    it('should support multiple rulesets in parallel', async () => {
      const promises = [
        rulesetLoader.loadVersion('oas-recommended', '1.0.0'),
        rulesetLoader.loadVersion('oas-recommended', '2.0.0'),
      ];

      const results = await Promise.all(promises);

      expect(results[0].metadata.name).toBe('oas-recommended');
      expect(results[1].metadata.name).toBe('oas-recommended');

      expect(results[0].rules.length).toBeGreaterThan(0);
      expect(results[1].rules.length).toBeGreaterThan(0);
    });

    it('should have consistent rule structure across rulesets', async () => {
      const v1 = await rulesetLoader.loadVersion('oas-recommended', '1.0.0');
      const v2 = await rulesetLoader.loadVersion('oas-recommended', '2.0.0');

      // All rules should have same structure
      const checkRuleStructure = (rule: any) => {
        expect(rule).toHaveProperty('name');
        expect(rule).toHaveProperty('rulesetName');
        expect(rule).toHaveProperty('rulesetVersion');
        expect(rule).toHaveProperty('severity');
        expect(rule).toHaveProperty('message');
        expect(rule).toHaveProperty('given');
        expect(rule).toHaveProperty('then');
      };

      v1.rules.forEach(checkRuleStructure);
      v2.rules.forEach(checkRuleStructure);
    });
  });

  describe('Performance Integration', () => {
    it('should handle rapid consecutive requests', async () => {
      const iterations = 10;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        await rulesetLoader.loadVersion('oas-recommended');
      }

      const duration = Date.now() - startTime;
      const avgDuration = duration / iterations;

      // After first load, should be cached and fast
      expect(avgDuration).toBeLessThan(20);
    });

    it('should list rulesets efficiently', () => {
      const iterations = 100;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        rulesetLoader.listRulesets();
      }

      const duration = Date.now() - startTime;
      const avgDuration = duration / iterations;

      expect(avgDuration).toBeLessThan(5);
    });
  });
});
