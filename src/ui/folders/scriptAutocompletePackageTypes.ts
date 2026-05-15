export function sanitizePackageTypeFileContent(content: string) {
  return content.replace(/^\s*export\s+as\s+namespace\s+[A-Za-z_$][\w$]*\s*;?\s*$/gm, '')
}
