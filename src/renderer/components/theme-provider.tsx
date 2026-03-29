import * as React from 'react'
import type { MainWindowAPI } from '@types'

type Theme = 'dark' | 'light'

const ThemeContext = React.createContext<{ theme: Theme }>({ theme: 'light' })

function useTheme() {
  return React.useContext(ThemeContext)
}

function getAPI(): MainWindowAPI {
  const api = (window as unknown as { mainWindowAPI?: MainWindowAPI }).mainWindowAPI
  if (!api) throw new Error('mainWindowAPI not available')
  return api
}

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<Theme>('light')

  React.useEffect(() => {
    const api = getAPI()
    api.getTheme().then(setTheme)
    api.onThemeChanged(setTheme)
  }, [])

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const value = React.useMemo(() => ({ theme }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export { ThemeProvider, useTheme }
