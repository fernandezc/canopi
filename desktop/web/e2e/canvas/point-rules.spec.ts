// One point rule for zone corners, and Esc stepping back in Polygon (canopi-f47t.54, stream Z; plan section 4 "2.0
// plant along a path", amendment A2, A16, A17): under Select, Alt+click deletes a corner (guard), a click on a midpoint
// dot adds nothing and its double-click inserts a corner (guard), and a dot drag now inserts a corner where it is
// released; right-click, a long press or Shift+F10 on a corner opens the point menu, Delete point only; in Polygon, Esc
// removes the last point, steps back to nothing, then returns to Select, and Ctrl+Shift+Z restores a removed point. Both
// engines unless a test says otherwise; the long press is Chromium-only (CDP touch). DOM assertions only, no baselines.
//
// Profile's Esc (A17) has no browser test here: the Web build has no Profile (Desktop only, input-probe.spec.ts), so the
// jsdom suite (canvas-interaction-e2e.profile.test.ts) and the native live check carry it.
//
// The base fixture at 1024x768 with grid snapping off: a click on its polygon zone's top edge selects it, and its corners
// and dots are canvas handles `vertex:<zone>:<index>` and `edge-mid:<zone>:<index>`.
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { pressMod } from '../support/canvas'
import { Fingers, type Point } from '../support/fingers'
import { mapHost, openFixture } from '../support/layout'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))
/** On the polygon zone's top edge. */
const POLYGON_EDGE: Point = { x: 740, y: 209 }
const POLYGON_CORNERS = 5
/** Empty ground for a new polygon, clear of the selection chip the finished zone brings up. */
const NEW_POLYGON: readonly Point[] = [{ x: 860, y: 560 }, { x: 940, y: 560 }, { x: 940, y: 620 }, { x: 860, y: 620 }]

test.use({ viewport: { width: 1024, height: 768 } })

async function openBase(page: Page): Promise<void> {
  await openFixture(page, FIXTURE, { settings: { snap_to_grid: false } })
}

function undo(page: Page): Locator {
  return page.getByRole('button', { name: 'Undo', exact: true })
}

function selectionChip(page: Page): Locator {
  return page.getByRole('group', { name: 'Selection' }).getByRole('status')
}

function tool(page: Page, name: string): Locator {
  return page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: new RegExp(`^${name}( \\(.\\))?$`) })
}

interface Handle { readonly id: string, readonly x: number, readonly y: number }

async function handles(page: Page, prefix: 'vertex' | 'edge-mid'): Promise<Handle[]> {
  return page.locator(`[data-canvas-handle^="${prefix}:"]`).evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect()
    return { id: element.getAttribute('data-canvas-handle') ?? '', x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }))
}

async function corners(page: Page): Promise<number> {
  return (await handles(page, 'vertex')).length
}

async function selectPolygon(page: Page): Promise<void> {
  await page.mouse.click(POLYGON_EDGE.x, POLYGON_EDGE.y)
  await expect(selectionChip(page)).toHaveText(/^Polygon zone/)
  await expect.poll(() => corners(page), 'the selected polygon shows its corners').toBe(POLYGON_CORNERS)
}

async function firstCorner(page: Page): Promise<Locator> {
  const [corner] = await handles(page, 'vertex')
  if (!corner) throw new Error('the selected polygon shows no corner')
  return page.locator(`[data-canvas-handle="${corner.id}"]`)
}

/** Undo is on, one Undo turns it off and brings the polygon's corners back. */
async function expectOneUndoStep(page: Page, what: string): Promise<void> {
  await expect(undo(page), `${what}: one Design edit`).toBeEnabled()
  await undo(page).click()
  await expect(undo(page), `${what}: one Undo restores the Design`).toBeDisabled()
  await expect.poll(() => corners(page), `${what}: the corners are back`).toBe(POLYGON_CORNERS)
}

/** The open menu's entries, by their accessible names. */
function pointMenu(page: Page): Locator {
  return page.getByRole('menu').getByRole('menuitem')
}

async function expectDeletePointOnly(page: Page, how: string): Promise<void> {
  await expect(pointMenu(page), `${how} opens the point menu`).toHaveCount(1)
  await expect(pointMenu(page).first(), `${how}: Delete point only`).toHaveAccessibleName(/^Delete point/)
}

async function drawPolygon(page: Page, points: readonly Point[]): Promise<void> {
  await mapHost(page).focus()
  await page.keyboard.press('z')
  await expect(tool(page, 'Polygon zone')).toHaveAttribute('aria-pressed', 'true')
  for (const point of points) await page.mouse.click(point.x, point.y)
}

/** Finishes the draft with Enter and reads the new zone's corners under Select. */
async function finishAndCountCorners(page: Page): Promise<number> {
  await page.keyboard.press('Enter')
  await expect(selectionChip(page), 'Enter finishes a polygon').toHaveText(/^Polygon zone/)
  await page.keyboard.press('Escape')
  await expect(tool(page, 'Select')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => corners(page)).toBeGreaterThan(0)
  return corners(page)
}

