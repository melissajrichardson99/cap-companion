import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(__dirname, '..', 'backend')
const backendPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe')

// Starts both the FastAPI backend (against the real dev Supabase project via
// backend/.env) and the Vite dev server, so e2e specs exercise the actual
// map/bingo interconnectivity end to end rather than mocked responses.
// Absolute paths here because cmd.exe (the shell Playwright spawns on
// Windows) mishandles a leading "../" in the command string.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: [
    {
      command: `"${backendPython}" -m uvicorn app.main:app --port 8000`,
      cwd: backendDir,
      url: 'http://localhost:8000/health',
      reuseExistingServer: true,
      timeout: 20_000,
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 20_000,
    },
  ],
})
