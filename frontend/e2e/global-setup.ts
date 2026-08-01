import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(__dirname, '..', '..', 'backend')
const backendPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe')

// Several specs mark the same demo nodes/tiles visited/completed, so running
// more than one spec file in a row leaves state from an earlier file's test
// behind for the next (e.g. "Mark Visited" no longer being on screen because
// a prior spec already visited that node). Reset once, up front, so a full
// `npx playwright test` run doesn't depend on the developer remembering to
// run the reset script by hand between files.
export default function globalSetup(): void {
  execFileSync(backendPython, ['scripts/reset_demo_data.py'], { cwd: backendDir, stdio: 'inherit' })
}
