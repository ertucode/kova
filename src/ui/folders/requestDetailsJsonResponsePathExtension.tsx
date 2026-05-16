import { createRoot } from 'react-dom/client'
import { type Extension } from '@codemirror/state'
import { hoverTooltip } from '@codemirror/view'
import { findNodeAtOffset, parseTree, type Node as JsonNode } from 'jsonc-parser'
import { CopyIcon } from 'lucide-react'
import { toast } from '@/lib/components/toast'

export function createJsonResponsePathExtension(): Extension {
  return [
    hoverTooltip(
      (view, pos, side) => {
        const match = getJsonPropertyPathAtPosition(view.state.doc.toString(), pos, side)
        if (!match) {
          return null
        }

        return {
          pos: match.from,
          end: match.to,
          create() {
            const dom = document.createElement('div')
            const root = createRoot(dom)

            root.render(
              <JsonPathHoverTooltip
                path={match.path}
                keyName={match.keyName}
                value={match.value}
                valuePreview={match.valuePreview}
                hovered={match.hovered}
              />
            )

            return {
              dom,
              destroy() {
                root.unmount()
              },
            }
          },
        }
      },
      { hoverTime: 120 }
    ),
  ]
}

function JsonPathHoverTooltip({
  path,
  keyName,
  value,
  valuePreview,
  hovered,
}: {
  path: string
  keyName?: string
  value?: string
  valuePreview?: string
  hovered: 'key' | 'value'
}) {
  const topSection =
    hovered === 'value' ? (
      value ? (
        <CopyableTooltipRow
          label="Value"
          value={value}
          displayValue={valuePreview ?? value}
          successMessage="JSON value copied to clipboard."
        />
      ) : null
    ) : keyName ? (
      <CopyableTooltipRow label="Key" value={keyName} successMessage="JSON key copied to clipboard." />
    ) : null
  const secondaryValue =
    hovered === 'key' && value !== undefined ? (
      <CopyableTooltipRow
        label="Value"
        value={value}
        displayValue={valuePreview ?? value}
        successMessage="JSON value copied to clipboard."
      />
    ) : null

  return (
    <div className="max-w-[32rem] p-3 flex flex-col gap-2">
      {topSection}
      {secondaryValue}
      <CopyableTooltipRow label="Path" value={path} successMessage="JSON path copied to clipboard." />
    </div>
  )
}

function CopyableTooltipRow({
  label,
  value,
  displayValue,
  successMessage,
}: {
  label: string
  value: string
  displayValue?: string
  successMessage: string
}) {
  return (
    <div className="flex items-stretch gap-2">
      <div className="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/50 flex items-center">
        {label}
      </div>
      <code
        className={`min-w-0 flex-1 select-text overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-base-content/10 bg-base-100/70 text-xs text-base-content px-2.5 py-2`}
      >
        {displayValue ?? value}
      </code>
      <button
        type="button"
        className={`shrink-0 rounded-md border border-base-content/10 bg-base-100/80 text-base-content/70 transition hover:border-base-content/20 hover:text-base-content p-2`}
        onClick={() => void copyTextToClipboard(value, successMessage)}
        title={`Copy ${label}`}
        aria-label={`Copy ${label}`}
      >
        <CopyIcon className={'h-4 w-4'} />
      </button>
    </div>
  )
}

async function copyTextToClipboard(value: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.show({ severity: 'success', message: successMessage })
  } catch {
    toast.show({ severity: 'error', message: 'Could not write the response body to the clipboard.' })
  }
}

function getJsonPropertyPathAtPosition(
  source: string,
  pos: number,
  side: number
): {
  from: number
  to: number
  path: string
  keyName?: string
  value?: string
  valuePreview?: string
  hovered: 'key' | 'value'
} | null {
  const root = parseTree(source)
  if (!root) {
    return null
  }

  const offsets = side < 0 ? [Math.max(0, pos - 1), pos] : [pos, Math.max(0, pos - 1)]

  for (const offset of offsets) {
    const node = findNodeAtOffset(root, offset, true)
    const match = node ? getJsonPropertyPathMatch(source, node, offset) : null
    if (match) {
      return match
    }
  }

  return null
}

