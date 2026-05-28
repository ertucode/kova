const TAILWIND_RUNTIME_THEME_STYLE_ID = 'kova-tailwind-runtime-theme'

const tailwindRuntimeThemeCss = `
@theme {
  --color-base-100: #1a1b26;
  --color-base-200: #16161e;
  --color-base-300: #24283b;
  --color-base-content: #e1e3ec;
  --color-primary: #7aa2f7;
  --color-primary-content: #1a1b26;
  --color-secondary: #bb9af7;
  --color-secondary-content: #1a1b26;
  --color-accent: #9ece6a;
  --color-accent-content: #1a1b26;
  --color-neutral: #414868;
  --color-neutral-content: #e1e3ec;
  --color-info: #0db9d7;
  --color-info-content: #1a1b26;
  --color-success: #9ece6a;
  --color-success-content: #1a1b26;
  --color-warning: #e0af68;
  --color-warning-content: #1a1b26;
  --color-error: #f7768e;
  --color-error-content: #1a1b26;
  --radius-selector: 1rem;
  --radius-field: 0.5rem;
  --radius-box: 1rem;
  --size-selector: 0.25rem;
  --size-field: 0.25rem;
  --border: 1px;
  --depth: 0;
  --noise: 0;
}
`.trim()

export function ensureTailwindRuntimeTheme() {
  if (document.getElementById(TAILWIND_RUNTIME_THEME_STYLE_ID)) {
    return
  }

  const styleElement = document.createElement('style')
  styleElement.id = TAILWIND_RUNTIME_THEME_STYLE_ID
  styleElement.type = 'text/tailwindcss'
  styleElement.textContent = tailwindRuntimeThemeCss
  document.head.append(styleElement)
}
