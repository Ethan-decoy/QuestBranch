import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { developmentCsp } from './config/development-csp'

export default defineConfig({
  root: resolve('src/ui'),
  plugins: [react(), tailwindcss(), developmentCsp()],
  build: { outDir: resolve('dist-web'), emptyOutDir: true },
})
