import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  // Vitest 4 moved poolOptions to top level. Single-fork keeps the in-memory
  // rate-limiter Map shared across describes, which is what these tests assume.
  pool: 'forks',
  poolOptions: { forks: { singleFork: true } },
})