function getJsonPropertyPathMatch(
  source: string,
  node: JsonNode,
  offset: number
): {
  from: number
  to: number
  path: string
  keyName?: string
  value?: string
  valuePreview?: string
  hovered: 'key' | 'value'
} | null {
  let current: JsonNode | undefined = node

  while (current) {
    if (current.type === 'property') {
      const keyNode = current.children?.[0]
      const valueNode = current.children?.[1]
      if (keyNode?.type === 'string' && offset >= keyNode.offset && offset <= keyNode.offset + keyNode.length) {
        return {
          from: keyNode.offset,
          to: keyNode.offset + keyNode.length,
          path: formatJsonPath(buildJsonPathSegments(source, current)),
          keyName: readJsonStringNodeValue(source, keyNode) ?? undefined,
          value: valueNode ? readJsonNodeClipboardValue(source, valueNode) : undefined,
          valuePreview: valueNode ? getJsonNodePreview(source, valueNode) : undefined,
          hovered: 'key',
        }
      }

      if (
        valueNode &&
        isDirectlyHoverableJsonValueNode(valueNode) &&
        offset >= valueNode.offset &&
        offset <= valueNode.offset + valueNode.length
      ) {
        return {
          from: valueNode.offset,
          to: valueNode.offset + valueNode.length,
          path: formatJsonPath(buildJsonPathSegments(source, current)),
          keyName: keyNode?.type === 'string' ? (readJsonStringNodeValue(source, keyNode) ?? undefined) : undefined,
          value: readCopyableJsonNodeValue(source, valueNode),
          valuePreview: getJsonNodePreview(source, valueNode),
          hovered: 'value',
        }
      }

      if (valueNode && isContainerBoundaryHover(valueNode, offset)) {
        return {
          from: offset,
          to: offset + 1,
          path: formatJsonPath(buildJsonPathSegments(source, current)),
          keyName: keyNode?.type === 'string' ? (readJsonStringNodeValue(source, keyNode) ?? undefined) : undefined,
          value: readJsonNodeClipboardValue(source, valueNode),
          valuePreview: getJsonNodePreview(source, valueNode),
          hovered: 'value',
        }
      }
    }

    if (
      isDirectlyHoverableJsonValueNode(current) &&
      current.parent?.type === 'array' &&
      offset >= current.offset &&
      offset <= current.offset + current.length
    ) {
      return {
        from: current.offset,
        to: current.offset + current.length,
        path: formatJsonPath(buildJsonPathSegmentsForValueNode(source, current)),
        value: readCopyableJsonNodeValue(source, current),
        valuePreview: getJsonNodePreview(source, current),
        hovered: 'value',
      }
    }

    if (isContainerBoundaryHover(current, offset) && current.parent?.type === 'array') {
      return {
        from: offset,
        to: offset + 1,
        path: formatJsonPath(buildJsonPathSegmentsForValueNode(source, current)),
        value: readJsonNodeClipboardValue(source, current),
        valuePreview: getJsonNodePreview(source, current),
        hovered: 'value',
      }
    }

    current = current.parent
  }

  return null
}

function buildJsonPathSegments(source: string, propertyNode: JsonNode): Array<string | number> {
  const segments: Array<string | number> = []
  let current: JsonNode | undefined = propertyNode

  while (current) {
    if (current.type === 'property') {
      const keyNode = current.children?.[0]
      const key = keyNode ? readJsonStringNodeValue(source, keyNode) : null
      if (key !== null) {
        segments.unshift(key)
      }
    }

    const parent: JsonNode | undefined = current.parent
    if (parent?.type === 'array') {
      const index = parent.children?.indexOf(current) ?? -1
      if (index >= 0) {
        segments.unshift(index)
      }
    }

    current = parent
  }

  return segments
}

function buildJsonPathSegmentsForValueNode(source: string, valueNode: JsonNode): Array<string | number> {
  const parent = valueNode.parent
  if (parent?.type === 'property') {
    return buildJsonPathSegments(source, parent)
  }

  const segments: Array<string | number> = []
  let current: JsonNode | undefined = valueNode

  while (current) {
    const parentNode: JsonNode | undefined = current.parent
    if (parentNode?.type === 'array') {
      const index = parentNode.children?.indexOf(current) ?? -1
      if (index >= 0) {
        segments.unshift(index)
      }
    }

    if (parentNode?.type === 'property') {
      const keyNode = parentNode.children?.[0]
      const key = keyNode ? readJsonStringNodeValue(source, keyNode) : null
      if (key !== null) {
        segments.unshift(key)
      }
    }

    current = parentNode
  }

  return segments
}

function isCopyableJsonValueNode(node: JsonNode) {
  return node.type === 'string' || node.type === 'number'
}

function isDirectlyHoverableJsonValueNode(node: JsonNode) {
  return isCopyableJsonValueNode(node)
}

function isContainerBoundaryHover(node: JsonNode, offset: number) {
  if (node.type !== 'object' && node.type !== 'array') {
    return false
  }

  return offset === node.offset || offset === node.offset + node.length - 1
}

function readCopyableJsonNodeValue(source: string, node: JsonNode) {
  if (node.type === 'number') {
    return source.slice(node.offset, node.offset + node.length)
  }

  return readJsonStringNodeValue(source, node) ?? source.slice(node.offset, node.offset + node.length)
}

function readJsonNodeClipboardValue(source: string, node: JsonNode) {
  if (node.type === 'string' || node.type === 'number') {
    return readCopyableJsonNodeValue(source, node)
  }

  return source.slice(node.offset, node.offset + node.length)
}

function getJsonNodePreview(source: string, node: JsonNode) {
  return truncateJsonPreview(readJsonNodeClipboardValue(source, node))
}

function truncateJsonPreview(value: string) {
  return value.length > 20 ? `${value.slice(0, 20)}...` : value
}

function readJsonStringNodeValue(source: string, node: JsonNode) {
  try {
    const value = JSON.parse(source.slice(node.offset, node.offset + node.length))
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

function formatJsonPath(segments: Array<string | number>): string {
  return segments.reduce<string>((path, segment) => {
    if (typeof segment === 'number') {
      return `${path}[${segment}]`
    }

    if (!path) {
      return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(segment) ? segment : `[${JSON.stringify(segment)}]`
    }

    return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(segment) ? `${path}.${segment}` : `${path}[${JSON.stringify(segment)}]`
  }, '')
}
