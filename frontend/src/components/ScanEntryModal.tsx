import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { CameraIcon } from './NavIcons'
import './ScanEntryModal.css'

interface ScanEntryModalProps {
  onClose: () => void
  onCodeSubmitted: (code: string) => void
}

// QR signage encodes the full <frontend_base_url>/scan/<code> URL (so a
// phone's own camera app works with no app install) -- pull just the code
// back out. Falls back to treating the whole decoded text as the code, in
// case a sign somehow just encodes the bare code.
function extractCode(decodedText: string): string {
  const match = decodedText.match(/\/scan\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]) : decodedText
}

type CameraState = 'pending' | 'active' | 'error'

export function ScanEntryModal({ onClose, onCodeSubmitted }: ScanEntryModalProps) {
  const [manualCode, setManualCode] = useState('')
  const [cameraState, setCameraState] = useState<CameraState>('pending')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const doneRef = useRef(false)

  const stopCamera = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const handleDecoded = (decodedText: string) => {
    if (doneRef.current) return
    doneRef.current = true
    stopCamera()
    onCodeSubmitted(extractCode(decodedText))
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
    if (!trimmed) return
    onCodeSubmitted(trimmed)
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

      <div className="scan-entry-fallback-bubble">
        <p className="scan-entry-fallback-text">Or enter the code on the sign</p>
        <div className="scan-entry-manual-row">
          <input
            id="scan-entry-manual-input"
            type="text"
            value={manualCode}
            placeholder="brave-otter"
            aria-label="Code from the sign"
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitManual()}
          />
          <button type="button" className="btn btn-secondary" onClick={submitManual}>
            Go
          </button>
        </div>
      </div>
    </Modal>
  )
}
