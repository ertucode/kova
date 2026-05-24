declare module 'react-refresh/runtime' {
  export function injectIntoGlobalHook(target: object): void
  export function isLikelyComponentType(type: unknown): boolean
  export function performReactRefresh(): void
  export function register(type: unknown, id: string): void
}
