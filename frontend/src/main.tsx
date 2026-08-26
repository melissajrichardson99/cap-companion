import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { api } from './api'

// Temporary scaffolding for Per-Device Sessions Phase 0 manual verification
// (run `await __capWhoami()` in the browser console). Not guest-facing --
// remove once a later phase gives this a real UI hook, or once /session/whoami
// itself is retired.
declare global {
  interface Window {
    __capWhoami: () => ReturnType<typeof api.whoami>
  }
}
window.__capWhoami = api.whoami

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
