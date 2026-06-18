import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Exclude tests that require external services or cause hangs:
    // - cli-config.test.ts: spawns CLI processes, needs manual testing
    // - e2e.test.ts, performance.test.ts: require MCP server, run with npm run test:mcp
    exclude: [
      '**/node_modules/**',
      'tests/integration/cli-config.test.ts',
      'tests/integration/e2e.test.ts',
      'tests/integration/performance.test.ts'
    ],
    testTimeout: 10000, // 10 second timeout per test
    hookTimeout: 30000, // 30 second timeout for hooks (server startup)
    
    // Run integration tests sequentially to avoid port conflicts
    fileParallelism: false,
    
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/mock-server.ts', 'src/**/*.test.ts']
    }
  }
});
