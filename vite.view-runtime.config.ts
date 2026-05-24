import { defineConfig } from 'vite'
import path from 'path'
import { createFrontendPlugins, frontendResolve } from './vite.shared'

export default defineConfig({
  plugins: createFrontendPlugins(),
  base: './',
  publicDir: false,
  build: {
    outDir: 'public/generated/view-runtime',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      input: {
        viewRuntime: path.resolve(__dirname, 'view-runtime.html'),
      },
      output: {
        compact: false,
      },
    },
  },
  resolve: frontendResolve,
})
