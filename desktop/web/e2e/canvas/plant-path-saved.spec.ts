// A planted row is ordinary plants (canopi-f47t.54, answers 27 and 28; guard): Plant a row's finish adds plants that
// the saved Design holds as plain plants, after the Design's own, and a Web Draft reload reopens them unchanged. Both
// engines. Reads the saved Design (File > Download a copy); no baselines.
//
// The base fixture at 1024x768 with grid snapping off, its opening camera moved 192 px down with the arrow keys so the
// grown tool card leaves the picked Apple and the row's points clear (plant-path.spec.ts's opening).
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expectCanvasDrawn } from '../support/canvas'
import { mapHost, openFixture } from '../support/layout'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))

interface SavedDesign {
  readonly plants: ReadonlyArray<{ readonly id: string, readonly canonical_name: string }>
  readonly groups?: readonly unknown[]
}

const BASE_PLANT_IDS = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as SavedDesign).plants.map((plant) => plant.id)
const OPENING_PAN_PX = 3 * 64
/** The picked Apple and two points on empty ground beside it, once the map moved down. */
const APPLE = { x: 353.7, y: 264.7 + OPENING_PAN_PX } as const
const P1 = { x: 430, y: 345 + OPENING_PAN_PX } as const
const P2 = { x: 510, y: 300 + OPENING_PAN_PX } as const

test.use({ viewport: { width: 1024, height: 768 } })

async function download(page: Page): Promise<string> {
  await page.getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'File' }).click()
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /^Download a copy/ }).click(),
  ])
  return readFile(await file.path(), 'utf8')
}

/** Reloads the page, which reopens the Design from its Web Draft. */
async function reopenFromDraft(page: Page): Promise<void> {
  await page.reload()
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
  await expectCanvasDrawn(page)
}

function savedAt(text: string): string {
  return text.replace(/"updated_at":\s*"[^"]*"/, '"updated_at": ""')
}

test('(canopi-f47t.54, D) a planted row saves as plain plants after the Design\'s own and reopens from its Web Draft unchanged', async ({ page }) => {
  await openFixture(page, FIXTURE, { keepOnReload: true, settings: { snap_to_grid: false } })
  await mapHost(page).focus()
  for (let step = 0; step < OPENING_PAN_PX / 64; step += 1) await page.keyboard.press('ArrowUp')
  await page.keyboard.press('w')
  await page.mouse.click(APPLE.x, APPLE.y)
  const field = page.locator('[data-tool-card] [data-plant-spacing-interval-input]')
  await expect(field, 'the pick focuses the spacing field').toBeFocused()
  await field.fill('2')
  await page.keyboard.press('Enter')
  await page.mouse.click(P1.x, P1.y)
  await page.mouse.click(P2.x, P2.y)
  await page.keyboard.press('Enter')
  const chip = page.getByRole('group', { name: 'Selection' }).getByRole('status')
  await expect(chip, 'Enter plants the row and selects it').toHaveText(/^\d+ plants · Apple/)
  const selected = Number(/^(\d+)/.exec(((await chip.textContent()) ?? '').trim())![1])

  const planted = await download(page)
  const design = JSON.parse(planted) as SavedDesign
  const ids = design.plants.map((plant) => plant.id)
  expect(ids.slice(0, BASE_PLANT_IDS.length), 'the Design\'s own plants come first, in their order').toEqual(BASE_PLANT_IDS)
  const added = design.plants.slice(BASE_PLANT_IDS.length)
  expect(added.length, 'the row\'s new plants, the picked Apple selected with them').toBe(selected - 1)
  expect(added.every((plant) => plant.canonical_name === 'Malus domestica'), 'each new plant repeats the Apple').toBe(true)
  expect(design.groups ?? [], 'the new plants are not grouped').toEqual([])
  expect(planted.includes('plant_rows'), 'the finish stores no row').toBe(false)

  await reopenFromDraft(page)
  expect(savedAt(await download(page)), 'the reopened Design saves the same plants, its save time apart').toBe(savedAt(planted))
})
