import { defineConfig } from 'vite'
import path from 'path'
import { createFrontendPlugins, frontendResolve } from './vite.shared'

export default defineConfig({
  plugins: createFrontendPlugins(),
  base: './',
  publicDir: false,
  build: {
    outDir: 'public/generated/response-visualizer',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      input: {
        responseVisualizer: path.resolve(__dirname, 'response-visualizer.html'),
      },
      output: {
        compact: false,
      },
    },
  },
  resolve: frontendResolve,
})
