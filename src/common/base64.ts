export function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }

  // Base64 → Base64URL
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64(input: string): string {
  if (!input) return ''

  // whitespace temizle
  let base64 = input.replace(/\s+/g, '')

  // Base64URL → Base64
  base64 = base64.replace(/-/g, '+').replace(/_/g, '/')

  // padding fix
  base64 += '='.repeat((4 - (base64.length % 4)) % 4)

  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return new TextDecoder().decode(bytes)
}
