#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_TRACE_PATH = 'trace.json'
const LONG_TASK_THRESHOLD_US = 50_000
const TOP_LIMIT = 20

const tracePath = path.resolve(process.argv[2] ?? DEFAULT_TRACE_PATH)

if (!fs.existsSync(tracePath)) {
  console.error(`Trace file not found: ${tracePath}`)
  process.exit(1)
}

const startedAt = performance.now()
const raw = fs.readFileSync(tracePath, 'utf8')
const parsed = JSON.parse(raw)
const traceEvents = Array.isArray(parsed) ? parsed : Array.isArray(parsed.traceEvents) ? parsed.traceEvents : []

if (traceEvents.length === 0) {
  console.error(`No trace events found in ${tracePath}`)
  process.exit(1)
}

const eventCounts = new Map()
const eventDurationStats = new Map()
const functionStats = new Map()
const urlStats = new Map()
const userTimingStats = new Map()
const componentPropChangeCounts = new Map()
const longTasks = []
const consoleErrors = []
const consoleWarnings = []
const userTimingBeginStackByName = new Map()

let minTs = Number.POSITIVE_INFINITY
let maxTs = Number.NEGATIVE_INFINITY

for (const event of traceEvents) {
  if (typeof event.ts === 'number') {
    minTs = Math.min(minTs, event.ts)
    maxTs = Math.max(maxTs, event.ts)
  }

  incrementCount(eventCounts, event.name)

  if (event.cat === 'blink.user_timing') {
    const cleanName = normalizeTraceName(event.name)

    if (event.ph === 'b') {
      const stack = userTimingBeginStackByName.get(cleanName) ?? []
      stack.push({ ts: event.ts ?? 0, componentName: getComponentName(event), changedProps: getChangedProps(event) })
      userTimingBeginStackByName.set(cleanName, stack)
    }

    if (event.ph === 'e') {
      const stack = userTimingBeginStackByName.get(cleanName)
      const begin = stack?.pop()
      if (begin && typeof event.ts === 'number' && event.ts >= begin.ts) {
        const durationUs = event.ts - begin.ts
        accumulateDuration(userTimingStats, begin.componentName ?? cleanName, durationUs)

        if (begin.componentName) {
          for (const propName of begin.changedProps) {
            incrementNestedCount(componentPropChangeCounts, begin.componentName, propName)
          }
        }
      }
    }
  }

  if (typeof event.dur === 'number' && event.dur > 0) {
    const eventKey = `${normalizeTraceName(event.name)} [${event.cat ?? 'uncategorized'}]`
    accumulateDuration(eventDurationStats, eventKey, event.dur)

    if (event.dur >= LONG_TASK_THRESHOLD_US) {
      longTasks.push({
        name: event.name,
        category: event.cat ?? 'uncategorized',
        durationUs: event.dur,
        ts: event.ts ?? 0,
      })
    }
  }

  if (event.name === 'ConsoleAPICall') {
    const type = event.args?.data?.[0]?.type
    const message = event.args?.data?.[0]?.value ?? event.args?.data?.map(item => item?.value).filter(Boolean).join(' ')
    if (type === 'error') {
      consoleErrors.push({ ts: event.ts ?? 0, message: message ?? '(unknown error)' })
    }
    if (type === 'warning') {
      consoleWarnings.push({ ts: event.ts ?? 0, message: message ?? '(unknown warning)' })
    }
  }

  if (event.name === 'FunctionCall' && typeof event.dur === 'number' && event.dur > 0) {
    const functionName = event.args?.data?.functionName || '(anonymous)'
    const url = simplifyUrl(event.args?.data?.url || 'unknown')
    accumulateDuration(functionStats, `${functionName} @ ${url}`, event.dur)
    accumulateDuration(urlStats, url, event.dur)
  }
}

printSection('Trace')
console.log(`file: ${tracePath}`)
console.log(`events: ${formatInteger(traceEvents.length)}`)
console.log(`duration: ${formatMs((maxTs - minTs) / 1000)}`)
console.log(`analysis time: ${formatMs(performance.now() - startedAt)}`)

printRankedCounts('Top event counts', eventCounts, 15)
printRankedDurations('Top event durations', eventDurationStats, 15)
printRankedDurations('Top function totals', functionStats, TOP_LIMIT)
printRankedDurations('Top script/url totals', urlStats, 15)
printRankedDurations('Top user timing spans', userTimingStats, 15)

