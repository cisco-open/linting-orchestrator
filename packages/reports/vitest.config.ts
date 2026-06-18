// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'build/',
        'examples/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData.ts'
      ]
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
