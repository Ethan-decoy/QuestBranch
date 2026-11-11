import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { developmentCsp } from './config/development-csp'

// Mastra supports several AI SDK majors through npm aliases. Bundle that graph
// before electron-builder flattens node_modules and loses version-specific peers.
const memoryDependencies = Object.keys(
  JSON.parse(readFileSync(resolve('node_modules/@mastra/core/package.json'), 'utf8')).dependencies,
)
const memorySdk = memoryDependencies.filter(
  (name) =>
    name.startsWith('@ai-sdk/') ||
    name.startsWith('@internal/ai') ||
    name.startsWith('@openrouter/'),
)

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: [
          'sessionweave',
          '@mastra/core',
          '@mastra/memory',
          '@mastra/schema-compat',
          'ai',
          ...memorySdk,
          '@ai-sdk/provider',
          '@ai-sdk/provider-utils',
          '@openrouter/ai-sdk-provider',
        ],
      },
      rollupOptions: {
        input: {
          index: resolve('src/desktop/main.ts'),
          'research-mcp-stdio': resolve('src/desktop/research-mcp-stdio.ts'),
          'update-transport': resolve('src/desktop/update-transport.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/desktop/preload.ts') },
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/ui'),
    plugins: [react(), tailwindcss(), developmentCsp()],
    build: { rollupOptions: { input: resolve('src/ui/index.html') } },
  },
})
