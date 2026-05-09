import path from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export function createFrontendPlugins() {
  return [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    tailwindcss(),
  ]
}

export const frontendResolve = {
  alias: {
    '@': path.resolve(__dirname, './src/ui'),
    '@common': path.resolve(__dirname, './src/common'),
  },
}
