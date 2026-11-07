import { defineConfig } from 'vitest/config'
import { availableParallelism } from 'node:os'
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    maxWorkers: Math.min(4, availableParallelism()),
  },
})