test('(canopi-f47t.54, Z) Alt+click on a zone corner deletes it in one Undo step (guard: passes today)', async ({ page }) => {
  await openBase(page)
  await selectPolygon(page)
  await (await firstCorner(page)).click({ modifiers: ['Alt'] })
  await expect.poll(() => corners(page), 'Alt+click deletes the corner').toBe(POLYGON_CORNERS - 1)
  await expectOneUndoStep(page, 'the deleted corner')
})

test('(canopi-f47t.54, Z) a click on a zone\'s midpoint dot adds nothing and a double-click inserts a corner in place (guard)', async ({ page }) => {
  await openBase(page)
  await selectPolygon(page)
  const [dot] = await handles(page, 'edge-mid')
  if (!dot) throw new Error('the selected polygon shows no midpoint dot')
  await page.mouse.click(dot.x, dot.y)
  await page.waitForTimeout(500)
  expect(await corners(page), 'a click on a dot adds nothing').toBe(POLYGON_CORNERS)
  await expect(undo(page)).toBeDisabled()
  await page.mouse.dblclick(dot.x, dot.y)
  await expect.poll(() => corners(page), 'a double-click on a dot inserts a corner').toBe(POLYGON_CORNERS + 1)
  const inserted = (await handles(page, 'vertex')).some((corner) => Math.hypot(corner.x - dot.x, corner.y - dot.y) <= 2)
  expect(inserted, 'the new corner is where the dot was').toBe(true)
  await expectOneUndoStep(page, 'the inserted corner')
})

test.fail('(canopi-f47t.54, Z) dragging a zone\'s midpoint dot inserts a corner where it is released, in one Undo step', async ({ page }) => {
  await openBase(page)
  await selectPolygon(page)
  const [dot] = await handles(page, 'edge-mid')
  if (!dot) throw new Error('the selected polygon shows no midpoint dot')
  const release = { x: dot.x, y: dot.y - 25 }
  await page.mouse.move(dot.x, dot.y)
  await page.mouse.down()
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(dot.x, dot.y - 2.5 * step)
  await expect(undo(page), 'nothing reaches the Design before the release').toBeDisabled()
  await page.mouse.up()
  await expect.poll(() => corners(page), 'the dot drag inserts a corner').toBe(POLYGON_CORNERS + 1)
  const placed = (await handles(page, 'vertex')).some((corner) => Math.hypot(corner.x - release.x, corner.y - release.y) <= 2)
  expect(placed, 'the new corner is where the drag was released').toBe(true)
  await expectOneUndoStep(page, 'the inserted corner')
})

test.fail('(canopi-f47t.54, Z) Esc removes the last polygon point, steps back to nothing, then returns to Select; Ctrl+Shift+Z restores a removed point', async ({ page }) => {
  await openBase(page)
  await drawPolygon(page, NEW_POLYGON)
  await page.keyboard.press('Escape')
  expect(await finishAndCountCorners(page), 'Esc removed the fourth point only').toBe(3)
  await undo(page).click()
  await expect(undo(page)).toBeDisabled()

  await drawPolygon(page, NEW_POLYGON)
  await page.keyboard.press('Escape')
  await pressMod(page, 'Shift+z')
  expect(await finishAndCountCorners(page), 'Ctrl+Shift+Z restored the removed point').toBe(4)
  await undo(page).click()
  await expect(undo(page)).toBeDisabled()

  await drawPolygon(page, NEW_POLYGON.slice(0, 2))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(tool(page, 'Polygon zone'), 'two Escs step back through two points and keep Polygon').toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(tool(page, 'Select'), 'the Esc after the last point returns to Select').toHaveAttribute('aria-pressed', 'true')
  await expect(undo(page), 'stepping back edits nothing').toBeDisabled()
})

test.fail('(canopi-f47t.54, Z) right-click on a zone corner opens a menu of Delete point only, which deletes it in one Undo step', async ({ page }) => {
  await openBase(page)
  await selectPolygon(page)
  await (await firstCorner(page)).click({ button: 'right' })
  await expectDeletePointOnly(page, 'a right-click on a corner')
  await pointMenu(page).first().click()
  await expect.poll(() => corners(page), 'Delete point deletes the corner').toBe(POLYGON_CORNERS - 1)
  await expectOneUndoStep(page, 'the deleted corner')
})

test.describe('long press', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'a finger long press goes through CDP touch input, Chromium-only')
  test.use({ hasTouch: true })

  test.fail('(canopi-f47t.54, Z) a long press on a zone corner opens the point menu (Chromium)', async ({ page }) => {
    await openBase(page)
    const fingers = await Fingers.of(page)
    await fingers.tap(POLYGON_EDGE)
    await expect(selectionChip(page)).toHaveText(/^Polygon zone/)
    await expect.poll(() => corners(page)).toBe(POLYGON_CORNERS)
    const [corner] = await handles(page, 'vertex')
    await fingers.tap(corner!, { holdMs: 600 })
    await expectDeletePointOnly(page, 'a long press on a corner')
    await expect(undo(page), 'the lift runs no entry').toBeDisabled()
  })
})

test.fail('(canopi-f47t.54, Z) Shift+F10 on a focused zone corner opens the point menu', async ({ page }) => {
  await openBase(page)
  await selectPolygon(page)
  await (await firstCorner(page)).focus()
  await page.keyboard.press('Shift+F10')
  await expectDeletePointOnly(page, 'Shift+F10 on a focused corner')
})
