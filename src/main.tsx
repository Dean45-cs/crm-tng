import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Inter Variable (selbst gehostet, PWA-tauglich) — die UI-Schrift der App.
// opsz.css liefert die optische Größenachse für besonders klare Kleingrade.
import '@fontsource-variable/inter/opsz.css'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { initErrorReporting } from './lib/errorReporting.ts'
import { initTheme } from './lib/theme.ts'

initErrorReporting()
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
