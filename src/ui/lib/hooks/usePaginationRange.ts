import { useMemo } from 'react'

export type UsePaginationRangeProps = {
  totalCount: number
  pageSize: number
  siblingCount?: number
  currentPage: number
}

export const PAGINATION_DOTS = '...'

const range = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index)

export function usePaginationRange({
  totalCount,
  pageSize,
  siblingCount = 1,
  currentPage,
}: UsePaginationRangeProps): readonly (typeof PAGINATION_DOTS | number)[] {
  return useMemo(() => {
    const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))
    const visibleCount = 2 * siblingCount + 5
    if (pageCount <= visibleCount) return range(1, pageCount)

    const left = Math.max(1, currentPage - siblingCount)
    const right = Math.min(pageCount, currentPage + siblingCount)
    const showLeftDots = left > 3
    const showRightDots = right < pageCount - 2

    if (!showLeftDots) {
      return [...range(1, visibleCount - 2), PAGINATION_DOTS, pageCount] as const
    }
    if (!showRightDots) {
      return [1, PAGINATION_DOTS, ...range(pageCount - visibleCount + 3, pageCount)] as const
    }
    return [1, PAGINATION_DOTS, ...range(left, right), PAGINATION_DOTS, pageCount] as const
  }, [totalCount, pageSize, siblingCount, currentPage])
}
