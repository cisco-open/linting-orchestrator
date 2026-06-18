/**
 * Config Manager - Manages CLI configuration in ~/.spectify/config.json
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Resolve the orchestrator home directory.
 * SPECTIFY_HOME env var overrides the default ~/.spectify.
 */
function spectifyHome(): string {
  return process.env.SPECTIFY_HOME || path.join(os.homedir(), '.spectify');
}

export type SpectifyMode = 'standalone' | 'embedded' | 'companion';

export interface SpectifyConfig {
  defaultMode: SpectifyMode;
  ports: {
    standalone: number;
    embedded: number;
    companion: number;
  };
  /**
   * Optional URL override for standalone and companion modes.
   * When set, this URL is used instead of http://localhost:<port>.
   * Useful for connecting to a remote spectifyd (e.g. a Docker container).
   * Takes lower precedence than the SPECTIFYD_URL environment variable.
   */
  url?: string;
  lastUsed?: {
    mode: SpectifyMode;
    port: number;
  };
}

export interface RunningProcess {
  pid: number;
  port: number;
  mode: SpectifyMode;
  startedAt: string;
}

export interface ProcessRegistry {
  [mode: string]: RunningProcess | null;
}

const DEFAULT_CONFIG: SpectifyConfig = {
  defaultMode: 'standalone',
  ports: {
    standalone: 3003,
    embedded: 3005,  // Separate port to avoid conflict with standalone (auto-start/stop per command)
    companion: 3004,  // Different port to avoid conflict with standalone
  },
};

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private processesPath: string;
  private config: SpectifyConfig | null = null;

  constructor() {
    this.configDir = spectifyHome();
    this.configPath = path.join(this.configDir, 'config.json');
    this.processesPath = path.join(this.configDir, 'processes.json');
  }

  /**
   * Ensure config directory exists
   */
  private async ensureConfigDir(): Promise<void> {
    try {
      await fs.access(this.configDir);
    } catch {
      await fs.mkdir(this.configDir, { recursive: true });
    }
  }

  /**
   * Load config from disk, create if doesn't exist
   */
  async load(): Promise<SpectifyConfig> {
    if (this.config) {
      return this.config;
    }

    await this.ensureConfigDir();

    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(content);
      
      // Validate and merge with defaults
      this.config = {
        ...DEFAULT_CONFIG,
        ...this.config,
        ports: {
          ...DEFAULT_CONFIG.ports,
          ...this.config?.ports,
        },
      };
    } catch (error) {
      // File doesn't exist or is invalid - create default
      this.config = { ...DEFAULT_CONFIG };
      await this.save();
    }

    return this.config;
  }

  /**
   * Save config to disk
   */
  async save(): Promise<void> {
    if (!this.config) {
      throw new Error('Config not loaded');
    }

    await this.ensureConfigDir();
    await fs.writeFile(
      this.configPath,
      JSON.stringify(this.config, null, 2),
      'utf-8'
    );
  }

  /**
   * Get current config (loads if not cached)
   */
  async get(): Promise<SpectifyConfig> {
    return await this.load();
  }

  /**
   * Update default mode
   */
  async setDefaultMode(mode: SpectifyMode): Promise<void> {
    const config = await this.load();
    config.defaultMode = mode;
    await this.save();
  }

  /**
   * Update port for a mode
   */
  async setPort(mode: SpectifyMode, port: number): Promise<void> {
    const config = await this.load();
    config.ports[mode] = port;
    await this.save();
  }

  /**
   * Update last used settings
   */
  async setLastUsed(mode: SpectifyMode, port: number): Promise<void> {
    const config = await this.load();
    config.lastUsed = { mode, port };
    await this.save();
  }

  /**
   * Get port for a specific mode
   */
  async getPort(mode: SpectifyMode): Promise<number> {
    const config = await this.load();
    return config.ports[mode];
  }

  /**
   * Get API URL for the given (or default) mode.
   *
   * Resolution order:
   *   1. SPECTIFYD_URL env var  (session override, highest priority)
   *   2. config.url             (persistent override via `spectify config set url <url>`)
   *   3. http://localhost:<port> (default)
   *
   * The URL override is intentionally ignored for `embedded` mode because
   * embedded mode manages a local process — it must always bind to localhost.
   */
  async getApiUrl(mode?: SpectifyMode): Promise<string> {
    const config = await this.load();
    const targetMode = mode || config.defaultMode;

    if (targetMode !== 'embedded') {
      if (process.env.SPECTIFYD_URL) {
        return process.env.SPECTIFYD_URL;
      }
      if (config.url) {
        return config.url;
      }
    }

    const port = config.ports[targetMode];
    return `http://localhost:${port}`;
  }

  /**
   * Set (or clear) the persistent URL override.
   * Pass undefined to remove the override and revert to localhost:<port>.
   */
  async setUrl(url: string | undefined): Promise<void> {
    const config = await this.load();
    config.url = url;
    await this.save();
  }

  /**
   * Reset config to defaults
   */
  async reset(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG };
    await this.save();
  }

  /**
   * Get config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Check if config file exists
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // Process Management
  // ============================================

  /**
   * Load process registry
   */
  private async loadProcesses(): Promise<ProcessRegistry> {
    try {
      const content = await fs.readFile(this.processesPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /**
   * Save process registry
   */
  private async saveProcesses(registry: ProcessRegistry): Promise<void> {
    await this.ensureConfigDir();
    await fs.writeFile(
      this.processesPath,
      JSON.stringify(registry, null, 2),
      'utf-8'
    );
  }

  /**
   * Register a running process
   */
  async registerProcess(mode: SpectifyMode, pid: number, port: number): Promise<void> {
    const registry = await this.loadProcesses();
    registry[mode] = {
      pid,
      port,
      mode,
      startedAt: new Date().toISOString(),
    };
    await this.saveProcesses(registry);
  }

  /**
   * Unregister a process
   */
  async unregisterProcess(mode: SpectifyMode): Promise<void> {
    const registry = await this.loadProcesses();
    delete registry[mode];
    await this.saveProcesses(registry);
  }

  /**
   * Get running process for a mode
   */
  async getProcess(mode: SpectifyMode): Promise<RunningProcess | null> {
    const registry = await this.loadProcesses();
    const process = registry[mode];
    
    if (!process) {
      return null;
    }

    // Check if process is actually running
    if (!this.isProcessRunning(process.pid)) {
      // Clean up stale entry
      await this.unregisterProcess(mode);
      return null;
    }

    return process;
  }

  /**
   * Get all running processes
   */
  async getAllProcesses(): Promise<RunningProcess[]> {
    const registry = await this.loadProcesses();
    const processes: RunningProcess[] = [];

    for (const [mode, process] of Object.entries(registry)) {
      if (process && this.isProcessRunning(process.pid)) {
        processes.push(process);
      } else if (process) {
        // Clean up stale entry
        await this.unregisterProcess(mode as SpectifyMode);
      }
    }

    return processes;
  }

  /**
   * Check if a process is running
   */
  private isProcessRunning(pid: number): boolean {
    try {
      // Sending signal 0 checks if process exists without actually sending a signal
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find process by port
   */
  async getProcessByPort(port: number): Promise<RunningProcess | null> {
    const registry = await this.loadProcesses();
    
    for (const proc of Object.values(registry)) {
      if (proc && proc.port === port && this.isProcessRunning(proc.pid)) {
        return proc;
      }
    }

    return null;
  }
}

// Singleton instance
let instance: ConfigManager | null = null;

export function getConfigManager(): ConfigManager {
  if (!instance) {
    instance = new ConfigManager();
  }
  return instance;
}
