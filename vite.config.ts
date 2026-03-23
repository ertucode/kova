import { defineConfig } from 'vitest/config'
import path from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    tailwindcss(),
  ],
  base: './',
  build: {
    outDir: 'dist-react',
    sourcemap: true,
    minify: false, // Disable minification to preserve function names
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        parallel: path.resolve(__dirname, 'parallel.html'),
        responseVisualizer: path.resolve(__dirname, 'response-visualizer.html'),
      },
      output: {
        // Preserve original names for better debugging
        compact: false,
      },
    },
  },
  server: {
    cors: true,
    port: 5123,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/ui'),
      '@common': path.resolve(__dirname, './src/common'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist-electron', 'dist-react'],
  },
})
