// A planted row is stored (canopi-f47t.54, stream R; plan section 4 "2.0 plant along a path", amendment A4, A5): the
// optional root `plant_rows` survives a Web Draft reload, and the scene owns it, so membership is derived from the plants
// on read: a member whose plant is gone leaves the row. A Design without rows saves as before, with no `plant_rows`
// (guard). Both engines. Reads the saved Design (File > Download a copy); no baselines.
//
// e2e/fixtures/plant-path.canopi is the base fixture plus one open hazel row: four points (the second sharp), every
// 3.5 m, six members whose `at` is their plant's position. At 1024x768 its opening camera is the base fixture's (the row
// lies inside the Design's bounds): the rectangle zone's north-west corner at (312, 223), 10.414 px per metre.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expectCanvasDrawn } from '../support/canvas'
import { openFixture } from '../support/layout'
import { expect, test } from '../support/offline'

const ROW_FIXTURE = fileURLToPath(new URL('../fixtures/plant-path.canopi', import.meta.url))
const BASE_FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))

/** The row's last member on screen, and its plant's id. */
const LAST_MEMBER = { x: 647.9, y: 351.4 } as const
const LAST_MEMBER_ID = '5e0f2c1a-7b3d-4c8e-9a10-000000000006'

interface GeoPoint { readonly lon: number, readonly lat: number }
interface SavedDesign {
  readonly plants: ReadonlyArray<{ readonly id: string, readonly position: GeoPoint }>
  readonly plant_rows?: ReadonlyArray<{
    readonly id: string
    readonly anchors: ReadonlyArray<{ readonly position: GeoPoint, readonly sharp: boolean }>
    readonly closed: boolean
    readonly members: ReadonlyArray<{ readonly plant_id: string, readonly at: GeoPoint }>
  }>
}

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

/** The saved rows, each member checked against its plant: present and exactly at `at`. */
function expectMembersAtTheirPlants(design: SavedDesign, members: number): void {
  expect(design.plant_rows?.length, 'the saved Design holds one row').toBe(1)
  const [row] = design.plant_rows!
  expect(row!.anchors.map((anchor) => anchor.sharp), 'its four points, the second sharp').toEqual([false, true, false, false])
  expect(row!.closed).toBe(false)
  expect(row!.members.length, `the row holds ${members} members`).toBe(members)
  for (const member of row!.members) {
    const plant = design.plants.find((candidate) => candidate.id === member.plant_id)
    expect(plant, `member ${member.plant_id} is a plant of the Design`).toBeDefined()
    expect(plant!.position, `member ${member.plant_id} is at its plant`).toEqual(member.at)
  }
}

test.fail('(canopi-f47t.54, R) a reopened Design keeps its row: after a Web Draft reload the saved Design holds the row with its six members', async ({ page }) => {
  await openFixture(page, ROW_FIXTURE, { keepOnReload: true, settings: { snap_to_grid: false } })
  await reopenFromDraft(page)
  expectMembersAtTheirPlants(JSON.parse(await download(page)) as SavedDesign, 6)

  // The row is the scene's, not a key carried through unread: a member whose plant is deleted leaves it on reopen.
  await page.mouse.click(LAST_MEMBER.x, LAST_MEMBER.y)
  await expect(page.getByRole('group', { name: 'Selection' }).getByRole('status')).toHaveText(/European hazelnut/)
  await page.keyboard.press('Delete')
  await expect(page.locator('[data-selection-chip]'), 'Delete removes the plant').toBeHidden()
  await reopenFromDraft(page)
  const design = JSON.parse(await download(page)) as SavedDesign
  expect(design.plants.some((plant) => plant.id === LAST_MEMBER_ID), 'the deleted plant is gone').toBe(false)
  expectMembersAtTheirPlants(design, 5)
})

test('(canopi-f47t.54, R) a Design without rows saves byte-identical (guard after commit 0)', async ({ page }) => {
  await openFixture(page, BASE_FIXTURE, { keepOnReload: true })
  const first = await download(page)
  await reopenFromDraft(page)
  const second = await download(page)
  const savedAt = (text: string) => text.replace(/"updated_at":\s*"[^"]*"/, '"updated_at": ""')
  expect(savedAt(second), 'the reopened Design saves the same bytes, its save time apart').toBe(savedAt(first))
  expect(first.includes('plant_rows'), 'a Design without rows writes no plant_rows').toBe(false)
})
