import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      JWT_SECRET: 'test-jwt-secret',
      JWT_REFRESH_SECRET: 'test-jwt-refresh-secret',
      DATABASE_URL: 'file:./test.db',
    },
  },
});
