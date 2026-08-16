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
import { execSync } from 'node:child_process'

// Windows: `npx`/`wrangler` resolve to .cmd shims, which the OS can only
// launch via cmd.exe, so `shell: true` is unavoidable here. As of Node 20+,
// execFileSync/spawn no longer escapes args for you when shell is a string
// or true (see DEP0190) — it just space-joins the array, so any arg with a
// space or shell metacharacter (e.g. "public, max-age=3600") silently splits
// into multiple argv entries. Quote every arg ourselves and build a single
// command string instead of relying on that.
function shellQuote(arg) {
  const str = String(arg)
  if (str.length > 0 && !/[\s"^&|<>%,;]/.test(str)) return str
  return `"${str.replace(/"/g, '""')}"`
}

function run(args) {
  execSync(args.map(shellQuote).join(' '), { stdio: 'inherit' })
}

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
  run([
    'npx', 'wrangler', 'r2', 'object', 'put', `${bucket}/${key}`,
    '--file', filePath,
    '--content-type', contentType,
    '--cache-control', 'public, max-age=3600',
    '--remote',
  ])
  count++
}
console.log(`done — uploaded ${count} files to r2://${bucket}`)
