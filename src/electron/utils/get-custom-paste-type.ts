import { clipboard } from 'electron'

// Base64 magic bytes for common file types
const BASE64_SIGNATURES: Record<string, { prefix: string; dataUrlPrefix: string }> = {
  pdf: { prefix: 'JVBERi0', dataUrlPrefix: 'data:application/pdf;base64,' }, // %PDF-
  png: { prefix: 'iVBORw0KGgo', dataUrlPrefix: 'data:image/png;base64,' },
  jpg: { prefix: '/9j/', dataUrlPrefix: 'data:image/jpeg;base64,' },
  gif: { prefix: 'R0lGOD', dataUrlPrefix: 'data:image/gif;base64,' },
  webp: { prefix: 'UklGR', dataUrlPrefix: 'data:image/webp;base64,' },
  mp3: { prefix: 'SUQz', dataUrlPrefix: 'data:audio/mpeg;base64,' }, // ID3
  mp4: { prefix: 'AAAAI', dataUrlPrefix: 'data:video/mp4;base64,' },
  zip: { prefix: 'UEsDB', dataUrlPrefix: 'data:application/zip;base64,' }, // PK
  docx: { prefix: 'UEsDB', dataUrlPrefix: 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,' },
}

export type Base64Type = 'pdf' | 'png' | 'jpg' | 'gif' | 'webp' | 'mp3' | 'mp4' | 'zip' | 'docx' | 'unknown'

export type CustomPasteType = 
  | { type: 'image' }
  | { type: 'base64'; base64Type: Base64Type }
  | { type: 'text' }
  | null

function detectBase64Type(text: string): { base64Type: Base64Type; base64Data: string } | null {
  // Check for data URL prefixes first
  for (const [type, { dataUrlPrefix }] of Object.entries(BASE64_SIGNATURES)) {
    if (text.startsWith(dataUrlPrefix)) {
      return { base64Type: type as Base64Type, base64Data: text.slice(dataUrlPrefix.length) }
    }
  }
  
  // Check for raw base64 magic bytes
  for (const [type, { prefix }] of Object.entries(BASE64_SIGNATURES)) {
    if (text.startsWith(prefix)) {
      return { base64Type: type as Base64Type, base64Data: text }
    }
  }
  
  // Check if it looks like base64 (only contains valid base64 chars and is reasonably long)
  const base64Regex = /^[A-Za-z0-9+/]+=*$/
  if (text.length > 100 && base64Regex.test(text.replace(/\s/g, ''))) {
    return { base64Type: 'unknown', base64Data: text.replace(/\s/g, '') }
  }
  
  return null
}

function hasClipboardImage(): boolean {
  try {
    const image = clipboard.readImage()
    return !image.isEmpty()
  } catch {
    return false
  }
}

export function getCustomPasteType(): CustomPasteType {
  const clipboardText = clipboard.readText()
  
  // Check for base64 data in text first (more specific)
  if (clipboardText) {
    const base64Result = detectBase64Type(clipboardText.trim())
    if (base64Result) {
      return { type: 'base64', base64Type: base64Result.base64Type }
    }
    
    // Has text but not base64 - it's plain text
    return { type: 'text' }
  }
  
  // Check for native image in clipboard
  if (hasClipboardImage()) {
    return { type: 'image' }
  }
  
  return null
}
