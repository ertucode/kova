import { describe, expect, it } from 'vitest'
import { isLikelyRefreshComponentName, transformViewRuntimeSource } from './viewRuntimeRefresh'

describe('transformViewRuntimeSource', () => {
  it('wraps top-level function components used by the view', () => {
    const source = `export default function View() {
  return <Request />
}

function Request() {
  return <div>test</div>
}`

    const transformed = transformViewRuntimeSource(source, 'view-runtime:main')
    expect(transformed).toContain(`const View = __registerHotComponent("view-runtime:main:View"`)
    expect(transformed).toContain(`const Request = __registerHotComponent("view-runtime:main:Request"`)
    expect(transformed).toContain('export default View;')
  })

  it('wraps top-level arrow function components', () => {
    const source = `const Request = () => <div />
export default function View() {
  return <Request />
}`

    expect(transformViewRuntimeSource(source, 'view-runtime:main')).toContain(
      `const Request = __registerHotComponent("view-runtime:main:Request"`
    )
  })

  it('ignores non-component declarations', () => {
    const source = `function helper() {
  return 1
}

const request = () => null

export default function View() {
  return <div />
}`

    const transformed = transformViewRuntimeSource(source, 'view-runtime:main')
    expect(transformed).toContain(`const View = __registerHotComponent("view-runtime:main:View"`)
    expect(transformed).toContain('function helper()')
    expect(transformed).not.toContain('__registerHotComponent("view-runtime:main:helper"')
    expect(transformed).not.toContain('__registerHotComponent("view-runtime:main:request"')
  })
})

describe('isLikelyRefreshComponentName', () => {
  it('matches PascalCase names', () => {
    expect(isLikelyRefreshComponentName('View')).toBe(true)
    expect(isLikelyRefreshComponentName('Request')).toBe(true)
  })

  it('rejects lowercase names', () => {
    expect(isLikelyRefreshComponentName('view')).toBe(false)
    expect(isLikelyRefreshComponentName('request')).toBe(false)
  })
})
