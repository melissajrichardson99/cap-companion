import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { CameraIcon } from './NavIcons'
import { api, type ManualEntryMatchType } from '../api'
import './ScanEntryModal.css'

interface ScanEntryModalProps {
  onClose: () => void
  // Called with the app-relative path to navigate to once a code/link is
  // resolved to one of the 4 QR-routable destinations (Hunt/Encyclopedia,
  // Animals, Scoring, Puzzles) -- not a bare code, since which route it
  // belongs under is exactly the thing that needs resolving here.
  onResolved: (path: string) => void
}

// Every QR sign in the park encodes a full <frontend_base_url>/<prefix>/<id>
// URL (so a phone's own camera app works with no app install, no in-app
// scanning needed) -- the path prefix says which of the 4 destinations it
// is. Checked against the decoded URL's *pathname*, not the raw text, so
// query strings/fragments/a non-default origin never confuse the match.
const ROUTE_PREFIXES: { prefix: string; type: ManualEntryMatchType }[] = [
  { prefix: '/scan/', type: 'scan' },
  { prefix: '/animals/', type: 'animal' },
  { prefix: '/scoring/', type: 'scoring' },
  { prefix: '/puzzles/', type: 'puzzle' },
]

function routeForMatch(type: ManualEntryMatchType, slug: string): string {
  const entry = ROUTE_PREFIXES.find((r) => r.type === type)
  return `${entry?.prefix ?? '/scan/'}${encodeURIComponent(slug)}`
}

// Tries to read a destination straight off a decoded QR's URL structure --
// the fast, no-backend-call path, since the URL's own prefix already says
// the type unambiguously. Returns null for anything that isn't a recognized
// <origin>/<prefix>/<id> shape (e.g. a sign that somehow just encodes a bare
// code with no URL at all) so the caller can fall back to resolving it the
// same way manual entry does.
function routeFromDecodedUrl(decodedText: string): string | null {
  let pathname: string
  try {
    pathname = new URL(decodedText, window.location.origin).pathname
  } catch {
    return null
  }
  for (const { prefix } of ROUTE_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      const rest = pathname.slice(prefix.length).split('/')[0]
      if (rest) return `${prefix}${rest}`
    }
  }
  return null
}

type CameraState = 'pending' | 'active' | 'error'

