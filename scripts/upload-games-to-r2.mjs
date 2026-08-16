#!/usr/bin/env node
// Uploads frontend/games-dist/ to the R2 bucket the Worker reads from
// (see worker.js, wrangler.jsonc's r2_buckets). Re-run after every
// minigame re-export — R2 has no build-time hook into this, unlike
// Cloudflare's own static-assets pipeline.
//
// Usage: node scripts/upload-games-to-r2.mjs [bucket-name]
// Requires: `wrangler login` already run, or CLOUDFLARE_API_TOKEN set.

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream',
  '.png': 'image/png',
}

const bucket = process.argv[2] ?? 'cap-companion-games'
const gamesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'games-dist')

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else {
      yield full
    }
  }
}

let count = 0
for (const filePath of walk(gamesDir)) {
  const key = path.relative(gamesDir, filePath).split(path.sep).join('/')
  const contentType = MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream'
  const sizeMB = (statSync(filePath).size / (1024 * 1024)).toFixed(1)
  console.log(`uploading ${key} (${sizeMB} MB, ${contentType})`)
  execFileSync(
    'npx',
    [
      'wrangler', 'r2', 'object', 'put', `${bucket}/${key}`,
      '--file', filePath,
      '--content-type', contentType,
      '--cache-control', 'public, max-age=3600',
      '--remote',
    ],
    { stdio: 'inherit', shell: true },
  )
  count++
}
console.log(`done — uploaded ${count} files to r2://${bucket}`)
