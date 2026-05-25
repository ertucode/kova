import { errorResponseToMessage } from '@common/GenericError'
import type { ScriptAiPhase } from '@common/ScriptAi'
import { LoaderCircleIcon, SparklesIcon } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useMemo, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { Dialog } from '@/lib/components/dialog'
import { dialogActions } from '@/global/dialogStore'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'
import { CodeEditor } from './CodeEditor'
import { buildScriptDocumentationPrompt, scriptDocumentationByPhase } from './scriptDocumentation'
import { appSettingsStore } from '@/global/appSettingsStore'
import { useOpenCodeModels } from '@/global/useOpenCodeModels'

type ScriptAiReviewDialogProps = {
  phase: ScriptAiPhase
  currentCode: string
  onApply: (nextCode: string) => void
}

type DiffSegment = {
  type: 'context' | 'added' | 'removed'
  lines: string[]
}

export function openScriptAiReviewDialog(props: ScriptAiReviewDialogProps) {
  dialogActions.open({ component: ScriptAiReviewDialog, props })
}

export function ScriptAiReviewDialog({ phase, currentCode, onApply }: ScriptAiReviewDialogProps) {
  const appDefaultModel = useSelector(appSettingsStore, state => state.context.settings?.scriptAiModel ?? null)
  const { models: openCodeModels, loading: modelsLoading, error: modelsError } = useOpenCodeModels()
  const [prompt, setPrompt] = useState('')
  const [proposal, setProposal] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>(appDefaultModel ?? '')

  const documentation = scriptDocumentationByPhase[phase]
  const editorLanguage = phase === 'response-visualizer' || phase === 'view-runtime' ? 'jsx' : 'javascript'
  const diffSegments = useMemo(() => buildLineDiff(currentCode, proposal ?? ''), [currentCode, proposal])
  const diffSummary = useMemo(() => summarizeDiff(diffSegments), [diffSegments])
  const hasProposal = proposal !== null

  async function generate() {
    if (!prompt.trim()) {
      setErrorMessage('Describe what you want the script to do first.')
      return
    }

    setIsGenerating(true)
    setErrorMessage(null)

    try {
      const sourceCode = proposal ?? currentCode
      const result = await getWindowElectron().generateScriptWithAi({
        phase,
        currentCode: sourceCode,
        userPrompt: prompt,
        documentation: buildScriptDocumentationPrompt(phase),
        model: selectedModel || null,
      })

      if (!result.success) {
        setErrorMessage(errorResponseToMessage(result.error))
        return
      }

      setProposal(result.data.code)
    } finally {
      setIsGenerating(false)
    }
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }

    event.preventDefault()

    if (isGenerating || !prompt.trim()) {
      return
    }

    void generate()
  }

  function applyProposal() {
    if (proposal === null) {
      return
    }

    onApply(proposal)
    dialogActions.close()
    toast.show({ severity: 'success', message: 'AI suggestion applied to the script.' })
  }

  return (
    <Dialog
      title={`${documentation.title} AI Review`}
      onClose={() => dialogActions.close()}
      className="max-w-[1280px]"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => dialogActions.close()} disabled={isGenerating}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={applyProposal} disabled={!hasProposal || isGenerating}>
            Apply
          </button>
        </>
      }
    >
      <div className="flex max-h-[80vh] min-h-[640px] flex-col gap-4">
        <section className="rounded-2xl border border-base-content/10 bg-base-100/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-base-content">Prompt</div>
              <p className="mt-1 text-sm leading-6 text-base-content/68">
                Ask for a new script, refine the last result, or edit the proposal manually before applying it.
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => void generate()} disabled={isGenerating || !prompt.trim()}>
              {isGenerating ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
              {hasProposal ? 'Regenerate' : 'Generate'}
            </button>
          </div>

          <textarea
            className="textarea min-h-28 w-full rounded-xl border-base-content/10 bg-base-100 font-mono text-sm leading-6"
            placeholder={`Example: ${getPromptPlaceholder(phase)}`}
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
          />

          <label className="mt-3 block max-w-[420px]">
            <div className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-base-content/45">Model</div>
            <select
              className="select h-11 w-full rounded-xl border-base-content/10 bg-base-100"
              value={selectedModel}
              onChange={event => setSelectedModel(event.target.value)}
              disabled={modelsLoading || isGenerating}
            >
              <option value="">{appDefaultModel ? `App default (${appDefaultModel})` : 'OpenCode default'}</option>
              {openCodeModels.map(model => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            {modelsLoading ? <p className="mt-2 text-sm text-base-content/55">Loading available models...</p> : null}
            {modelsError ? <p className="mt-2 text-sm text-error">{modelsError}</p> : null}
          </label>

          {errorMessage ? <p className="mt-3 text-sm text-error">{errorMessage}</p> : null}
        </section>

        {hasProposal ? (
          <>
            <section className="rounded-2xl border border-base-content/10 bg-base-100/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-base-content">Diff</div>
                  <p className="mt-1 text-sm text-base-content/68">
                    {diffSummary.changedBlocks} change block{diffSummary.changedBlocks === 1 ? '' : 's'} • {diffSummary.addedLines} added • {diffSummary.removedLines} removed
                  </p>
                </div>
              </div>

              <div className="max-h-56 overflow-auto rounded-xl border border-base-content/10 bg-base-200/35 font-mono text-xs leading-6">
                {diffSegments.length === 0 ? (
                  <div className="px-3 py-2 text-base-content/55">No changes yet.</div>
                ) : (
                  diffSegments.map((segment, segmentIndex) => (
                    <div key={`${segment.type}-${segmentIndex}`}>
                      {segment.lines.map((line, lineIndex) => (
                        <div
                          key={`${segment.type}-${segmentIndex}-${lineIndex}`}
                          className={[
                            'px-3 whitespace-pre-wrap break-words',
                            segment.type === 'added'
                              ? 'bg-success/10 text-success-content'
                              : segment.type === 'removed'
                                ? 'bg-error/10 text-error-content'
                                : 'text-base-content/65',
                          ].join(' ')}
                        >
                          <span className="mr-2 inline-block w-3 text-center text-base-content/45">
                            {segment.type === 'added' ? '+' : segment.type === 'removed' ? '-' : ' '}
                          </span>
                          {line || ' '}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
              <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-base-content/10 bg-base-100/70">
                <div className="border-b border-base-content/10 px-4 py-3 text-sm font-medium text-base-content">Current script</div>
                <CodeEditor
                  value={currentCode}
                  language={editorLanguage}
                  readOnly
                  vimMode={false}
                  size="small"
                  showLineNumbers
                  minHeightClassName="min-h-0 h-full"
                  className="h-full border-0"
                  onChange={() => undefined}
                />
              </div>

              <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-primary/20 bg-base-100/70">
                <div className="border-b border-base-content/10 px-4 py-3 text-sm font-medium text-base-content">Suggested script</div>
                <CodeEditor
                  value={proposal}
                  language={editorLanguage}
                  size="small"
                  showLineNumbers
                  minHeightClassName="min-h-0 h-full"
                  className="h-full border-0"
                  onChange={value => setProposal(value)}
                />
              </div>
            </section>
          </>
        ) : (
          <div className="grid flex-1 place-items-center rounded-2xl border border-dashed border-base-content/12 bg-base-100/40 px-6 text-center text-sm leading-6 text-base-content/52">
            Generate a proposal to review the diff and edit the suggested script before applying it.
          </div>
        )}
      </div>
    </Dialog>
  )
}

function getPromptPlaceholder(phase: ScriptAiPhase) {
  switch (phase) {
    case 'pre-request':
      return 'Read a token from the active environment, set the Authorization header, and generate a trace id.'
    case 'post-request':
      return 'If the response is 401, call the refresh token request and save the returned token.'
    case 'response-visualizer':
      return 'Render the JSON body as cards grouped by status and show a raw payload editor underneath.'
    case 'view-runtime':
      return 'Build a small dashboard with a button that loads users via callRequest and renders them in a table.'
  }
}

function summarizeDiff(segments: DiffSegment[]) {
  let addedLines = 0
  let removedLines = 0
  let changedBlocks = 0

  for (const segment of segments) {
    if (segment.type === 'added') {
      addedLines += segment.lines.length
      changedBlocks += 1
    } else if (segment.type === 'removed') {
      removedLines += segment.lines.length
      changedBlocks += 1
    }
  }

  return { addedLines, removedLines, changedBlocks }
}

function buildLineDiff(before: string, after: string): DiffSegment[] {
  const beforeLines = splitLines(before)
  const afterLines = splitLines(after)
  const matrix = buildLcsMatrix(beforeLines, afterLines)
  const segments: DiffSegment[] = []

  let leftIndex = 0
  let rightIndex = 0

  while (leftIndex < beforeLines.length && rightIndex < afterLines.length) {
    if (beforeLines[leftIndex] === afterLines[rightIndex]) {
      pushDiffLine(segments, 'context', beforeLines[leftIndex])
      leftIndex += 1
      rightIndex += 1
      continue
    }

    if (matrix[leftIndex + 1][rightIndex] >= matrix[leftIndex][rightIndex + 1]) {
      pushDiffLine(segments, 'removed', beforeLines[leftIndex])
      leftIndex += 1
      continue
    }

    pushDiffLine(segments, 'added', afterLines[rightIndex])
    rightIndex += 1
  }

  while (leftIndex < beforeLines.length) {
    pushDiffLine(segments, 'removed', beforeLines[leftIndex])
    leftIndex += 1
  }

  while (rightIndex < afterLines.length) {
    pushDiffLine(segments, 'added', afterLines[rightIndex])
    rightIndex += 1
  }

  return segments
}

function splitLines(value: string) {
  if (!value) {
    return []
  }

  return value.replace(/\r\n/g, '\n').split('\n')
}

function buildLcsMatrix(left: string[], right: string[]) {
  const matrix = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0))

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      if (left[leftIndex] === right[rightIndex]) {
        matrix[leftIndex][rightIndex] = matrix[leftIndex + 1][rightIndex + 1] + 1
      } else {
        matrix[leftIndex][rightIndex] = Math.max(matrix[leftIndex + 1][rightIndex], matrix[leftIndex][rightIndex + 1])
      }
    }
  }

  return matrix
}

function pushDiffLine(segments: DiffSegment[], type: DiffSegment['type'], line: string) {
  const lastSegment = segments[segments.length - 1]
  if (lastSegment?.type === type) {
    lastSegment.lines.push(line)
    return
  }

  segments.push({ type, lines: [line] })
}