printSection('Top component prop changes')
Array.from(componentPropChangeCounts.entries())
  .map(([componentName, propCounts]) => ({
    componentName,
    total: Array.from(propCounts.values()).reduce((sum, count) => sum + count, 0),
    props: Array.from(propCounts.entries()).sort((left, right) => right[1] - left[1]),
  }))
  .sort((left, right) => right.total - left.total)
  .slice(0, 10)
  .forEach((entry, index) => {
    const topProps = entry.props
      .slice(0, 8)
      .map(([propName, count]) => `${propName} (${count})`)
      .join(', ')
    console.log(`${index + 1}. ${entry.componentName} - ${entry.total} prop changes | ${topProps}`)
  })

printSection('Long tasks')
if (longTasks.length === 0) {
  console.log('none')
} else {
  longTasks
    .sort((left, right) => right.durationUs - left.durationUs)
    .slice(0, 20)
    .forEach((task, index) => {
      console.log(`${index + 1}. ${task.name} [${task.category}] - ${formatUs(task.durationUs)} at ${formatMs((task.ts - minTs) / 1000)}`)
    })
}

printMessages('Console errors', consoleErrors)
printMessages('Console warnings', consoleWarnings)

function printSection(title) {
  console.log(`\n=== ${title} ===`)
}

function printRankedCounts(title, counts, limit) {
  printSection(title)
  Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .forEach(([name, count], index) => {
      console.log(`${index + 1}. ${name} - ${formatInteger(count)}`)
    })
}

function printRankedDurations(title, statsMap, limit) {
  printSection(title)
  Array.from(statsMap.entries())
    .map(([name, stats]) => ({ name, ...stats, avgUs: stats.totalUs / stats.count }))
    .sort((left, right) => right.totalUs - left.totalUs)
    .slice(0, limit)
    .forEach((item, index) => {
      console.log(
        `${index + 1}. ${item.name} - total ${formatUs(item.totalUs)}, calls ${formatInteger(item.count)}, avg ${formatUs(item.avgUs)}, max ${formatUs(item.maxUs)}`
      )
    })
}

function printMessages(title, messages) {
  printSection(title)
  if (messages.length === 0) {
    console.log('none')
    return
  }

  messages.slice(0, 20).forEach((message, index) => {
    console.log(`${index + 1}. ${formatMs((message.ts - minTs) / 1000)} - ${message.message}`)
  })
}

function incrementCount(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function incrementNestedCount(parentMap, parentKey, childKey) {
  const childMap = parentMap.get(parentKey) ?? new Map()
  childMap.set(childKey, (childMap.get(childKey) ?? 0) + 1)
  parentMap.set(parentKey, childMap)
}

function accumulateDuration(map, key, durationUs) {
  const current = map.get(key) ?? { totalUs: 0, count: 0, maxUs: 0 }
  current.totalUs += durationUs
  current.count += 1
  current.maxUs = Math.max(current.maxUs, durationUs)
  map.set(key, current)
}

function simplifyUrl(value) {
  if (!value) {
    return 'unknown'
  }

  try {
    const url = new URL(value)
    const pathname = url.pathname || '/'
    return `${url.origin}${pathname}`
  } catch {
    return value.replace(/^webpack:\/\//, '').replace(/\?.*$/, '')
  }
}

function normalizeTraceName(value) {
  return String(value ?? '').replace(/\u200b/g, '') || '(unnamed)'
}

function getComponentName(event) {
  const detail = parseDetail(event)
  return detail?.devtools?.tooltipText ? normalizeTraceName(detail.devtools.tooltipText) : normalizeTraceName(event.name)
}

function getChangedProps(event) {
  const detail = parseDetail(event)
  const properties = detail?.devtools?.properties
  if (!Array.isArray(properties)) {
    return []
  }

  const changedPropNames = new Set()

  for (const property of properties) {
    const rawLabel = Array.isArray(property) ? property[0] : null
    if (typeof rawLabel !== 'string') {
      continue
    }

    const normalizedLabel = rawLabel.replace(/[\u2007\xa0]/g, ' ').trim()
    const match = normalizedLabel.match(/^[-+]\s*(.+)$/)
    if (!match?.[1]) {
      continue
    }

    const propName = match[1].trim()
    if (propName) {
      changedPropNames.add(propName)
    }
  }

  return Array.from(changedPropNames)
}

function parseDetail(event) {
  const rawDetail = event.args?.detail
  if (typeof rawDetail !== 'string') {
    return null
  }

  try {
    return JSON.parse(rawDetail)
  } catch {
    return null
  }
}

function formatUs(value) {
  return formatMs(value / 1000)
}

function formatMs(value) {
  return `${value.toFixed(2)}ms`
}

function formatInteger(value) {
  return new Intl.NumberFormat('en-US').format(value)
}