export function ScanEntryModal({ onClose, onResolved }: ScanEntryModalProps) {
  const [manualCode, setManualCode] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)
  const [manualPending, setManualPending] = useState(false)
  const [cameraState, setCameraState] = useState<CameraState>('pending')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const doneRef = useRef(false)
  const unmountedRef = useRef(false)

  useEffect(() => {
    // Reset on (re)mount, not just declared once -- React StrictMode's dev-only
    // synthetic mount/unmount/remount would otherwise flip this permanently
    // true on the first throwaway unmount, silently killing every later
    // resolveAndGo call for the real, later mount.
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  const stopCamera = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  // Shared by both camera decode (when the decoded text isn't a recognized
  // /<prefix>/<id> URL) and manual entry -- resolves raw text against every
  // QR-routable source server-side, since a bare code/name alone doesn't say
  // which destination type it belongs to. A genuine cross-type collision
  // (409) is surfaced here as a visible error rather than silently picking
  // one; "no match anywhere" (404) instead falls through to /scan/:code's
  // existing not-found screen, same UX an unrecognized Hunt/Encyclopedia
  // code always had.
  const resolveAndGo = async (rawText: string) => {
    setManualPending(true)
    setManualError(null)
    try {
      const result = await api.resolveManualEntry(rawText)
      if (doneRef.current || unmountedRef.current) return
      doneRef.current = true
      stopCamera()
      onResolved(routeForMatch(result.type, result.slug))
    } catch (err) {
      if (doneRef.current || unmountedRef.current) return
      const message = String(err)
      if (message.includes('409')) {
        setManualError(`"${rawText}" matches more than one thing here -- please let a staff member know.`)
        setManualPending(false)
        return
      }
      if (message.includes('404')) {
        doneRef.current = true
        stopCamera()
        onResolved(`/scan/${encodeURIComponent(rawText)}`)
        return
      }
      setManualError(`Something went wrong looking that up: ${message}`)
      setManualPending(false)
    }
  }

  const handleDecoded = (decodedText: string) => {
    if (doneRef.current) return
    const directPath = routeFromDecodedUrl(decodedText)
    if (directPath) {
      doneRef.current = true
      stopCamera()
      onResolved(directPath)
      return
    }
    resolveAndGo(decodedText)
  }

  // Auto-prompts for camera permission as soon as the modal mounts -- no
  // "Use Camera" tap required first.
  useEffect(() => {
    let cancelled = false

    const startCamera = async () => {
      setCameraState('pending')
      setCameraError(null)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream

        // The <video> element below is always mounted (never conditionally
        // rendered on cameraState) specifically so this ref is guaranteed to
        // exist here. It previously only rendered once cameraState flipped
        // to "active", which meant srcObject was being assigned to a null
        // ref and the stream never actually reached the video element --
        // permission granted, decode loop running, but a black screen.
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        if (cancelled) return
        setCameraState('active')

        if ('BarcodeDetector' in window) {
          const detector = new BarcodeDetector({ formats: ['qr_code'] })
          const tick = async () => {
            if (!videoRef.current) return
            try {
              const results = await detector.detect(videoRef.current)
              if (results.length > 0) {
                handleDecoded(results[0].rawValue)
                return
              }
            } catch {
              // Transient decode failures between frames are expected -- keep polling.
            }
            rafRef.current = requestAnimationFrame(tick)
          }
          rafRef.current = requestAnimationFrame(tick)
        } else {
          const { default: jsQR } = await import('jsqr')
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          const tick = () => {
            const tickVideo = videoRef.current
            if (!tickVideo || !ctx || tickVideo.readyState !== tickVideo.HAVE_ENOUGH_DATA) {
              rafRef.current = requestAnimationFrame(tick)
              return
            }
            canvas.width = tickVideo.videoWidth
            canvas.height = tickVideo.videoHeight
            ctx.drawImage(tickVideo, 0, 0, canvas.width, canvas.height)
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const result = jsQR(imageData.data, imageData.width, imageData.height)
            if (result) {
              handleDecoded(result.data)
              return
            }
            rafRef.current = requestAnimationFrame(tick)
          }
          rafRef.current = requestAnimationFrame(tick)
        }
      } catch (err) {
        if (cancelled) return
        setCameraState('error')
        setCameraError(`Couldn't access the camera: ${err}`)
      }
    }

    startCamera()

    return () => {
      cancelled = true
      stopCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitManual = () => {
    const trimmed = manualCode.trim()
    if (!trimmed || manualPending) return
    resolveAndGo(trimmed)
  }

  return (
    <Modal onClose={onClose} labelledBy="scan-entry-title" className="scan-entry-modal-frame">
      <h2 id="scan-entry-title" className="scan-entry-title">
        Scan a Code
      </h2>

      <div className="scan-entry-viewfinder">
        {/* Always mounted (see the effect above for why) -- shown/hidden via
            the pending/error overlay stacked on top, not by conditionally
            rendering the element itself. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} className="scan-entry-video" muted playsInline autoPlay />
        {cameraState !== 'active' && (
          <div className="scan-entry-viewfinder-placeholder">
            <CameraIcon className="scan-entry-camera-icon" />
            <p className="scan-entry-status-text">
              {cameraState === 'pending' ? 'Waiting for camera permission…' : 'Camera unavailable'}
            </p>
          </div>
        )}
        <span className="scan-entry-corner scan-entry-corner-tl" aria-hidden="true" />
        <span className="scan-entry-corner scan-entry-corner-tr" aria-hidden="true" />
        <span className="scan-entry-corner scan-entry-corner-bl" aria-hidden="true" />
        <span className="scan-entry-corner scan-entry-corner-br" aria-hidden="true" />
      </div>
      {cameraError && <p className="screen-error">{cameraError}</p>}
      {manualError && <p className="screen-error">{manualError}</p>}

      <div className="scan-entry-fallback-bubble">
        <p className="scan-entry-fallback-text">Or type what's on the sign</p>
        <div className="scan-entry-manual-row">
          <input
            id="scan-entry-manual-input"
            type="text"
            value={manualCode}
            placeholder="brave-otter"
            aria-label="What's on the sign"
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitManual()}
          />
          <button type="button" className="btn btn-primary" onClick={submitManual} disabled={manualPending}>
            {manualPending ? '…' : 'Go'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
