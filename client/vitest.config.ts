import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirror the workspace alias so @gonidhi/shared resolves correctly
      '@gonidhi/shared': resolve(__dirname, '../packages/shared/index.ts'),
    },
  },
  test: {
    // ── TypeScript config (separate from build — tests/ excluded from vite build) ─
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },

    // ── Environment ──────────────────────────────────────────────────────────
    environment: 'jsdom',

    // ── Test file discovery (all inside /tests, NOT inside /src) ─────────────
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],

    // ── Global setup ─────────────────────────────────────────────────────────
    setupFiles: ['./tests/setup.ts'],

    // ── Coverage ─────────────────────────────────────────────────────────────
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json', 'json-summary'],
      reportsDirectory: './tests/reports/coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/**/*.d.ts',
        'src/**/index.ts',
      ],
      thresholds: {
        branches: 0,
        functions: 0,
        lines: 0,
        statements: 0,
      },
    },

    // ── HTML report (mirrors server's jest-html-reporter) ────────────────────
    reporters: [
      'default',
      ['html', { outputFile: './tests/reports/index.html' }],
    ],

    // ── Misc ─────────────────────────────────────────────────────────────────
    globals: true,
    testTimeout: 15000,
  },
});
