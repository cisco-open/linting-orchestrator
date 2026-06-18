#!/usr/bin/env node
/**
 * Main entry point for the Linting Reports Service
 */

import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { DatabaseAdapter } from './database.js';
import { createServer } from './server.js';
import type { ReportServiceConfig } from './types.js';
import { resolve } from 'path';

// --version / -V: print package version and exit (before any server startup)
if (process.argv.includes('--version') || process.argv.includes('-V')) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
  console.log(`Linting Reports v${pkg.version}`);
  process.exit(0);
}

// Load .env file if it exists
dotenv.config();

/**
 * Resolve the home directory.
 * SPECTIFY_HOME env var overrides the default ~/.spectify.
 */
function spectifyHome(): string {
  return process.env.SPECTIFY_HOME || join(homedir(), '.spectify');
}

/**
 * Load configuration from environment variables
 */
function loadConfig(): ReportServiceConfig {
  const env = process.env.NODE_ENV || 'development';
  const isProduction = env === 'production';
  
  // Get API key
  let apiKey = process.env.SPECTIFYR_API_KEY;
  
  // Development mode: Auto-generate API key with warning
  if (!apiKey && !isProduction) {
    apiKey = 'dev-auto-generated-key-' + Date.now();
    console.warn('⚠️  WARNING: Running in development mode with auto-generated API key');
    console.warn('   For production, set SPECTIFYR_API_KEY in .env file');
    console.warn('   Generate secure key: openssl rand -hex 32\n');
  }
  
  // Production mode: Require API key
  if (!apiKey && isProduction) {
    throw new Error(
      '❌ PRODUCTION ERROR: Missing required environment variable: SPECTIFYR_API_KEY\n\n' +
      'Production mode requires a secure API key to be set.\n\n' +
      'Setup:\n' +
      '  1. Copy .env.example to .env\n' +
      '  2. Generate a secure key: openssl rand -hex 32\n' +
      '  3. Set SPECTIFYR_API_KEY in .env file\n' +
      '  4. Restart the server\n\n' +
      'For development/testing, use: npm run dev\n'
    );
  }

  // Database path: SPECTIFYR_DB_PATH > SPECTIFY_HOME/reports/database/reports.db
  const defaultDbPath = join(spectifyHome(), 'reports', 'database', 'reports.db');
  
  const dbPath = process.env.SPECTIFYR_DB_PATH 
    || process.env.DATABASE_PATH  // Legacy support
    || defaultDbPath;

  // Port and host
  const port = parseInt(process.env.SPECTIFYR_PORT || process.env.PORT || '3010');
  const host = process.env.SPECTIFYR_HOST || process.env.HOST || '0.0.0.0';
  
  // Expand tilde in case user supplied SPECTIFYR_DB_PATH with a leading ~
  const expandedDbPath = dbPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE || homedir());

  return {
    port,
    host,
    apiKey: apiKey!,
    database: {
      type: 'sqlite',
      path: expandedDbPath,
    },
    logLevel: (process.env.LOG_LEVEL as ReportServiceConfig['logLevel']) || 'info',
    environment: env,
    pendingDir: process.env.SPECTIFYR_PENDING_DIR || join(spectifyHome(), 'reports', 'pending'),
    deadLetterDir: process.env.SPECTIFYR_DEAD_LETTER_DIR || join(spectifyHome(), 'reports', 'dead-letter'),
  };
}

/**
 * Main application startup
 */
async function main() {
  try {
    // Load configuration
    const config = loadConfig();

    // Initialize database
    const database = new DatabaseAdapter(config.database.path);

    // Create and start server
    const app = await createServer(config, database);

    // Temporarily lower log level to avoid Fastify's interface logging
    const originalLevel = app.log.level;
    app.log.level = 'silent';
    
    await app.listen({
      port: config.port,
      host: config.host,
    });
    
    // Restore log level
    app.log.level = originalLevel;

    // Show single startup message
    const url = config.host === '0.0.0.0' 
      ? `http://localhost:${config.port}` 
      : `http://${config.host}:${config.port}`;
    
    const dbPath = resolve(config.database.path);
    
    app.log.info(`🚀 Report Service started on ${url}`);
    app.log.info(`📊 Database: ${dbPath}`);
    app.log.info(`❤️  Health check: ${url}/health`);

    // Graceful shutdown
    let isShuttingDown = false;
    const shutdown = async (signal: string) => {
      if (isShuttingDown) {
        // Force exit on second signal
        app.log.warn('Force shutting down...');
        process.exit(1);
      }
      isShuttingDown = true;
      
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      try {
        await app.close();
        database.close();
        process.exit(0);
      } catch (error) {
        app.log.error({ error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    console.error('Failed to start Report Service:', error);
    process.exit(1);
  }
}

// Start the application
main();
