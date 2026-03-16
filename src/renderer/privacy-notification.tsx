import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './components/theme-provider'
import { PrivacyNotificationApp } from './pages/privacy-notification/PrivacyNotificationApp'
import './index.css'

const root = document.getElementById('root')
if (root === null) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <PrivacyNotificationApp />
    </ThemeProvider>
  </StrictMode>,
)
