export function formatXml(xml: string): string {
  const parser = new DOMParser()
  const documentNode = parser.parseFromString(xml, 'application/xml')
  const parseError = documentNode.querySelector('parsererror')
  if (parseError || !documentNode.documentElement) {
    throw new Error('Invalid XML')
  }

  const lines: string[] = []

  for (const node of Array.from(documentNode.childNodes)) {
    serializeXmlNode(node, 0, lines)
  }

  return lines.join('\n').trim()
}

function serializeXmlNode(node: Node, indentLevel: number, lines: string[]) {
  const indent = '  '.repeat(indentLevel)

  if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
    lines.push(`${indent}<?${node.nodeName} ${node.nodeValue ?? ''}?>`.trimEnd())
    return
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    lines.push(`${indent}<!--${node.nodeValue ?? ''}-->`)
    return
  }

  if (node.nodeType === Node.CDATA_SECTION_NODE) {
    lines.push(`${indent}<![CDATA[${node.nodeValue ?? ''}]]>`)
    return
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim()
    if (text) {
      lines.push(`${indent}${text}`)
    }
    return
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return
  }

  const element = node as Element
  const tagName = element.tagName
  const attributes = Array.from(element.attributes)
    .map(attribute => `${attribute.name}=${JSON.stringify(attribute.value)}`)
    .join(' ')
  const openingTag = attributes ? `<${tagName} ${attributes}>` : `<${tagName}>`
  const childNodes = Array.from(element.childNodes).filter(child => {
    return child.nodeType !== Node.TEXT_NODE || Boolean(child.textContent?.trim())
  })

  if (childNodes.length === 0) {
    lines.push(attributes ? `${indent}<${tagName} ${attributes} />` : `${indent}<${tagName} />`)
    return
  }

  const hasSingleTextChild =
    childNodes.length === 1 &&
    (childNodes[0]?.nodeType === Node.TEXT_NODE || childNodes[0]?.nodeType === Node.CDATA_SECTION_NODE)

  if (hasSingleTextChild) {
    const content =
      childNodes[0]?.nodeType === Node.CDATA_SECTION_NODE
        ? `<![CDATA[${childNodes[0].nodeValue ?? ''}]]>`
        : (childNodes[0]?.textContent?.trim() ?? '')
    lines.push(`${indent}${openingTag}${content}</${tagName}>`)
    return
  }

  lines.push(`${indent}${openingTag}`)
  for (const child of childNodes) {
    serializeXmlNode(child, indentLevel + 1, lines)
  }
  lines.push(`${indent}</${tagName}>`)
}
