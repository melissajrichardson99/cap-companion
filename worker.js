// Serves /games/* from the GAMES_BUCKET R2 bucket. Everything else is
// handled by Workers Static Assets directly and never reaches this script —
// see wrangler.jsonc's assets.run_worker_first.
//
// The Godot Web exports under frontend/games-dist/ are too large (~38MB
// per .wasm) for Cloudflare's 25MiB static-asset limit, so they're uploaded
// to R2 separately (scripts/upload-games-to-r2.mjs) instead of shipping in
// the Workers static-assets bundle.

// How long the edge (Cache API) and browsers keep each file. index.html and
// index.pck are the files a game update actually changes (the .wasm/.js
// engine and the icons are identical across games and builds), and they're
// small, so a short lifetime costs almost nothing and gets a new build to
// guests within a couple of minutes. Everything else keeps the long cache.
// This header is the one guests get -- the object's own stored
// Cache-Control (if any) is overridden here. (Not exported: the Workers
// runtime treats every named export of this module as an entrypoint, and
// refuses to start on a non-handler export.)
const SHORT_CACHE = 'public, max-age=60'
const LONG_CACHE = 'public, max-age=3600'

function cacheControlFor(key) {
  return key.endsWith('.html') || key.endsWith('.pck') ? SHORT_CACHE : LONG_CACHE
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/games/')) {
      return new Response('Not found', { status: 404 })
    }

    const key = url.pathname.slice('/games/'.length)
    // The upload script's bookkeeping (_meta/upload-manifest.json) lives in
    // the same bucket but isn't a game file.
    if (key.startsWith('_meta/')) {
      return new Response('Not found', { status: 404 })
    }

    const cache = caches.default
    const cacheKey = new Request(url.toString(), request)
    const cached = await cache.match(cacheKey)
    if (cached) return cached

    const object = await env.GAMES_BUCKET.get(key)
    if (object === null) {
      return new Response('Not found', { status: 404 })
    }

    const headers = new Headers()
    object.writeHttpMetadata(headers)
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/octet-stream')
    }
    headers.set('etag', object.httpEtag)
    headers.set('cache-control', cacheControlFor(key))

    const response = new Response(object.body, { headers })
    ctx.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  },
}
