import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules/**', 'data/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.js'],
      exclude: [
        'src/claude-process.js', // External SDK wrapper, difficult to mock
        'src/terminal-manager.js', // PTY terminals require special handling
      ],
    },
    testTimeout: 10000,
    setupFiles: ['./tests/setup.js'],
    // Ensure each test file gets a fresh module state
    isolate: true,
    // Pool configuration for better performance
    pool: 'forks',
  },
});
