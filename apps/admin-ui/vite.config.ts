import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath, URL } from 'node:url'

const appDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, appDir, ''))
  return {
    envDir: appDir,
    server: { port: 3000 },
    ssr: { external: ['pg', '@electric-sql/pglite'] },
    resolve: {
      tsconfigPaths: true,
      alias: [
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      ],
    },
    plugins: [tanstackStart(), tailwindcss(), react()],
  }
})
