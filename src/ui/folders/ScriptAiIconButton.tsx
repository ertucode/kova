import type { ScriptAiPhase } from '@common/ScriptAi'
import { SparklesIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
import { Tooltip } from '../components/Tooltip'
import { openScriptAiReviewDialog } from './ScriptAiReviewDialog'

export function ScriptAiIconButton({
  phase,
  currentCode,
  onApply,
  className,
  tooltip,
}: {
  phase: ScriptAiPhase
  currentCode: string
  onApply: (nextCode: string) => void
  className?: string
  tooltip?: string
}) {
  const isEditing = currentCode.trim().length > 0

  const button = (
    <button
      type="button"
      className={twMerge(
        'grid w-12 place-items-center text-base-content/45 transition hover:bg-base-200/70 hover:text-base-content h-full cursor-pointer',
        className
      )}
      onClick={() => openScriptAiReviewDialog({ phase, currentCode, onApply })}
      aria-label={isEditing ? 'Update script with AI' : 'Generate script with AI'}
    >
      <SparklesIcon className="size-3.5" />
    </button>
  )

  if (!tooltip) {
    return button
  }

  return (
    <Tooltip content={tooltip} placement="left">
      {button}
    </Tooltip>
  )
}
