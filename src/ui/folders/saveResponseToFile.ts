import type { WebSocketMessageRecord } from '@common/Requests'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'

export async function saveHttpResponseBodyToFile({
  requestName,
  headers,
  body,
}: {
  requestName: string
  headers: string
  body: string
}) {
  const contentType = getResponseContentType(headers)
  const extension = inferResponseExtension(contentType)
  const result = await getWindowElectron().saveTextToFile({
    suggestedFileName: `${toFileNameSegment(requestName)}-response.${extension}`,
    content: body,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  })

  if (!result.success) {
    toast.show(result)
    return
  }

  toast.show({
    severity: 'success',
    title: 'Response saved',
    message: `Saved response body for ${requestName}.`,
    actions: [
      {
        label: 'Open file',
        onAction: () => {
          void getWindowElectron().openFile(result.data.filePath)
        },
      },
      {
        label: 'Open folder',
        onAction: () => {
          void getWindowElectron().openFileLocation(result.data.filePath)
        },
      },
    ],
  })
}

export async function saveWebSocketTranscriptToFile({
  requestName,
  requestHeaders,
  requestBody,
  connectedAt,
  messages,
}: {
  requestName: string
  requestHeaders: string
  requestBody: string
  connectedAt: number
  messages: WebSocketMessageRecord[]
}) {
  const result = await getWindowElectron().saveTextToFile({
    suggestedFileName: `${toFileNameSegment(requestName)}-transcript.json`,
    content: `${JSON.stringify(
      {
        requestName,
        connectedAt,
        request: {
          headers: requestHeaders,
          body: requestBody,
        },
        messages: messages.map(message => ({
          direction: message.direction,
          body: message.body,
          mimeType: message.mimeType,
          sizeBytes: message.sizeBytes,
          timestamp: message.timestamp,
        })),
      },
      null,
      2
    )}\n`,
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  })

  if (!result.success) {
    toast.show(result)
    return
  }

  toast.show({
    severity: 'success',
    title: 'Transcript saved',
    message: `Saved transcript for ${requestName}.`,
  })
}

function getResponseContentType(headers: string) {
  for (const row of headers.split('\n')) {
    const separatorIndex = row.indexOf(':')
    if (separatorIndex < 0) {
      continue
    }

    const key = row.slice(0, separatorIndex).trim().toLowerCase()
    if (key !== 'content-type') {
      continue
    }

    return row.slice(separatorIndex + 1).trim().toLowerCase()
  }

  return null
}

function inferResponseExtension(contentType: string | null) {
  if (!contentType) {
    return 'txt'
  }

  if (contentType.includes('json')) {
    return 'json'
  }

  if (contentType.includes('html')) {
    return 'html'
  }

  if (contentType.includes('xml')) {
    return 'xml'
  }

  if (contentType.includes('csv')) {
    return 'csv'
  }

  if (contentType.includes('javascript')) {
    return 'js'
  }

  return 'txt'
}

function toFileNameSegment(value: string) {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || 'response'
}
