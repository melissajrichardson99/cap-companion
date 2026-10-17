import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { api } from './api'
import { logInitialPageLoadScan } from './scanArrival'

// Temporary scaffolding for Per-Device Sessions Phase 0 manual verification
// (run `await __capWhoami()` in the browser console). Not guest-facing --
// remove once a later phase gives this a real UI hook, or once /session/whoami
// itself is retired. Dev server only (which is what e2e runs against) --
// never attached in a production build.
declare global {
  interface Window {
    __capWhoami: () => ReturnType<typeof api.whoami>
  }
}
if (import.meta.env.DEV) window.__capWhoami = api.whoami

// A phone-camera QR scan opens the destination URL as a fresh page load --
// logged here, once, before React (and StrictMode) ever runs.
logInitialPageLoadScan()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
