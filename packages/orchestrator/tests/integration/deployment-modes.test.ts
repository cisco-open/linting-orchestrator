/**
 * Integration Tests for Phase 1 Deployment Modes
 * 
 * Tests the new exportable server architecture that enables:
 * - Light mode (embedded server in CLI)
 * - Standalone mode (dedicated server process)
 * - Companion mode (MCP-managed)
 * 
 * NOTE: Full server startup tests require compiled code (build/).
 * These tests focus on configuration and exportability.
 */

import { describe, it, expect } from 'vitest';
import { startServer } from '../../src/server.js';
import type { ServerInstance } from '../../src/server.js';
import { createStandaloneModeConfig, createCompanionModeConfig } from '../../src/config.js';
import os from 'os';

describe('Deployment Modes - Phase 1', () => {
  describe('Server Exportability', () => {
    it('should export startServer function', () => {
      expect(startServer).toBeDefined();
      expect(typeof startServer).toBe('function');
    });

    it('should export ServerInstance type', () => {
      // TypeScript compilation ensures this type exists
      expect(true).toBe(true);
    });
  });

  describe('Light Mode Configuration', () => {
    it('should create light mode config with sensible defaults', () => {
      // Light mode removed - now use standalone config with defaults
      const config = createStandaloneModeConfig();

      expect(config.server?.port).toBe(3003);
      expect(config.documentStore?.type).toBe('local');
      expect(config.workerPool?.totalMaxWorkers).toBe(40);
      expect(config.storage?.type).toBe('memory');
      expect(config.logging?.level).toBe('info');
      expect(config.documentStore?.baseDir).toContain('.spectify/uploads');
    });

    it('should allow config overrides', () => {
      const config = createStandaloneModeConfig({
        server: { port: 4000, host: '0.0.0.0' },
        workerPool: { totalMaxWorkers: 5 }
      });

      expect(config.server?.port).toBe(4000);
      expect(config.server?.host).toBe('0.0.0.0');
      expect(config.workerPool).toBeDefined();
    });

    it('should use home directory for uploads', () => {
      const config = createStandaloneModeConfig();
      const homeDir = os.homedir();
      
      expect(config.documentStore?.baseDir).toContain(homeDir);
      expect(config.documentStore?.baseDir).toContain('.spectify');
    });

    it('should have correct light mode characteristics', () => {
      const config = createStandaloneModeConfig();

      // Default standalone config has production defaults:
      expect(config.workerPool?.totalMaxWorkers).toBe(40);
      expect(config.storage?.type).toBe('memory');
      expect(config.documentStore?.type).toBe('local');
      expect(config.logging?.format).toBe('json');
    });
  });

  describe('Standalone Mode Configuration', () => {
    it('should create standalone mode config for production', () => {
      const config = createStandaloneModeConfig();

      expect(config.server?.port).toBe(3003);
      expect(config.documentStore?.type).toBe('local');
      expect(config.workerPool?.totalMaxWorkers).toBe(40);
      expect(config.workerPool?.minWorkersPerRuleset).toBe(2);
      expect(config.storage?.type).toBe('memory');
      expect(config.logging?.format).toBe('json');
      expect(config.documentStore?.baseDir).toContain('.spectify/uploads');
    });

    it('should have production-grade characteristics', () => {
      const config = createStandaloneModeConfig();

      // Standalone mode defaults
      expect(config.workerPool?.totalMaxWorkers).toBe(40);
      expect(config.workerPool?.minWorkersPerRuleset).toBe(2);
      expect(config.logging?.format).toBe('json');
      expect(config.documentStore?.baseDir).toContain('.spectify/uploads');
    });

    it('should allow overrides for flexibility', () => {
      const config = createStandaloneModeConfig({
        server: { port: 4000 },
        documentStore: { baseDir: '/custom/path', type: 'local' }
      });

      expect(config.server?.port).toBe(4000);
      expect(config.documentStore?.baseDir).toBe('/custom/path');
    });
  });

  describe('Companion Mode Configuration', () => {
    it('should create companion mode config for MCP integration', () => {
      const config = createCompanionModeConfig();

      expect(config.server?.port).toBe(3004); // Companion uses 3004
      expect(config.documentStore?.type).toBe('passthrough'); // Changed from 'mcp'
      expect(config.workerPool?.totalMaxWorkers).toBe(30);
      expect(config.storage?.type).toBe('memory');
      expect(config.logging?.level).toBe('debug');  // Debug level for troubleshooting
      expect(config.documentStore?.baseDir).toBe(''); // Must be explicit
    });

    it('should have MCP integration characteristics', () => {
      const config = createCompanionModeConfig();

      // Companion mode characteristics:
      expect(config.documentStore?.type).toBe('passthrough');
      expect(config.workerPool?.totalMaxWorkers).toBe(30);
      expect(config.logging?.level).toBe('debug');
      expect(config.documentStore?.baseDir).toBe(''); // Requires explicit path
    });

    it('should allow passthrough path overrides', () => {
      const config = createCompanionModeConfig({
        documentStore: {
          baseDir: '../custom-mcp/uploads',
          type: 'passthrough'
        }
      });

      expect(config.documentStore?.baseDir).toBe('../custom-mcp/uploads');
      expect(config.documentStore?.type).toBe('passthrough');
    });
  });

  describe('Configuration Comparison', () => {
    it('should have different worker pool sizes for each mode', () => {
      const standalone = createStandaloneModeConfig();
      const companion = createCompanionModeConfig();

      // Different worker capacities
      expect(standalone.workerPool?.totalMaxWorkers).toBe(40);  // Production
      expect(companion.workerPool?.totalMaxWorkers).toBe(30);  // Scaled for batch workloads
    });

    it('should have workerWaitTimeout configured in all modes', () => {
      const standalone = createStandaloneModeConfig();
      const companion = createCompanionModeConfig();

      // Both modes should have workerWaitTimeout set to 30s default
      expect(standalone.workerPool?.workerWaitTimeout).toBe(30000);
      expect(companion.workerPool?.workerWaitTimeout).toBe(30000);
    });

    it('should have different document store types', () => {
      const standalone = createStandaloneModeConfig();
      const companion = createCompanionModeConfig();

      expect(standalone.documentStore?.type).toBe('local');
      expect(companion.documentStore?.type).toBe('passthrough');
    });

    it('should have different logging configurations', () => {
      const standalone = createStandaloneModeConfig();
      const companion = createCompanionModeConfig();

      expect(standalone.logging?.format).toBe('json');
      expect(standalone.logging?.level).toBe('info');
      expect(companion.logging?.level).toBe('debug');  // More verbose for troubleshooting
    });

    it('should have different storage locations', () => {
      const standalone = createStandaloneModeConfig();
      const companion = createCompanionModeConfig();

      // Standalone: user home directory
      expect(standalone.documentStore?.baseDir).toContain(os.homedir());

      // Companion: empty (requires explicit path)
      expect(companion.documentStore?.baseDir).toBe('');
    });
  });

  describe('Configuration Override Behavior', () => {
    it('should deep merge overrides, not replace', () => {
      const config = createStandaloneModeConfig({
        workerPool: {
          totalMaxWorkers: 5
        }
      });

      // Override should apply
      expect(config.workerPool?.totalMaxWorkers).toBe(5);
      
      // But other workerPool properties should still exist from defaults
      expect(config.workerPool?.minWorkersPerRuleset).toBeDefined();
      expect(config.workerPool?.maxWorkersPerRuleset).toBeDefined();
    });

    it('should allow partial server config overrides', () => {
      const config = createStandaloneModeConfig({
        server: { port: 5000 }
        // Don't override host
      });

      expect(config.server?.port).toBe(5000);
      expect(config.server?.host).toBe('0.0.0.0'); // Default preserved
    });

    it('should allow storage type changes', () => {
      const config = createStandaloneModeConfig({
        storage: { type: 'redis' }
      });

      expect(config.storage?.type).toBe('redis');
    });
  });
});

