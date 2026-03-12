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
        <div className="flex-1 min-h-0">{children}</div>
        {footer && <div className="flex flex-shrink-0 flex gap-3 justify-end bg-base-100">{footer}</div>}
      </div>
      <form method="dialog" className="modal-backdrop ">
        <button className="cursor-default" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  )
}
