import React, {
  createContext,
  Dispatch,
  SetStateAction,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import Fuse from 'fuse.js'
import { sportForContextMenu } from '../functions/spotForContextMenu'
import { clsx } from '../functions/clsx'

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return node.toString()
  if (React.isValidElement(node)) {
    return React.Children.toArray((node.props as any).children)
      .map(extractText)
      .join(' ')
  }
  return ''
}

export type ContextMenuProps<T> = {
  children: React.ReactNode
  menu: ReturnType<typeof useContextMenu<T>>
}

export function ContextMenu<T>({ children, menu }: ContextMenuProps<T>) {
  const [position, setPosition] = useState(menu.position)
  useLayoutEffect(() => {
    if (!menu || !menu.position || !menu.ref.current) return

    const dialog = menu.ref.current
    const { innerWidth, innerHeight } = window
    const rect = dialog.getBoundingClientRect()

    let x = menu.position.x
    let y = menu.position.y

    // Right overflow
    if (x + rect.width > innerWidth) {
      x = innerWidth - rect.width - 8
    }

    // Bottom overflow
    if (y + rect.height > innerHeight) {
      y = innerHeight - rect.height - 8
    }

    // Left / Top safety
    x = Math.max(8, x)
    y = Math.max(8, y)

    if (x !== menu.position.x || y !== menu.position.y) {
      setPosition(prev => (prev ? { ...prev, x, y } : { x, y }))
    } else {
      setPosition(menu.position)
    }
  }, [menu.position])

  return (
    <div ref={menu.ref} className="fixed z-50" style={{ top: position?.y, left: position?.x }}>
      <ContextMenuContext.Provider value={menu}>{children}</ContextMenuContext.Provider>
    </div>
  )
}

type NormalContextMenuItem = {
  view: React.ReactNode
  onClick?: () => void
  submenu?: (NormalContextMenuItem | false | null | undefined)[]
}
export type ContextMenuItem = NormalContextMenuItem | { isSeparator: true }

export type ForgivingContextMenuItem = ContextMenuItem | false | null | undefined
export type ContextMenuListProps = {
  items: ForgivingContextMenuItem[]
}

function getFilteredItems(items: ForgivingContextMenuItem[], query: string): ContextMenuItem[] {
  if (!query) return items.filter((item): item is ContextMenuItem => !!item)
  const fuseItems = items
    .filter((item): item is NormalContextMenuItem => !!(item && !('isSeparator' in item)))
    .map((item, idx) => ({ item, idx, searchText: extractText(item.view) }))
  const fuse = new Fuse(fuseItems, { keys: ['searchText'] })
  const filteredItems = fuse.search(query).map(result => result.item.item)

  return filteredItems
}

