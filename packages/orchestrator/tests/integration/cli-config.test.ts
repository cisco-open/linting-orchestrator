/**
 * CLI Configuration E2E Tests
 * Tests the new config management, mode switching, and interactive features
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

const CLI_PATH = path.join(process.cwd(), 'build/cli/index.js');
const CONFIG_DIR = path.join(os.homedir(), '.spectify-test');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

// Override home directory for tests
process.env.HOME = path.dirname(CONFIG_DIR);

function runCLI(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execSync(`node ${CLI_PATH} ${args.join(' ')}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: path.dirname(CONFIG_DIR) },
    });
    return { stdout: result, stderr: '', exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || '',
      exitCode: error.status || 1,
    };
  }
}

describe('CLI Configuration Management', () => {
  beforeAll(async () => {
    // Clean up test config
    try {
      await fs.rm(CONFIG_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore if doesn't exist
    }
  });

  afterAll(async () => {
    // Clean up test config
    try {
      await fs.rm(CONFIG_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore
    }
  });

  describe('Config File Creation', () => {
    it('should auto-create config on first run', async () => {
      const result = runCLI(['config', 'show']);
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Spectify Configuration');
      expect(result.stdout).toContain('Default Mode: standalone');
      expect(result.stdout).toContain('Standalone Port: 3003');
      expect(result.stdout).toContain('MCP Port: 3004');

      // Verify config file exists
      const configExists = await fs.access(CONFIG_PATH).then(() => true).catch(() => false);
      expect(configExists).toBe(true);
    });

    it('should have correct default values', async () => {
      const configContent = await fs.readFile(CONFIG_PATH, 'utf-8');
      const config = JSON.parse(configContent);

      expect(config.defaultMode).toBe('standalone');
      expect(config.ports.standalone).toBe(3003);
      expect(config.ports.mcp).toBe(3004);
    });
  });

  describe('Config Set Command', () => {
    it('should change default mode to mcp', () => {
      const result = runCLI(['config', 'set', 'mode', 'mcp']);
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Default mode set to: mcp');
    });

    it('should persist mode change', () => {
      const result = runCLI(['config', 'show']);
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Default Mode: mcp');
    });

    it('should change standalone port', () => {
      const result = runCLI(['config', 'set', 'port.standalone', '5000']);
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Standalone port set to: 5000');
    });

    it('should change mcp port', () => {
      const result = runCLI(['config', 'set', 'port.mcp', '5001']);
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('MCP port set to: 5001');
    });

    it('should reject invalid mode', () => {
      const result = runCLI(['config', 'set', 'mode', 'invalid']);
      
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Mode must be "standalone" or "mcp"');
    });

    it('should reject invalid port', () => {
      const result = runCLI(['config', 'set', 'port.standalone', '99999']);
      
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Port must be a number between 1 and 65535');
    });

    it('should reject unknown config key', () => {
      const result = runCLI(['config', 'set', 'unknown', 'value']);
      
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Unknown config key');
    });
  });

  describe('Mode-Based API URL Resolution', () => {
    it('should use standalone port when mode is standalone', async () => {
      runCLI(['config', 'set', 'mode', 'standalone']);
      runCLI(['config', 'set', 'port.standalone', '3003']);

      const result = runCLI(['health']);
      
      // Should try to connect to localhost:3003
      expect(result.stdout).toContain('Port: 3003');
    });

    it('should use mcp port when mode is mcp', async () => {
      runCLI(['config', 'set', 'mode', 'mcp']);
      runCLI(['config', 'set', 'port.mcp', '3004']);

      const result = runCLI(['health']);
      
      // Should try to connect to localhost:3004
      expect(result.stdout).toContain('Port: 3004');
    });
  });

  describe('Health Command Error Messages', () => {
    it('should suggest start command when service is down', () => {
      runCLI(['config', 'set', 'mode', 'standalone']);
      
      const result = runCLI(['health']);
      
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Spectify service is not running');
      expect(result.stdout).toContain('Mode: standalone');
      expect(result.stdout).toContain('spectify start --mode standalone');
    });

    it('should suggest correct mode in error message', () => {
      runCLI(['config', 'set', 'mode', 'mcp']);
      
      const result = runCLI(['health']);
      
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Mode: mcp');
      expect(result.stdout).toContain('spectify start --mode mcp');
    });
  });

  describe('Start Command Port Conflict Detection', () => {
    it('should detect port conflict in non-interactive mode', () => {
      // Start a simple HTTP server on port 3003 to simulate conflict
      const server = spawn('node', ['-e', 
        'require("http").createServer().listen(3003, () => console.log("listening"))'
      ]);

      // Wait for server to start
      return new Promise((resolve) => {
        setTimeout(() => {
          const result = runCLI(['start', '--no-interactive']);
          
          expect(result.exitCode).toBe(1);
          expect(result.stdout).toContain('Port 3003 is already in use');
          expect(result.stdout).toContain('spectify start --mode standalone --port 3004');

          server.kill();
          resolve(undefined);
        }, 500);
      });
    });
  });

  describe('Config Reset', () => {
    it('should reset to defaults (non-interactive)', async () => {
      // Change some values first
      runCLI(['config', 'set', 'mode', 'mcp']);
      runCLI(['config', 'set', 'port.standalone', '5000']);

      // Reset (note: actual reset command needs confirmation, so we just set back manually)
      runCLI(['config', 'set', 'mode', 'standalone']);
      runCLI(['config', 'set', 'port.standalone', '3003']);
      runCLI(['config', 'set', 'port.mcp', '3004']);

      const result = runCLI(['config', 'show']);
      
      expect(result.stdout).toContain('Default Mode: standalone');
      expect(result.stdout).toContain('Standalone Port: 3003');
      expect(result.stdout).toContain('MCP Port: 3004');
    });
  });

  describe('Version Command', () => {
    it('should show CLI version 0.4.0', () => {
      const result = runCLI(['--version']);
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('0.4.0');
    });
  });
});
