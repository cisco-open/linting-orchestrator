/**
 * Port Checker - Utility to check if a port is available
 */

import net from 'net';

export interface PortCheckResult {
  available: boolean;
  port: number;
}

/**
 * Check if a port is available
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, '0.0.0.0');
  });
}

/**
 * Find the next available port starting from a given port
 */
export async function findAvailablePort(
  startPort: number,
  maxAttempts: number = 10
): Promise<number | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }
  return null;
}

/**
 * Check multiple ports and return their availability status
 */
export async function checkPorts(ports: number[]): Promise<PortCheckResult[]> {
  const results = await Promise.all(
    ports.map(async (port) => ({
      port,
      available: await isPortAvailable(port),
    }))
  );
  return results;
}
