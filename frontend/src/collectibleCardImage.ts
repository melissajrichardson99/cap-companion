import { toBlob } from 'html-to-image'

// Rasterizes a CollectibleCardVisual DOM node to PNG for download/share.
// There's no image-export code anywhere else in this app -- the Scoring
// Sheet's "Download Summary" (scoringSummaryHtml.ts) exports a standalone
// HTML file, not an image -- so this is the one place html-to-image (the
// one new frontend dependency this feature adds) is used.
//
// pixelRatio is fixed regardless of the node's on-screen CSS size (which
// varies a lot -- a large purchase-reveal card vs. a small gallery
// thumbnail) so a re-download from the gallery isn't a blurry downscaled
// capture of a shrunk thumbnail.
const PIXEL_RATIO = 3

async function captureBlob(node: HTMLElement): Promise<Blob> {
  const blob = await toBlob(node, { pixelRatio: PIXEL_RATIO })
  if (!blob) throw new Error('Could not generate card image')
  return blob
}

function slugifyFilename(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
}

export function cardFilename(animalName: string, guestName: string): string {
  return `${slugifyFilename(animalName)}-${slugifyFilename(guestName)}-cobbs-card.png`
}

// Same Blob+anchor download pattern as ScoringSessionModal.tsx's
// downloadSummary, just with an image blob instead of an HTML blob.
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function downloadCard(node: HTMLElement, filename: string): Promise<void> {
  triggerDownload(await captureBlob(node), filename)
}

// Feature-detect only (no capture) -- lets the UI decide whether to render
// a Share button at all, per "fall back gracefully to download-only if Web
// Share isn't available."
export function canShareFiles(): boolean {
  return typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
}

// Native Share (mobile) when the browser can share files; falls back to a
// plain download otherwise.
export async function shareCard(node: HTMLElement, filename: string): Promise<'shared' | 'downloaded'> {
  const blob = await captureBlob(node)
  const file = new File([blob], filename, { type: 'image/png' })

  if (canShareFiles() && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Cobb's Adventure Park" })
      return 'shared'
    } catch (err) {
      // AbortError == the guest closed the share sheet -- not a failure,
      // just don't fall back to a surprise download on top of that.
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared'
    }
  }

  triggerDownload(blob, filename)
  return 'downloaded'
}
