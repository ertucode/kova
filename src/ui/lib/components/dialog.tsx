import { type ReactNode, useEffect, useRef } from 'react'
import { cn } from '../functions/clsx'

export function Dialog({
  title,
  children,
  onClose,
  className,
  style,
  footer,
}: {
  title?: ReactNode
  children: ReactNode
  onClose?: () => void
  className?: string
  style?: React.CSSProperties
  footer?: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (children) {
      dialogRef.current?.showModal()
    } else {
      dialogRef.current?.close()
    }
  }, [children])

  return (
    <dialog className="modal" ref={dialogRef} onClose={onClose}>
      <div className={cn('modal-box max-w-[80vw] max-h-[80vh] flex flex-col gap-3', className)} style={style}>
        {title && <h3 className="font-bold text-lg flex-shrink-0">{title}</h3>}
        <div className={cn('flex-1 min-h-0 overflow-y-auto', footer ? 'pb-8' : '')}>{children}</div>
        {footer ? (
          <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-auto flex flex-shrink-0 justify-end gap-3 border-t border-base-content/10 bg-base-100/95 px-6 py-4 backdrop-blur-sm">
            {footer}
          </div>
        ) : null}
      </div>
      <form method="dialog" className="modal-backdrop ">
        <button className="cursor-default" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  )
}