export function ContextMenuList({ items }: ContextMenuListProps) {
  const menu = useContext(ContextMenuContext)
  const [query, setQuery] = useState('')
  const filteredItems = useMemo(() => getFilteredItems(items, query), [items, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  const inputRef = useRef<HTMLInputElement>(null)
  const [indexes, setIndexes] = useState<number[]>([0])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { item: currentItem, maxItems } = getItemAndSiblings(filteredItems, indexes)
      const depthIdx = indexes.length - 1

      if ((e.key === 'j' && e.ctrlKey) || e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setIndexes(prev => {
          const newIndexes = [...prev]
          newIndexes[depthIdx] = Math.min(prev[depthIdx] + 1, maxItems - 1)
          return newIndexes
        })
      } else if ((e.key === 'k' && e.ctrlKey) || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setIndexes(prev => {
          const newIndexes = [...prev]
          newIndexes[depthIdx] = Math.max(prev[depthIdx] - 1, 0)
          return newIndexes
        })
      } else if ((e.key === 'l' && e.ctrlKey) || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        if (currentItem.submenu) {
          setIndexes(prev => {
            const newIndexes = [...prev]
            newIndexes[depthIdx + 1] = 0
            return newIndexes
          })
        } else {
          currentItem.onClick?.()
          menu.close()
        }
      } else if ((e.key === 'h' && e.ctrlKey) || e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        if (indexes.length > 1) {
          setIndexes(prev => {
            const newIndexes = [...prev]
            newIndexes.length = depthIdx
            return newIndexes
          })
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [indexes, filteredItems])

  let navigableIndex = 0

  return (
    <div className="menu menu-sm bg-base-200 rounded-box w-62">
      <div className="relative p-2">
        <input
          ref={inputRef}
          className="input input-sm w-full pr-8"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              if (query) {
                e.preventDefault()
                e.stopPropagation()
                setQuery('')
              }
            }
          }}
          placeholder="Search..."
        />
        {query && (
          <button
            className="absolute right-2 top-1/2 transform -translate-y-1/2 btn btn-xs btn-ghost"
            onClick={() => setQuery('')}
          >
            ×
          </button>
        )}
      </div>
      <ul className="max-w-full">
        {filteredItems.map((item, idx) => {
          if ('isSeparator' in item) return <li key={idx}></li>

          const currentNavigableIndex = navigableIndex++
          const isSelected = currentNavigableIndex === indexes[0]

          if (item.submenu) {
            return (
              <ContextMenuListItemWithSubmenu
                key={idx}
                idx={currentNavigableIndex}
                depthIdx={0}
                indexes={indexes}
                items={filteredItems}
                indexesToHere={[currentNavigableIndex]}
                menu={menu}
                setIndexes={setIndexes}
              />
            )
          }
          return (
            <li key={idx}>
              <a
                className={clsx('max-w-full block', isSelected ? 'bg-base-300' : '')}
                onClick={() => {
                  item.onClick?.()
                  menu.close()
                }}
              >
                {item.view}
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function getItemAndSiblings(items: ContextMenuItem[], indexesToHere: number[]) {
  let item = items[indexesToHere[0]] as NormalContextMenuItem
  let maxItems = items.filter(item => !('isSeparator' in item)).length
  for (let i = 1; i < indexesToHere.length; i++) {
    if ('isSeparator' in item) throw new Error('Separator not allowed in submenu')
    maxItems = item.submenu!.filter(i => !!(i && !('isSeparator' in i))).length
    item = item.submenu?.[indexesToHere[i]] as any as NormalContextMenuItem
  }
  return { item, maxItems }
}

function ContextMenuListItemWithSubmenu({
  idx,
  depthIdx,
  indexes,
  setIndexes,
  indexesToHere,
  items,
  menu,
}: {
  idx: number
  depthIdx: number
  indexes: number[]
  indexesToHere: number[]
  setIndexes: Dispatch<SetStateAction<number[]>>
  items: ContextMenuItem[]
  menu: ReturnType<typeof useContextMenu<any>>
}) {
  const isSelected = indexes[depthIdx] === idx
  const isOpen = isSelected && indexes[depthIdx + 1] !== undefined

  const { item } = getItemAndSiblings(items, indexesToHere)

  let navigableIndex = 0

  if ('isSeparator' in item) return <li key={idx}></li>

  return (
    <li key={idx}>
      <details className="max-w-full" open={isOpen}>
        <summary
          className={isSelected ? 'bg-base-300' : ''}
          onClick={e => {
            e.preventDefault()
            setIndexes(prev => {
              const newIndexes = [...prev]
              if (isOpen) {
                newIndexes.length = depthIdx + 1
              } else {
                newIndexes[depthIdx] = idx
                newIndexes[depthIdx + 1] = 0
              }
              return newIndexes
            })
          }}
        >
          {item.view}
        </summary>
        <ul>
          {item.submenu?.map((subItem, subIdx) => {
            if (!subItem) return null
            if ('isSeparator' in subItem) return <li key={subIdx}></li>

            const currentNavigableIndex = navigableIndex++
            const isSubmenuSelected = indexes[depthIdx + 1] === currentNavigableIndex

            if (subItem.submenu)
              return (
                <ContextMenuListItemWithSubmenu
                  key={subIdx}
                  idx={currentNavigableIndex}
                  depthIdx={depthIdx + 1}
                  indexes={indexes}
                  setIndexes={setIndexes}
                  indexesToHere={indexesToHere.concat(currentNavigableIndex)}
                  items={items}
                  menu={menu}
                />
              )
            return (
              <li key={subIdx}>
                <a
                  className={clsx('max-w-full block', isSubmenuSelected ? 'bg-base-300' : '')}
                  onClick={() => {
                    subItem?.onClick?.()
                    menu.close()
                  }}
                >
                  {subItem.view}
                </a>
              </li>
            )
          })}
        </ul>
      </details>
    </li>
  )
}

type ContextMenuState<T> = {
  position: { x: number; y: number }
  item: T
  element: HTMLElement
}
export function useContextMenu<T>() {
  const [state, setState] = useState<ContextMenuState<T> | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (
        // !state?.element.contains(e.target as Node) &&
        !ref.current?.contains(e.target as Node)
      ) {
        setState(null)
      }
    }

    const keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setState(null)
      }
    }

    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    document.addEventListener('keydown', keydownHandler)

    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
      document.removeEventListener('keydown', keydownHandler)
    }
  }, [state, ref])

  return {
    isOpen: state != null,
    onRightClick: (e: React.MouseEvent, item: T) => {
      e.preventDefault()
      setState({
        position: { x: e.clientX, y: e.clientY },
        item,
        element: e.currentTarget as HTMLElement,
      })
    },
    showWithElement: (element: HTMLElement, item: T) => {
      setState({
        position: sportForContextMenu(element),
        item,
        element,
      })
    },
    item: state?.item,
    position: state?.position,
    ref,
    close: () => setState(null),
  }
}

const ContextMenuContext = createContext<ReturnType<typeof useContextMenu<any>>>(
  {} as ReturnType<typeof useContextMenu>
)
