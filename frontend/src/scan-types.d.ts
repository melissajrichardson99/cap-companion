// jsqr ships no bundled types and there's no @types/jsqr on npm -- minimal
// ambient declaration for the one function this app calls.
declare module 'jsqr' {
  interface QRCode {
    data: string
  }
  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ): QRCode | null
}

// BarcodeDetector isn't in TS's default DOM lib yet (Baseline 2024, Safari
// still lacks it) -- declared globally so ScanEntryModal can feature-detect
// and use it without `any`.
interface BarcodeDetectorOptions {
  formats: string[]
}

interface DetectedBarcode {
  rawValue: string
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions)
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
