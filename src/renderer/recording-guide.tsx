import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RecordingGuide } from './pages/recording-guide/RecordingGuide'
import { ThemeProvider } from './components/theme-provider'
import './index.css'

const root = document.getElementById('root')
if (root === null) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <RecordingGuide />
    </ThemeProvider>
  </StrictMode>,
)
