import { getScriptAiTargetKey, type ScriptAiOwnerType, type ScriptAiRuntimeContext } from '@common/ScriptAi'
import { LoaderCircleIcon, SparklesIcon } from 'lucide-react'
import { useEffect } from 'react'
import { useSelector } from '@xstate/store/react'
import { twMerge } from 'tailwind-merge'
import { appSettingsStore } from '@/global/appSettingsStore'
import { Tooltip } from '../components/Tooltip'
import { openScriptAiReviewDialog } from './ScriptAiReviewDialog'
import { isScriptAiReviewEntryBusy, scriptAiReviewStore, ScriptAiReviewCoordinator } from './scriptAiReviewStore'

export function ScriptAiIconButton({
  ownerType,
  ownerId,
  runtimeContext,
  currentCode,
  onApply,
  className,
  tooltip,
}: {
  ownerType: ScriptAiOwnerType
  ownerId: string
  runtimeContext: ScriptAiRuntimeContext
  currentCode: string
  onApply: (
    nextCode: string,
    options?: {
      skipFormatting?: boolean
      skipSync?: boolean
    }
  ) => Promise<boolean | void> | boolean | void
  className?: string
  tooltip?: string
}) {
  const isEditing = currentCode.trim().length > 0
  const target = { ownerType, ownerId, runtimeContext }
  const targetKey = getScriptAiTargetKey(target)
  const appDefaultModel = useSelector(appSettingsStore, state => state.context.settings?.scriptAiModel ?? null)
  const reviewEntry = useSelector(scriptAiReviewStore, state => state.context.entriesByTargetKey[targetKey] ?? null)
  const isBusy = isScriptAiReviewEntryBusy(reviewEntry)

  useEffect(() => {
    ScriptAiReviewCoordinator.registerTarget({
      target,
      currentCode,
      onApply,
      defaultModel: appDefaultModel,
    })
  }, [appDefaultModel, currentCode, onApply, target])

  const button = (
    <button
      type="button"
      className={twMerge(
        'relative grid h-full w-12 place-items-center text-base-content/45 transition hover:bg-base-200/70 hover:text-base-content cursor-pointer',
        className
      )}
      onClick={() => openScriptAiReviewDialog({ target, currentCode, onApply })}
      aria-label={isEditing ? 'Update script with AI' : 'Generate script with AI'}
    >
      <SparklesIcon className="size-3.5" />
      {isBusy ? (
        <span className="pointer-events-none absolute bottom-1 right-1 rounded-full bg-base-100/90 text-primary shadow-sm">
          <LoaderCircleIcon className="size-3 animate-spin" />
        </span>
      ) : null}
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
