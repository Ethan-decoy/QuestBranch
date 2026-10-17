import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { developmentCsp } from './config/development-csp'

export default defineConfig({
  main: { build: { rollupOptions: { input: { index: resolve('src/desktop/main.ts') } } } },
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
