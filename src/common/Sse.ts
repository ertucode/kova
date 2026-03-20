import type { SseEventRecord } from './Requests.js'

export function isSseContentType(contentType: string | null | undefined) {
  return (contentType ?? '').toLowerCase().includes('text/event-stream')
}

export function parseSseEvents(input: string) {
  const events: SseEventRecord[] = []
  const normalizedInput = input.replace(/\r\n/g, '\n')
  const blocks = normalizedInput.split(/\n\n+/)

  for (const block of blocks) {
    const event = parseSseBlock(block)
    if (event) {
      events.push(event)
    }
  }

  return events
}

export function parseSseBlock(block: string): SseEventRecord | null {
  const normalizedBlock = block.replace(/\r\n/g, '\n').trim()
  if (!normalizedBlock) {
    return null
  }

  let id: string | null = null
  let eventName: string | null = null
  let retryMs: number | null = null
  const dataLines: string[] = []

  for (const line of normalizedBlock.split('\n')) {
    if (!line || line.startsWith(':')) {
      continue
    }

    const separatorIndex = line.indexOf(':')
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
    let value = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1)
    if (value.startsWith(' ')) {
      value = value.slice(1)
    }

    if (field === 'data') {
      dataLines.push(value)
      continue
    }

    if (field === 'event') {
      eventName = value || null
      continue
    }

    if (field === 'id') {
      id = value || null
      continue
    }

    if (field === 'retry') {
      const parsedValue = Number.parseInt(value, 10)
      retryMs = Number.isFinite(parsedValue) ? parsedValue : null
    }
  }

  if (dataLines.length === 0) {
    return null
  }

  const data = dataLines.join('\n')

  return {
    id,
    eventName,
    data,
    retryMs,
    sizeBytes: getByteLength(stringifySseEvent({ id, eventName, data, retryMs })),
    timestamp: null,
  }
}

export function stringifySseEvent(event: Pick<SseEventRecord, 'id' | 'eventName' | 'data' | 'retryMs'>) {
  const lines: string[] = []

  if (event.id) {
    lines.push(`id: ${event.id}`)
  }

  if (event.eventName) {
    lines.push(`event: ${event.eventName}`)
  }

  for (const line of event.data.split('\n')) {
    lines.push(`data: ${line}`)
  }

  if (event.retryMs !== null) {
    lines.push(`retry: ${event.retryMs}`)
  }

  return `${lines.join('\n')}\n\n`
}

export function getSseEventDisplayName(event: Pick<SseEventRecord, 'eventName'>) {
  return event.eventName ?? 'message'
}

function getByteLength(value: string) {
  return new TextEncoder().encode(value).length
}
