/**
 * Embedded Server Lifecycle Management
 * 
 * Handles auto-start/stop of embedded server for CLI commands
 */

import { startServer } from '../../server.js';
import { createEmbeddedModeConfig } from '../../config.js';
import { getConfigManager } from '../config-manager.js';

/**
 * Start embedded server if needed based on CLI config
 * Returns shutdown function to be called in finally block
 * 
 * @param apiUrl Optional API URL override (if provided, don't start embedded server)
 * @returns Shutdown function or null if server not started
 */
export async function maybeStartEmbeddedServer(
  apiUrl?: string
): Promise<(() => Promise<void>) | null> {
  // If explicit API URL provided, assume external server
  if (apiUrl) {
    return null;
  }

  // Check CLI config for mode
  const configManager = getConfigManager();
  const config = await configManager.get();
  
  // Only auto-start if in embedded mode
  if (config.defaultMode !== 'embedded') {
    return null;
  }

  // Start embedded server (TODO: add quiet flag to startServer())
  const serverConfig = createEmbeddedModeConfig();
  const server = await startServer(serverConfig);
  
  // Return shutdown function
  return async () => {
    // Forcefully close server
    try {
      await server.shutdown();
    } catch (error) {
      // Ignore shutdown errors in embedded mode
    }
    
    // Force exit after brief delay if still hanging
    setTimeout(() => {
      process.exit(0);
    }, 1000).unref();
  };
}

/**
 * Get API URL based on current CLI configuration
 * 
 * @param explicitUrl Optional explicit URL override
 * @returns API URL to use
 */
export async function getApiUrl(explicitUrl?: string): Promise<string> {
  if (explicitUrl) {
    return explicitUrl;
  }

  const configManager = getConfigManager();
  const config = await configManager.get();
  const port = config.ports[config.defaultMode];

  return `http://localhost:${port}`;
}
