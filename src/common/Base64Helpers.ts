/**
 * File extensions that support "Copy as Base64" functionality.
 * These are file types that are commonly shared/embedded as base64 strings.
 */
const SUPPORTED_BASE64_EXTENSIONS = new Set([
  // Documents
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  // Images
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'ico',
  'bmp',
  // Audio
  'mp3',
  'wav',
  'ogg',
  'm4a',
  // Video
  'mp4',
  'webm',
  // Archives
  'zip',
  // Fonts
  'woff',
  'woff2',
  'ttf',
  'otf',
])

/**
 * Check if a file supports being copied as a base64 string.
 * @param fileName - The file name or path to check
 * @returns true if the file type supports base64 copy
 */
export function supportsBase64Copy(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (!ext) return false
  return SUPPORTED_BASE64_EXTENSIONS.has(ext)
}
