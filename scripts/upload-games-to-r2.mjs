#!/usr/bin/env node
// Uploads frontend/games-dist/ to the R2 bucket the Worker reads from
// (see worker.js, wrangler.jsonc's r2_buckets). Re-run after every
// minigame re-export — R2 has no build-time hook into this, unlike
// Cloudflare's own static-assets pipeline. Full flow: DEPLOYMENT.md §2.4.
//
// Usage:
//   node scripts/upload-games-to-r2.mjs --dry-run                  # plan only, no writes
//   node scripts/upload-games-to-r2.mjs --dry-run --verify-remote  # plan against the live bytes
//   node scripts/upload-games-to-r2.mjs                            # asks you to type the bucket name
//   node scripts/upload-games-to-r2.mjs --yes                      # no prompt
//
// Flags:
//   --bucket <name>    target bucket (default cap-companion-games; a bare
//                      first argument also works, as before)
//   --dry-run          print what would be uploaded or skipped and why; no writes
//   --yes              skip the typed confirmation for a real run
//   --force-all        upload every file, changed or not
//   --verify-remote    decide "unchanged" by downloading each live object and
//                      hashing it, instead of trusting the manifest (slow:
//                      downloads the whole bucket; read-only)
//   --only <slug,...>  limit the run to these games
//   --local <dir>      use wrangler's local R2 simulator persisted in <dir>
//                      instead of the real bucket (for testing this script)
//
// Requires `wrangler login` already run (or CLOUDFLARE_API_TOKEN set).
//
// How "unchanged" is decided: the script keeps a manifest object in the
// bucket (MANIFEST_KEY) recording the size and SHA-256 of every file it has
// uploaded or verified. A file whose local size and SHA-256 match its
// manifest entry is skipped; anything else -- changed, never recorded, or
// the manifest unreadable -- is uploaded. wrangler can't list objects or set
// custom metadata, and R2's ETag isn't guaranteed to be a plain MD5, so the
// manifest is the source of truth. A file uploaded outside this script won't
// be reflected in it: use --verify-remote (or --force-all) after that.

import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Pinned so a new wrangler release can't change upload behaviour under us.
// Override (tests only) with WRANGLER_CMD, e.g. a mock script.
const WRANGLER_VERSION = '4.142.0'
const MANIFEST_KEY = '_meta/upload-manifest.json'
const DEFAULT_BUCKET = 'cap-companion-games'
const RETRY_DELAYS_MS = [2_000, 5_000] // two retries after the first attempt

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream',
  '.png': 'image/png',
}

// Upload order within a game: the engine and support files first, then the
// game data (index.pck), then the entry page (index.html) last -- so a run
// that stops part-way never leaves a new index.html pointing at older files.
function uploadRank(name) {
  if (name.endsWith('.wasm')) return 0
  if (name.endsWith('.js')) return 1
  if (name.endsWith('.pck')) return 3
  if (name.endsWith('.html')) return 4
  return 2
}

