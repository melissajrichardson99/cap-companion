// Serves /games/* from the GAMES_BUCKET R2 bucket. Everything else is
// handled by Workers Static Assets directly and never reaches this script —
// see wrangler.jsonc's assets.run_worker_first.
//
// The Godot Web exports under frontend/games-dist/ are too large (~38MB
// per .wasm) for Cloudflare's 25MiB static-asset limit, so they're uploaded
// to R2 separately (scripts/upload-games-to-r2.mjs) instead of shipping in
// the Workers static-assets bundle.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/games/')) {
      return new Response('Not found', { status: 404 })
    }

    const cache = caches.default
    const cacheKey = new Request(url.toString(), request)
    const cached = await cache.match(cacheKey)
    if (cached) return cached

    const key = url.pathname.slice('/games/'.length)
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
    headers.set('cache-control', 'public, max-age=3600')

    const response = new Response(object.body, { headers })
    ctx.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  },
}
