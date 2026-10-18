// Decodes QR codes for the QR generators' verification step
// (scripts/qr_output.py). Reads a JSON array of {file, width, height, rgba}
// (rgba = base64 of the raw RGBA pixels -- Python's Pillow does the PNG
// decoding) on stdin and prints a JSON array of {file, text} (text null when
// no QR code was found).
//
// Uses jsQR, the same decoder the app's in-app scanner uses -- already a
// frontend dependency, resolved from frontend/node_modules, so nothing new
// is installed. Run `npm install` in frontend/ first on a fresh checkout.

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.resolve(here, '..', '..', 'frontend', 'package.json'))
const jsQR = require('jsqr')

let input = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) input += chunk

const results = JSON.parse(input).map(({ file, width, height, rgba }) => {
  const pixels = new Uint8ClampedArray(Buffer.from(rgba, 'base64'))
  const code = jsQR(pixels, width, height)
  return { file, text: code ? code.data : null }
})
process.stdout.write(JSON.stringify(results))