// Windows: `npx`/`wrangler` resolve to .cmd shims, which the OS can only
// launch via cmd.exe, so a shell is unavoidable here. As of Node 20+,
// spawn/exec no longer escape args for you when shell is true (see
// DEP0190) -- they just space-join the array, so any arg with a space or
// shell metacharacter silently splits into multiple argv entries. Quote
// every arg ourselves and build a single command string instead.
function shellQuote(arg) {
  const str = String(arg)
  if (str.length > 0 && !/[\s"^&|<>%,;]/.test(str)) return str
  return `"${str.replace(/"/g, '""')}"`
}

function parseArgs(argv) {
  const opts = { bucket: DEFAULT_BUCKET, dryRun: false, yes: false, forceAll: false, verifyRemote: false, only: null, local: null }
  const rest = [...argv]
  let positionalBucket = null
  while (rest.length) {
    const arg = rest.shift()
    if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--yes') opts.yes = true
    else if (arg === '--force-all') opts.forceAll = true
    else if (arg === '--verify-remote') opts.verifyRemote = true
    else if (arg === '--bucket') opts.bucket = need(arg, rest.shift())
    else if (arg === '--only') opts.only = need(arg, rest.shift()).split(',').map((s) => s.trim()).filter(Boolean)
    else if (arg === '--local') opts.local = path.resolve(need(arg, rest.shift()))
    else if (arg.startsWith('--')) fail(`unknown flag ${arg}`)
    else if (positionalBucket === null) positionalBucket = arg
    else fail(`unexpected argument ${arg}`)
  }
  if (positionalBucket !== null) opts.bucket = positionalBucket
  return opts
}

function need(flag, value) {
  if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value`)
  return value
}

function fail(message) {
  console.error(`error: ${message}`)
  process.exit(2)
}

const opts = parseArgs(process.argv.slice(2))
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const gamesDir = path.join(repoRoot, 'frontend', 'games-dist')
const wranglerBase = process.env.WRANGLER_CMD ? process.env.WRANGLER_CMD.trim().split(/\s+/) :['npx', '--yes', `wrangler@${WRANGLER_VERSION}`]
const storageArgs = opts.local ? ['--local', '--persist-to', opts.local] : ['--remote']

function wrangler(args) {
  const command = [...wranglerBase, ...args].map(shellQuote).join(' ')
  const res = spawnSync(command, { shell: true, cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim() }
}

function firstErrorLine(output) {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines.find((l) => /error|✘|not exist|not found|unauthor|forbidden/i.test(l)) ?? lines.at(-1) ?? '(no output)'
}

function isNotFound(output) {
  return /does not exist|not found|NoSuchKey|10007/i.test(output)
}

// Downloads one object into a temp file. Returns { status: 'ok', buffer }
// | { status: 'missing' } | { status: 'error', reason }.
function getObject(key, scratch) {
  const out = path.join(scratch, `get-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const res = wrangler(['r2', 'object', 'get', `${opts.bucket}/${key}`, '--file', out, ...storageArgs])
  if (!res.ok) return isNotFound(res.output) ? { status: 'missing' } : { status: 'error', reason: firstErrorLine(res.output) }
  try {
    return { status: 'ok', buffer: readFileSync(out) }
  } catch {
    // Some wrangler versions report success for a missing key without
    // writing anything.
    return { status: 'missing' }
  } finally {
    rmSync(out, { force: true })
  }
}

function putObject(key, filePath, contentType) {
  return wrangler(['r2', 'object', 'put', `${opts.bucket}/${key}`, '--file', filePath, '--content-type', contentType, ...storageArgs])
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---- 1. Local files, in upload order.

function scanGames() {
  const games = readdirSync(gamesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  if (opts.only) {
    const unknown = opts.only.filter((s) => !games.includes(s))
    if (unknown.length) fail(`--only: no such game in frontend/games-dist: ${unknown.join(', ')}`)
  }
  return games
    .filter((slug) => !opts.only || opts.only.includes(slug))
    .map((slug) => {
      const dir = path.join(gamesDir, slug)
      const files = []
      const ignored = []
      for (const name of readdirSync(dir).sort()) {
        const filePath = path.join(dir, name)
        if (!statSync(filePath).isFile()) continue
        // Godot editor metadata written next to an export; never shipped.
        if (name.endsWith('.import') || name.startsWith('.')) {
          ignored.push(name)
          continue
        }
        const buffer = readFileSync(filePath)
        files.push({
          slug,
          name,
          key: `${slug}/${name}`,
          filePath,
          size: buffer.length,
          sha256: sha256(buffer),
          contentType: MIME_TYPES[path.extname(name)] ?? 'application/octet-stream',
        })
      }
      files.sort((a, b) => uploadRank(a.name) - uploadRank(b.name) || a.name.localeCompare(b.name))
      return { slug, files, ignored }
    })
}

// ---- 2. What the bucket has.

function loadManifest(scratch) {
  const res = getObject(MANIFEST_KEY, scratch)
  if (res.status === 'missing') return { files: {}, note: 'no manifest in the bucket yet' }
  if (res.status === 'error') {
    console.error(`\nCould not read ${opts.bucket}/${MANIFEST_KEY}: ${res.reason}`)
    console.error('Check `npx wrangler@' + WRANGLER_VERSION + ' whoami` (login) and the bucket name. Nothing was changed.')
    process.exit(1)
  }
  try {
    const parsed = JSON.parse(res.buffer.toString('utf8'))
    return { files: parsed.files ?? {}, note: `manifest read (${Object.keys(parsed.files ?? {}).length} entries)` }
  } catch {
    return { files: {}, note: 'manifest unreadable (not valid JSON) -- every file treated as unknown' }
  }
}

function decide(file, manifest, scratch) {
  if (opts.forceAll) return { upload: true, reason: '--force-all' }
  if (opts.verifyRemote) {
    const res = getObject(file.key, scratch)
    if (res.status === 'missing') return { upload: true, reason: 'not in bucket' }
    if (res.status === 'error') return { upload: true, reason: `live state unknown (${res.reason})` }
    if (res.buffer.length === file.size && sha256(res.buffer) === file.sha256) {
      return { upload: false, reason: 'same bytes as live object', record: true }
    }
    return { upload: true, reason: 'live object differs' }
  }
  const entry = manifest.files[file.key]
  if (!entry) return { upload: true, reason: 'not in manifest (state unknown)' }
  if (entry.size === file.size && entry.sha256 === file.sha256) return { upload: false, reason: 'unchanged (manifest)' }
  return { upload: true, reason: 'changed since last upload' }
}

// ---- 3. Writes.

async function withRetries(label, fn) {
  let last
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      console.log(`    retry ${attempt}/${RETRY_DELAYS_MS.length} for ${label} in ${RETRY_DELAYS_MS[attempt - 1] / 1000}s`)
      await sleep(RETRY_DELAYS_MS[attempt - 1])
    }
    last = fn()
    if (last.ok) return last
    console.log(`    failed: ${firstErrorLine(last.output)}`)
  }
  return last
}

function writeManifest(manifest, scratch) {
  const out = path.join(scratch, 'upload-manifest.json')
  writeFileSync(out, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), files: manifest.files }, null, 2))
  return putObject(MANIFEST_KEY, out, 'application/json')
}

