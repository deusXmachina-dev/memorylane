interface MainWindowStatus {
  capturing: boolean
}

interface MainWindowAPI {
  getStatus: () => Promise<MainWindowStatus>
  toggleCapture: () => Promise<MainWindowStatus>
  openSettings: () => void
  onStatusChanged: (callback: (status: MainWindowStatus) => void) => void
}

function getMainWindowAPI(): MainWindowAPI | undefined {
  return (window as unknown as { mainWindowAPI?: MainWindowAPI }).mainWindowAPI
}

const captureToggle = document.getElementById('capture-toggle') as HTMLButtonElement
const settingsButton = document.getElementById('settings-button') as HTMLButtonElement

function updateUI(status: MainWindowStatus): void {
  const capturing = status.capturing

  captureToggle.textContent = capturing ? 'Stop Capture' : 'Start Capture'

  if (capturing) {
    captureToggle.classList.remove('bg-zinc-700', 'hover:bg-zinc-600')
    captureToggle.classList.add('bg-red-700/80', 'hover:bg-red-700')
  } else {
    captureToggle.classList.remove('bg-red-700/80', 'hover:bg-red-700')
    captureToggle.classList.add('bg-zinc-700', 'hover:bg-zinc-600')
  }
}

async function loadStatus(retryCount = 0): Promise<void> {
  const api = getMainWindowAPI()
  if (!api) {
    if (retryCount < 3) {
      setTimeout(() => loadStatus(retryCount + 1), 100)
      return
    }
    return
  }

  try {
    const status = await api.getStatus()
    updateUI(status)
  } catch {
    // Status unavailable — leave defaults
  }
}

captureToggle.addEventListener('click', async () => {
  const api = getMainWindowAPI()
  if (!api) return

  captureToggle.disabled = true

  try {
    const status = await api.toggleCapture()
    updateUI(status)
  } finally {
    captureToggle.disabled = false
  }
})

settingsButton.addEventListener('click', () => {
  const api = getMainWindowAPI()
  if (!api) return
  api.openSettings()
})

// Listen for push updates from the main process
const api = getMainWindowAPI()
if (api) {
  api.onStatusChanged((status) => updateUI(status))
}

// Load initial state
window.addEventListener('focus', () => loadStatus())
loadStatus()
