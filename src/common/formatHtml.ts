export function formatHtml(html: string): string {
  const parser = new DOMParser()
  const documentNode = parser.parseFromString(html, 'text/html')
  const doctype = documentNode.doctype
  const doctypeText = doctype
    ? `<!DOCTYPE ${doctype.name}${doctype.publicId ? ` PUBLIC \"${doctype.publicId}\"` : ''}${doctype.systemId ? ` \"${doctype.systemId}\"` : ''}>\n`
    : ''
  return `${doctypeText}${formatMarkup(documentNode.documentElement.outerHTML)}`.trim()
}

function formatMarkup(markup: string): string {
  let formatted = ''
  let indent = 0
  const lines = markup.replace(/>\s*</g, '>\n<').split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const isClosing = /^<\//.test(trimmed)
    const isSelfClosing =
      /\/>$/.test(trimmed) ||
      /^<!/.test(trimmed) ||
      /^<meta\b/i.test(trimmed) ||
      /^<link\b/i.test(trimmed) ||
      /^<img\b/i.test(trimmed) ||
      /^<input\b/i.test(trimmed) ||
      /^<br\b/i.test(trimmed) ||
      /^<hr\b/i.test(trimmed)
    const isInlineTextNode = /^(?!<).+/.test(trimmed)
    const isOpening = /^<[^/!][^>]*>$/.test(trimmed) && !isSelfClosing && !trimmed.includes('</')

    if (isClosing) {
      indent = Math.max(0, indent - 1)
    }

    formatted += `${'  '.repeat(Math.max(0, indent - (isInlineTextNode ? 0 : 0)))}${trimmed}\n`

    if (isOpening) {
      indent += 1
    }
  }

  return formatted.trim()
}
