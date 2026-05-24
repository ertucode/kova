import { defineConfig } from 'vite'
import path from 'path'
import { createFrontendPlugins, frontendResolve } from './vite.shared'

const viewRuntimeResolve = {
  alias: [
    ...Object.entries(frontendResolve.alias).map(([find, replacement]) => ({ find, replacement })),
    { find: /^react$/, replacement: path.resolve(__dirname, 'node_modules/react/cjs/react.development.js') },
    {
      find: /^react\/jsx-runtime$/,
      replacement: path.resolve(__dirname, 'node_modules/react/cjs/react-jsx-runtime.development.js'),
    },
    {
      find: /^react\/jsx-dev-runtime$/,
      replacement: path.resolve(__dirname, 'node_modules/react/cjs/react-jsx-dev-runtime.development.js'),
    },
    {
      find: /^react-dom\/client$/,
      replacement: path.resolve(__dirname, 'node_modules/react-dom/cjs/react-dom-client.development.js'),
    },
    {
      find: /^react-refresh\/runtime$/,
      replacement: path.resolve(__dirname, 'node_modules/react-refresh/cjs/react-refresh-runtime.development.js'),
    },
  ],
}

export default defineConfig({
  plugins: createFrontendPlugins(),
  base: './',
  publicDir: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
  },
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
  resolve: viewRuntimeResolve,
})
