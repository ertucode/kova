import { useMemo } from 'react'
import { FastIdentity } from '@common/FastIdentity'
import type { ReactNode } from 'react'

export type ColumnDef<T> = {
  id: string | number
  sortKey: string | undefined
  header: ReactNode
  cell: (item: T, data: { index: number }) => ReactNode
  size?: number
  headerConfigView?: ReactNode
}

export type TableMetadata<T> = ReturnType<typeof useTable<T>>

export type UseTableOptions<T> = {
  columns: ColumnDef<T>[]
  data: T[]
}

export function useTable<T>(opts: UseTableOptions<T>) {
  const { columns: cols, data } = opts
  const headers = useMemo(() => {
    return cols.map(col => {
      const value = resolveColumnHeaderValue(col)

      return {
        value,
        id: columnId(col),
        sortKey: columnSortKey(col),
        size: col.size,
      }
    })
  }, [cols])

  const rows = useMemo(() => {
    return data.map((item, idx) => {
      return {
        cells: cols.map((col, colIdx) => {
          const value = resolveColumnCellValue(col, item, idx)
          return {
            value,
            id: headers[colIdx].id,
          }
        }),
        id: getId(item),
      }
    })
  }, [data, cols])

  return {
    headers,
    rows,
    data,
  }
}

function resolveColumnHeaderValue<T>(col: ColumnDef<T>) {
  if (col.header != null) return col.header
  return 'N/A'
}

function resolveColumnCellValue<T>(col: ColumnDef<T>, item: T, idx: number) {
  return col.cell(item, { index: idx })
}

function columnId<T>(col: ColumnDef<T>) {
  return col.id
}

export function columnSortKey<T>(col: ColumnDef<T>) {
  if (col.sortKey) return col.sortKey
  if (col.id) return col.id
  return undefined
}

const getId = FastIdentity.create()
