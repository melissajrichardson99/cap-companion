import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(__dirname, '..', '..', 'backend')
const backendPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe')

// Removes the data this run created on the dev project: device sessions and
// every row hanging off them, test guest accounts, and map_node_visit_events
// (see backend/scripts/e2e_run_cleanup.py). Without it every full run left
// ~2,700 sessions behind, which is what made the Analytics summary slow and
// pushed the dev project's log volume up. The script never fails the run --
// it prints why it skipped instead -- and global-setup.ts catches up on a
// run that was interrupted before reaching this.
export default function globalTeardown(): void {
  execFileSync(backendPython, ['scripts/e2e_run_cleanup.py', 'end'], { cwd: backendDir, stdio: 'inherit' })
}
