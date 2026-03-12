import { RefObject } from 'react'
import { SequenceShortcut, ShortcutCode, ShortcutWithHandler } from './useShortcuts'

export type CompiledShortcut = string
type Handler = (e: KeyboardEvent) => void
export type CompiledShortcutSequence = CompiledShortcut[]

function compileShortcutCode(code: ShortcutCode): CompiledShortcut {
  if (typeof code === 'string') {
    return ('TFFFF' + code) as CompiledShortcut
  }

  return [
    'T',
    code.metaKey ? 'T' : 'F',
    code.shiftKey ? 'T' : 'F',
    code.ctrlKey ? 'T' : 'F',
    code.altKey ? 'T' : 'F',
    code.code,
  ].join('') as CompiledShortcut
}

function compileSequence(sequence: ShortcutCode[]): CompiledShortcutSequence {
  return sequence.map(compileShortcutCode)
}

function compileEvent(e: KeyboardEvent): CompiledShortcut {
  return ['T', e.metaKey ? 'T' : 'F', e.shiftKey ? 'T' : 'F', e.ctrlKey ? 'T' : 'F', e.altKey ? 'T' : 'F', e.code].join(
    ''
  ) as CompiledShortcut
}

export function compileShortcuts(shortcuts: ShortcutWithHandler[]): CompiledShortcuts {
  const compiled = new Map<CompiledShortcut, ShortcutWithHandler>()
  for (const s of shortcuts) {
    if (Array.isArray(s.code)) {
      for (const c of s.code) {
        compiled.set(compileShortcutCode(c), s)
      }
    } else {
      compiled.set(compileShortcutCode(s.code), s)
    }
  }
  return compiled
}

export function compileSequences(sequences: SequenceShortcut[]): CompiledSequences {
  return sequences.map(s => ({
    seq: compileSequence(s.sequence.map(code => ({ code }))),
    def: s,
  }))
}

type SequenceState = {
  index: number
  sequences: { seq: CompiledShortcutSequence; handler: Handler }[] | null
  startedAt: number
}
const sequenceTimeout = 500
let state: SequenceState = {
  index: 0,
  sequences: null,
  startedAt: 0,
}

export type CompiledSequences = {
  seq: CompiledShortcutSequence
  def: SequenceShortcut
}[]
export type CompiledShortcuts = Map<CompiledShortcut, ShortcutWithHandler>
export function handleKeydown(single: CompiledShortcuts, sequences: CompiledSequences, e: KeyboardEvent) {
  const code = compileEvent(e)
  const now = performance.now()

  // 1️⃣ If we're in a sequence
  if (state.sequences) {
    if (now - state.startedAt > sequenceTimeout) {
      resetState()
      return
    }

    let matched = false
    for (let i = state.sequences.length - 1; i >= 0; i--) {
      const s = state.sequences[i]
      const expected = s.seq[state.index]

      if (code === expected) {
        matched = true

        if (state.index + 1 === s.seq.length) {
          s.handler(e)
          resetState()
        }

        return
      } else {
        state.sequences.splice(i, 1)
      }
    }
    if (matched) {
      state.index++
      return
    }

    // mismatch → cancel
    resetState()
  }

  const matchedSequences: { seq: CompiledShortcutSequence; handler: Handler }[] = []
  for (const s of sequences) {
    if (code === s.seq[0]) {
      matchedSequences.push({ seq: s.seq, handler: s.def.handler })
    }
  }
  if (matchedSequences.length > 0) {
    state = {
      index: 1,
      startedAt: now,
      sequences: matchedSequences,
    }
  }

  // 3️⃣ Fallback to single shortcuts
  const def = single.get(code)
  if (def && checkEnabledIn(def.enabledIn, e)) {
    def.handler(e)
    return
  }
}

function checkEnabledIn(
  enabledIn: RefObject<HTMLElement | null> | ((e: KeyboardEvent) => boolean) | undefined,
  e: KeyboardEvent
): boolean {
  if (e.target instanceof HTMLInputElement) {
    if (!enabledIn) return false
    if (typeof enabledIn === 'function') {
      return enabledIn(e)
    }
    return enabledIn.current === e.target
  }
  return true
}

function resetState() {
  state.index = 0
  state.sequences = null
}
