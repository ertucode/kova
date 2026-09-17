export type AppTheme = 'dark' | 'light'

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
}

export function setAppTheme(theme: AppTheme) {
  localStorage.setItem(storageKey, theme)
  applyTheme(theme)
}

applyTheme(getAppTheme())
window.addEventListener('storage', event => {
  if (event.key === storageKey || event.key === null) applyTheme(getAppTheme())
})
