import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/integration/globalSetup.ts'],
    testTimeout: 60_000,
  },
});
