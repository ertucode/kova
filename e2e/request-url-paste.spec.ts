import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

declare global {
  interface Window {
    electron: import('../src/common/Contracts').WindowElectron
  }
}

test.describe('request url paste', () => {
  let electronApp: ElectronApplication
  let page: Page
  let tempDir: string

  test.beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'kova-e2e-'))
    const dbPath = path.join(tempDir, 'kova-e2e.sqlite')

    await writeServerConfig(tempDir, dbPath)

    electronApp = await electron.launch({
      args: ['.'],
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: tempDir,
        NODE_ENV: 'development',
      },
    })

    page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
  })

  test.afterEach(async () => {
    await electronApp.close()
    await rm(tempDir, { recursive: true, force: true })
  })

  test('pasting a full URL rebuilds and persists synced search params', async () => {
    const requestId = await seedRequestFixture(page)

    await page.reload()
    await expect(page.getByTestId('request-url-editor')).toBeVisible()

    const pastedUrl = 'https://api.example.com/orders?page=2&sort=desc'
    await electronApp.evaluate(({ clipboard }, text) => {
      clipboard.writeText(text)
    }, pastedUrl)

    const urlContent = page.locator('[data-testid="request-url-editor"] .cm-content')
    await urlContent.click()
    await page.keyboard.press('Meta+A')
    await page.keyboard.press('Meta+V')

    await expect(page.getByTestId('search-params-tab')).toBeVisible()
    await expect(page.getByTestId('request-search-params-tab-button')).toHaveAttribute('class', /border-b-base-content/)

    await expect.poll(async () => getSearchParamRows(page)).toEqual([
      { key: 'page', value: '2' },
      { key: 'sort', value: 'desc' },
    ])

    await page.keyboard.press('Meta+S')

    await expect.poll(() => getPersistedRequest(page, requestId)).toEqual({
      url: pastedUrl,
      searchParams: 'page:2\nsort:desc',
    })
  })
})

async function writeServerConfig(homeDir: string, dbPath: string) {
  const configDirectory = path.join(homeDir, '.config', 'kova')
  await mkdir(configDirectory, { recursive: true })
  await writeFile(
    path.join(configDirectory, 'kova.json'),
    JSON.stringify(
      {
        databases: {
          active: 'e2e',
          items: [{ name: 'e2e', path: dbPath }],
        },
      },
      null,
      2
    )
  )
}

async function seedRequestFixture(page: Page) {
  return page.evaluate(async () => {
    const createResult = await window.electron.createRequest({
      name: 'Paste URL Fixture',
      parentFolderId: null,
      requestType: 'http',
    })

    if (!createResult.success) {
      throw new Error('Failed to create request fixture')
    }

    const request = createResult.data
    const updateResult = await window.electron.updateRequest({
      ...request,
      url: 'https://api.example.com/orders?stale=1',
      searchParams: 'stale:1',
    })

    if (!updateResult.success) {
      throw new Error('Failed to update request fixture')
    }

    const now = Date.now()
    const saveTabsResult = await window.electron.saveFolderExplorerTabs({
      tabs: [
        {
          id: crypto.randomUUID(),
          itemType: 'request',
          itemId: request.id,
          position: 0,
          isPinned: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    if (!saveTabsResult.success) {
      throw new Error('Failed to open request fixture tab')
    }

    return request.id
  })
}

async function getSearchParamRows(page: Page) {
  return page.locator('[data-testid="search-params-tab"] tr[data-key-value-row-id]').evaluateAll(rows =>
    rows
      .map(row => {
        const keyInput = row.querySelector<HTMLInputElement>('input[data-key-value-field="key"]')
        const valueText = row.querySelector('[data-key-value-field="value"] .cm-line')?.textContent?.trim() ?? ''

        return {
          key: keyInput?.value ?? '',
          value: valueText,
        }
      })
      .filter(row => row.key !== '')
  )
}

async function getPersistedRequest(page: Page, requestId: string) {
  return page.evaluate(async id => {
    const result = await window.electron.getRequest({ id })
    if (!result.success) {
      return null
    }

    return {
      url: result.data.url,
      searchParams: result.data.searchParams,
    }
  }, requestId)
}
