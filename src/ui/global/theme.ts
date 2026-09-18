import type { WindowElectron, WindowTheme } from '@common/Contracts'

export type AppTheme = WindowTheme

const storageKey = 'kova.appearance.theme'

export function getAppTheme(): AppTheme {
  try {
    return localStorage.getItem(storageKey) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  syncWindowTheme(theme)
}

function syncWindowTheme(theme: AppTheme) {
  const electron = (window as Window & { electron?: Pick<WindowElectron, 'setWindowTheme'> }).electron
  if (electron) {
    void electron.setWindowTheme(theme)
  }
}

export function setAppTheme(theme: AppTheme) {
  localStorage.setItem(storageKey, theme)
  applyTheme(theme)
}

applyTheme(getAppTheme())
window.addEventListener('storage', event => {
  if (event.key === storageKey || event.key === null) applyTheme(getAppTheme())
})
