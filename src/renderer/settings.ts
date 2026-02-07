interface KeyStatus {
  hasKey: boolean
  source: 'stored' | 'env' | 'none'
  maskedKey: string | null
}

interface SaveResult {
  success: boolean
  error?: string
}

interface SettingsAPI {
  getKeyStatus: () => Promise<KeyStatus>
  saveApiKey: (key: string) => Promise<SaveResult>
  deleteApiKey: () => Promise<SaveResult>
  close: () => void
  openExternal: (url: string) => Promise<void>
  addToClaude: () => Promise<void>
  addToCursor: () => Promise<void>
}

interface CaptureSettings {
  visualDetector: {
    enabled: boolean
    dhashThresholdPercent: number
  }
  interactionMonitor: {
    enabled: boolean
    typingSessionTimeoutMs: number
    scrollSessionTimeoutMs: number
  }
}

interface CaptureSettingsResponse {
  settings: CaptureSettings
  defaults: CaptureSettings
}

interface CaptureSettingsAPI {
  get: () => Promise<CaptureSettingsResponse>
  save: (partialSettings: Partial<CaptureSettings>) => Promise<SaveResult>
  reset: () => Promise<SaveResult>
}

function getSettingsAPI(): SettingsAPI | undefined {
  return (window as unknown as { settingsAPI?: SettingsAPI }).settingsAPI
}

function getCaptureSettingsAPI(): CaptureSettingsAPI | undefined {
  return (window as unknown as { captureSettingsAPI?: CaptureSettingsAPI }).captureSettingsAPI
}

const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement
const toggleVisibilityBtn = document.getElementById('toggle-visibility') as HTMLButtonElement
const visibilityIcon = document.getElementById('visibility-icon') as HTMLSpanElement
const saveButton = document.getElementById('save-button') as HTMLButtonElement
const deleteButton = document.getElementById('delete-button') as HTMLButtonElement
const statusDiv = document.getElementById('status') as HTMLDivElement
const messageDiv = document.getElementById('message') as HTMLDivElement

let isPasswordVisible = false

function showStatusError(message: string): void {
  const baseClasses = 'mb-4 p-3 rounded-lg text-sm font-medium flex items-center gap-2'
  statusDiv.className = `${baseClasses} bg-red-900/30 text-red-400 border border-red-700/50`
  statusDiv.textContent = message
  deleteButton.disabled = true
}

async function loadKeyStatus(retryCount = 0): Promise<void> {
  const api = getSettingsAPI()
  if (!api) {
    if (retryCount < 3) {
      setTimeout(() => loadKeyStatus(retryCount + 1), 100)
      return
    }
    showStatusError('Settings API unavailable')
    return
  }

  try {
    const status = await api.getKeyStatus()
    updateStatusDisplay(status)
  } catch {
    showStatusError('Failed to load key status')
  }
}

function updateStatusDisplay(status: KeyStatus): void {
  const baseClasses = 'mb-4 p-3 rounded-lg text-sm font-medium flex items-center gap-2'

  if (status.source === 'stored') {
    statusDiv.className = `${baseClasses} bg-zinc-700/50 text-zinc-200 border border-zinc-600`
    statusDiv.textContent = `Stored: ${status.maskedKey}`
    deleteButton.disabled = false
  } else if (status.source === 'env') {
    statusDiv.className = `${baseClasses} bg-zinc-700/50 text-zinc-200 border border-zinc-600`
    statusDiv.textContent = `Environment: ${status.maskedKey}`
    deleteButton.disabled = true
  } else {
    statusDiv.className = `${baseClasses} bg-zinc-800/50 text-zinc-400 border border-zinc-700/50`
    statusDiv.textContent = 'No key configured'
    deleteButton.disabled = true
  }
}

function showMessage(text: string, type: 'success' | 'error'): void {
  messageDiv.textContent = text
  const baseClasses = 'mt-3 text-sm font-medium min-h-[20px]'
  messageDiv.className = `${baseClasses} ${type === 'success' ? 'text-zinc-300' : 'text-zinc-400'}`

  setTimeout(() => {
    messageDiv.textContent = ''
    messageDiv.className = baseClasses
  }, 3000)
}

function validateApiKey(key: string): boolean {
  return key.startsWith('sk-or-') && key.length > 10
}

toggleVisibilityBtn.addEventListener('click', () => {
  isPasswordVisible = !isPasswordVisible
  apiKeyInput.type = isPasswordVisible ? 'text' : 'password'
  visibilityIcon.textContent = isPasswordVisible ? 'Hide' : 'Show'
})

saveButton.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim()

  if (!key) {
    showMessage('Please enter an API key', 'error')
    return
  }

  if (!validateApiKey(key)) {
    showMessage('Invalid API key format (should start with sk-or-)', 'error')
    return
  }

  saveButton.disabled = true
  saveButton.textContent = 'Saving...'

  const result = await getSettingsAPI()!.saveApiKey(key)

  saveButton.disabled = false
  saveButton.textContent = 'Save'

  if (result.success) {
    apiKeyInput.value = ''
    showMessage('API key saved successfully', 'success')
    await loadKeyStatus()
  } else {
    showMessage(result.error || 'Failed to save API key', 'error')
  }
})

deleteButton.addEventListener('click', async () => {
  deleteButton.disabled = true
  deleteButton.textContent = 'Deleting...'

  const result = await getSettingsAPI()!.deleteApiKey()

  deleteButton.textContent = 'Delete'

  if (result.success) {
    showMessage('API key deleted', 'success')
    await loadKeyStatus()
  } else {
    deleteButton.disabled = false
    showMessage(result.error || 'Failed to delete API key', 'error')
  }
})

apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    saveButton.click()
  }
})

window.addEventListener('focus', () => loadKeyStatus())

loadKeyStatus()

// ============================================
// Capture Settings UI
// ============================================

const dhashThresholdSlider = document.getElementById('dhash-threshold') as HTMLInputElement
const dhashThresholdValue = document.getElementById('dhash-threshold-value') as HTMLSpanElement
const typingTimeoutSlider = document.getElementById('typing-timeout') as HTMLInputElement
const typingTimeoutValue = document.getElementById('typing-timeout-value') as HTMLSpanElement
const scrollTimeoutSlider = document.getElementById('scroll-timeout') as HTMLInputElement
const scrollTimeoutValue = document.getElementById('scroll-timeout-value') as HTMLSpanElement
const saveCaptureSettingsBtn = document.getElementById('save-capture-settings') as HTMLButtonElement
const resetCaptureSettingsBtn = document.getElementById(
  'reset-capture-settings',
) as HTMLButtonElement
const captureSettingsMessageDiv = document.getElementById(
  'capture-settings-message',
) as HTMLDivElement

function showCaptureSettingsMessage(text: string, type: 'success' | 'error'): void {
  captureSettingsMessageDiv.textContent = text
  const baseClasses = 'mt-3 text-sm font-medium min-h-[20px]'
  captureSettingsMessageDiv.className = `${baseClasses} ${type === 'success' ? 'text-zinc-300' : 'text-zinc-400'}`

  setTimeout(() => {
    captureSettingsMessageDiv.textContent = ''
    captureSettingsMessageDiv.className = baseClasses
  }, 3000)
}

function updateSliderDisplay(): void {
  dhashThresholdValue.textContent = `${dhashThresholdSlider.value}%`
  typingTimeoutValue.textContent = `${typingTimeoutSlider.value}ms`
  scrollTimeoutValue.textContent = `${scrollTimeoutSlider.value}ms`
}

async function loadCaptureSettings(retryCount = 0): Promise<void> {
  const api = getCaptureSettingsAPI()
  if (!api) {
    if (retryCount < 3) {
      setTimeout(() => loadCaptureSettings(retryCount + 1), 100)
      return
    }
    showCaptureSettingsMessage('Capture settings API unavailable', 'error')
    return
  }

  try {
    const response = await api.get()

    // Update sliders with current values
    dhashThresholdSlider.value = String(response.settings.visualDetector.dhashThresholdPercent)
    typingTimeoutSlider.value = String(response.settings.interactionMonitor.typingSessionTimeoutMs)
    scrollTimeoutSlider.value = String(response.settings.interactionMonitor.scrollSessionTimeoutMs)

    updateSliderDisplay()
  } catch {
    showCaptureSettingsMessage('Failed to load capture settings', 'error')
  }
}

// Slider change event listeners
dhashThresholdSlider.addEventListener('input', updateSliderDisplay)
typingTimeoutSlider.addEventListener('input', updateSliderDisplay)
scrollTimeoutSlider.addEventListener('input', updateSliderDisplay)

// Save capture settings
saveCaptureSettingsBtn.addEventListener('click', async () => {
  const api = getCaptureSettingsAPI()
  if (!api) {
    showCaptureSettingsMessage('Capture settings API unavailable', 'error')
    return
  }

  saveCaptureSettingsBtn.disabled = true
  saveCaptureSettingsBtn.textContent = 'Saving...'

  const partialSettings: Partial<CaptureSettings> = {
    visualDetector: {
      enabled: true,
      dhashThresholdPercent: parseInt(dhashThresholdSlider.value, 10),
    },
    interactionMonitor: {
      enabled: true,
      typingSessionTimeoutMs: parseInt(typingTimeoutSlider.value, 10),
      scrollSessionTimeoutMs: parseInt(scrollTimeoutSlider.value, 10),
    },
  }

  const result = await api.save(partialSettings)

  saveCaptureSettingsBtn.disabled = false
  saveCaptureSettingsBtn.textContent = 'Save'

  if (result.success) {
    showCaptureSettingsMessage('Capture settings saved', 'success')
    await loadCaptureSettings()
  } else {
    showCaptureSettingsMessage(result.error || 'Failed to save settings', 'error')
  }
})

// Reset to defaults
resetCaptureSettingsBtn.addEventListener('click', async () => {
  const api = getCaptureSettingsAPI()
  if (!api) {
    showCaptureSettingsMessage('Capture settings API unavailable', 'error')
    return
  }

  resetCaptureSettingsBtn.disabled = true
  resetCaptureSettingsBtn.textContent = 'Resetting...'

  const result = await api.reset()

  resetCaptureSettingsBtn.disabled = false
  resetCaptureSettingsBtn.textContent = 'Reset to Defaults'

  if (result.success) {
    showCaptureSettingsMessage('Settings reset to defaults', 'success')
    await loadCaptureSettings()
  } else {
    showCaptureSettingsMessage(result.error || 'Failed to reset settings', 'error')
  }
})

// Load capture settings on page load
loadCaptureSettings()

// ============================================
// Integrations UI
// ============================================

const addToClaudeBtn = document.getElementById('add-to-claude') as HTMLButtonElement
const addToCursorBtn = document.getElementById('add-to-cursor') as HTMLButtonElement

addToClaudeBtn.addEventListener('click', () => {
  const api = getSettingsAPI()
  if (!api) return
  void api.addToClaude()
})

addToCursorBtn.addEventListener('click', () => {
  const api = getSettingsAPI()
  if (!api) return
  void api.addToCursor()
})
