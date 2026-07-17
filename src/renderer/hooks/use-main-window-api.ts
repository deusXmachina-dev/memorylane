import type { MainWindowAPI } from '@types'

export function useMainWindowAPI(): MainWindowAPI {
  const api = window.mainWindowAPI
  if (api === undefined) throw new Error('mainWindowAPI not available')
  return api
}
