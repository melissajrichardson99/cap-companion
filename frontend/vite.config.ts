import { existsSync, statSync, createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream',
  '.png': 'image/png',
}

// Dev-only mirror of production's Worker R2 route (see ../worker.js):
// games-dist/ is too large for Vite's public/ dir (would blow Cloudflare's
// per-file asset limit if bundled), so it's served from outside public/ by
// a matching mechanism in both places rather than relying on Vite's default
// static serving.
function serveGamesDist(): Plugin {
  const gamesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'games-dist')
  return {
    name: 'serve-games-dist',
    configureServer(server) {
      server.middlewares.use('/games', (req, res, next) => {
        const requestPath = decodeURIComponent((req.url ?? '').split('?')[0] ?? '')
        const filePath = path.join(gamesDir, requestPath)
        if (!filePath.startsWith(gamesDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          next()
          return
        }
        res.setHeader('Content-Type', MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream')
        createReadStream(filePath).pipe(res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serveGamesDist()],
})
