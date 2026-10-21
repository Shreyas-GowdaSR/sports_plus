import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
    // Rebuilding dist/ while the dev server runs must not crash its file watcher.
    watch: { ignored: ['**/dist/**'] },
  },
})
