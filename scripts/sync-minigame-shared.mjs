#!/usr/bin/env node
// Copies the shared minigame files into each Godot project. Godot can't load
// res:// files from outside a project, so every game keeps its own copy of
// minigames/_shared/EndCard.gd. This also writes the export preset's
// html/head_include: an inline script that posts { type: 'minigame-hello' }
// to the host page before the engine boots, telling MinigameOverlay this
// build reports round results (see MinigameOverlay.tsx).
//
// Edit minigames/_shared/, then run this, then re-export the games.
//
// Usage: node scripts/sync-minigame-shared.mjs [--check] [slug ...]
//   no slugs  -> every project under minigames/ that already uses EndCard
//                (has scripts/EndCard.gd), so unconverted games are skipped
//   --check   -> change nothing; exit 1 if any copy is out of date

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'minigames')
const sharedEndCard = readFileSync(path.join(root, '_shared', 'EndCard.gd'), 'utf8')

const args = process.argv.slice(2)
const check = args.includes('--check')
let slugs = args.filter((a) => !a.startsWith('--'))
if (slugs.length === 0) {
  slugs = readdirSync(root).filter((d) => existsSync(path.join(root, d, 'scripts', 'EndCard.gd')))
}

// No double quotes: the value sits inside a double-quoted export_presets.cfg
// string. The id lets e2e strip it to simulate an old build.
function helloScript(slug) {
  return (
    `<script id=cap-minigame-hello>try{if(window.parent!==window)` +
    `window.parent.postMessage({type:'minigame-hello',game:'${slug}'},'*')}catch(e){}</script>`
  )
}

let stale = 0
for (const slug of slugs) {
  const project = path.join(root, slug)
  if (!existsSync(path.join(project, 'project.godot'))) {
    console.error(`${slug}: not a Godot project under minigames/`)
    process.exit(1)
  }

  const endCardPath = path.join(project, 'scripts', 'EndCard.gd')
  const current = existsSync(endCardPath) ? readFileSync(endCardPath, 'utf8') : null
  if (current !== sharedEndCard) {
    stale++
    if (check) console.log(`${slug}: scripts/EndCard.gd is out of date`)
    else writeFileSync(endCardPath, sharedEndCard)
  }

  const presetPath = path.join(project, 'export_presets.cfg')
  const preset = readFileSync(presetPath, 'utf8')
  const updated = preset.replace(/^html\/head_include=.*$/m, `html/head_include="${helloScript(slug)}"`)
  if (!/^html\/head_include=/m.test(preset)) {
    console.error(`${slug}: export_presets.cfg has no html/head_include line`)
    process.exit(1)
  }
  if (updated !== preset) {
    stale++
    if (check) console.log(`${slug}: export_presets.cfg head_include is out of date`)
    else writeFileSync(presetPath, updated)
  }
  if (!check) console.log(`${slug}: synced`)
}

if (check && stale > 0) process.exit(1)