async function confirm(plan) {
  if (opts.yes) return true
  if (!process.stdin.isTTY) {
    console.error('REFUSED: not interactive and --yes not given -- nothing uploaded.')
    return false
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const typed = (await rl.question(`Type the bucket name (${opts.bucket}) to upload ${plan.count} file(s), ${mb(plan.bytes)}: `)).trim()
    if (typed === opts.bucket) return true
    console.error('REFUSED: confirmation did not match -- nothing uploaded.')
    return false
  } catch {
    console.error('REFUSED: no confirmation -- nothing uploaded.')
    return false
  } finally {
    rl.close()
  }
}

function resumeCommand() {
  const parts = ['node', 'scripts/upload-games-to-r2.mjs']
  if (opts.bucket !== DEFAULT_BUCKET) parts.push('--bucket', opts.bucket)
  if (opts.only) parts.push('--only', opts.only.join(','))
  if (opts.local) parts.push('--local', opts.local)
  parts.push('--yes')
  return parts.map(shellQuote).join(' ')
}

// ---- Main.

async function main() {
  const started = Date.now()
  const target = opts.local ? `LOCAL simulator (${opts.local})` : 'REMOTE'
  console.log(`Target bucket: ${opts.bucket}   storage: ${target}   wrangler: ${process.env.WRANGLER_CMD ? `WRANGLER_CMD=${process.env.WRANGLER_CMD}` : WRANGLER_VERSION}`)
  console.log(`Mode: ${opts.dryRun ? 'DRY RUN (no writes)' : 'UPLOAD'}${opts.forceAll ? ', --force-all' : ''}${opts.verifyRemote ? ', --verify-remote' : ''}${opts.only ? `, --only ${opts.only.join(',')}` : ''}\n`)

  const games = scanGames()
  const scratch = mkdtempSync(path.join(tmpdir(), 'r2-upload-'))
  try {
    const manifest = opts.forceAll ? { files: {}, note: 'not read (--force-all)' } : opts.verifyRemote ? { files: {}, note: 'not used (--verify-remote)' } : loadManifest(scratch)
    // Entries are kept for games outside --only, and replaced as files are
    // uploaded or verified below.
    const nextManifest = { files: { ...(opts.forceAll || opts.verifyRemote ? (loadManifestQuiet(scratch)) : manifest.files) } }
    console.log(`Manifest: ${manifest.note}${opts.verifyRemote ? ' -- downloading each live object to compare (slow)' : ''}\n`)

    const plan = { count: 0, bytes: 0 }
    for (const game of games) {
      console.log(`${game.slug}`)
      for (const file of game.files) {
        file.decision = decide(file, manifest, scratch)
        if (file.decision.upload) {
          plan.count++
          plan.bytes += file.size
        }
        const verb = file.decision.upload ? 'UPLOAD' : 'skip  '
        console.log(`  ${verb} ${file.key.padEnd(50)} ${mb(file.size).padStart(9)}  ${file.contentType.padEnd(26)} ${file.decision.reason}`)
      }
      for (const name of game.ignored) console.log(`  ignore ${`${game.slug}/${name}`.padEnd(50)} ${''.padStart(9)}  ${''.padEnd(26)} editor metadata, never uploaded`)
    }
    const total = games.reduce((n, g) => n + g.files.length, 0)
    console.log(`\nPlan: ${plan.count} to upload (${mb(plan.bytes)}), ${total - plan.count} to skip, ${total} files in ${games.length} game(s).`)

    if (opts.dryRun) {
      console.log('Dry run: nothing was written.')
      return 0
    }
    if (plan.count === 0 && !games.some((g) => g.files.some((f) => f.decision.record))) {
      console.log('Nothing to upload.')
      return 0
    }
    if (!(await confirm(plan))) return 1

    const uploaded = []
    const summary = []
    for (const game of games) {
      const gameStarted = Date.now()
      const row = { slug: game.slug, uploaded: 0, skipped: 0, bytes: 0 }
      let changed = false
      for (const file of game.files) {
        if (!file.decision.upload) {
          row.skipped++
          if (file.decision.record) {
            nextManifest.files[file.key] = { size: file.size, sha256: file.sha256 }
            changed = true
          }
          continue
        }
        console.log(`uploading ${file.key} (${mb(file.size)}, ${file.contentType})`)
        const res = await withRetries(file.key, () => putObject(file.key, file.filePath, file.contentType))
        if (!res.ok) {
          // Record what did land, so the resume run skips it.
          const saved = changed ? writeManifest(nextManifest, scratch).ok : true
          reportFailure(file, uploaded, games, saved)
          return 1
        }
        uploaded.push(file.key)
        nextManifest.files[file.key] = { size: file.size, sha256: file.sha256, uploadedAt: new Date().toISOString() }
        changed = true
        row.uploaded++
        row.bytes += file.size
      }
      if (changed) {
        const res = await withRetries(MANIFEST_KEY, () => writeManifest(nextManifest, scratch))
        if (!res.ok) {
          console.error(`\nFAILED to update ${MANIFEST_KEY} after ${game.slug}. Every file of ${game.slug} did upload;`)
          console.error('the next run just re-uploads them (they look unrecorded).')
          printUploadedAndRemaining(uploaded, games, null)
          console.error(`\nResume with:\n  ${resumeCommand()}`)
          return 1
        }
      }
      row.seconds = (Date.now() - gameStarted) / 1000
      summary.push(row)
    }

    console.log('\nSummary')
    for (const r of summary) {
      console.log(`  ${r.slug.padEnd(20)} uploaded ${String(r.uploaded).padStart(2)}  skipped ${String(r.skipped).padStart(2)}  ${mb(r.bytes).padStart(9)}  ${r.seconds.toFixed(1)}s`)
    }
    const sent = summary.reduce((n, r) => n + r.bytes, 0)
    console.log(`  ${'total'.padEnd(20)} uploaded ${String(uploaded.length).padStart(2)}  skipped ${String(summary.reduce((n, r) => n + r.skipped, 0)).padStart(2)}  ${mb(sent).padStart(9)}  ${((Date.now() - started) / 1000).toFixed(1)}s`)
    console.log(`done -- r2://${opts.bucket}`)
    return 0
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// --force-all / --verify-remote don't use the manifest to decide, but the
// run still updates it, so start from what's there (empty if unreadable).
function loadManifestQuiet(scratch) {
  const res = getObject(MANIFEST_KEY, scratch)
  if (res.status !== 'ok') return {}
  try {
    return JSON.parse(res.buffer.toString('utf8')).files ?? {}
  } catch {
    return {}
  }
}

function printUploadedAndRemaining(uploaded, games, failedKey) {
  console.error(`\nUploaded this run (${uploaded.length}):`)
  for (const k of uploaded) console.error(`  ${k}`)
  const remaining = games.flatMap((g) => g.files).filter((f) => f.decision.upload && !uploaded.includes(f.key))
  console.error(`Not uploaded (${remaining.length}):`)
  for (const f of remaining) console.error(`  ${f.key}${f.key === failedKey ? '   <- failed' : ''}`)
}

function reportFailure(file, uploaded, games, manifestSaved) {
  console.error(`\nFAILED: ${file.key} after ${RETRY_DELAYS_MS.length + 1} attempts. Stopping.`)
  printUploadedAndRemaining(uploaded, games, file.key)
  if (!manifestSaved) console.error(`(Also couldn't update ${MANIFEST_KEY}; the resume run re-uploads this game's earlier files.)`)
  console.error(`\n${file.slug}'s index.html was not replaced unless listed above, so that game still serves a consistent older build.`)
  console.error(`Resume with (unchanged files are skipped):\n  ${resumeCommand()}`)
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
