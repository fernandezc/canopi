// Plant a row bends (canopi-f47t.54, stream P; plan section 4 "2.0 plant along a path", amendment A1, A2, A8, A17): after
// the pick, clicks add points and Enter, a double-click on the last point or the tool card's check button plants the row
// along a smooth curve through them, in one Undo step; a click on the first point closes a loop; "N plants" counts the
// picked plant; before planting a point drags, a dot drag or double-click inserts, Alt+click deletes and Alt while placing
// makes a sharp point; Esc, Backspace and Ctrl+Z step back one point; the card's point buttons act on the last-touched
// point. A drag from the plant still plants a straight row (guard). Both engines unless a test says otherwise; WebKit has
// taps, finger drags are Chromium-only (CDP). DOM and saved-Design assertions only, no baselines.
//
// The base fixture at 1024x768 with grid snapping off, so a click places a point where it lands: its opening camera puts
// the rectangle zone's north-west corner at (312, 223) and draws 10.414 px per metre; the Apple inside that zone is the
// row's picked plant. The DOM contract these tests read (stream P builds it): row points and midpoint dots are canvas
// handles `point:<owner>:<index>` and `dot:<owner>:<index>` (glyph `corner` on a sharp point); the tool card carries the
// check button `[data-plant-row-finish]`, the mode switch `[data-plant-row-mode="interval" | "count"]`, the count field
// `[data-plant-row-count-input]`, a loop's rounded spacing `[data-plant-row-loop-spacing]` and the point buttons named
// "Sharp corner", "Smooth corner" and "Delete point" (canvas.point.*).
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { pressMod } from '../support/canvas'
import { Fingers, type Point } from '../support/fingers'
import { mapHost, openFixture } from '../support/layout'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))

interface StoredPlant { readonly id: string, readonly canonical_name: string, readonly position: { readonly lon: number, readonly lat: number } }

const BASE_PLANT_IDS = new Set((JSON.parse(readFileSync(FIXTURE, 'utf8')) as { plants: StoredPlant[] }).plants.map((plant) => plant.id))
/** The picked Apple, as stored and on screen. */
const APPLE_ID = '46595420-3ba9-4184-a4b0-b65fb40eff31'
const APPLE_GEO = { lon: 3.877071839, lat: 43.611230142 }
const APPLE: Point = { x: 353.7, y: 264.7 }
const PX_PER_M = 10.414
/** Empty ground for the row's points, about 9 to 11 m apart. */
const P1: Point = { x: 430, y: 345 }
const P2: Point = { x: 510, y: 300 }
const P3: Point = { x: 575, y: 370 }
/** Empty ground for a loop with the Apple: about 11 m from it and from each other. */
const Q1: Point = { x: 470, y: 265 }
const Q2: Point = { x: 412, y: 365 }
/** Empty ground for a point placed with Alt. */
const P4: Point = { x: 640, y: 330 }
/** Empty ground away from the row. */
const GROUND: Point = { x: 560, y: 590 }

test.use({ viewport: { width: 1024, height: 768 } })

async function openBase(page: Page): Promise<void> {
  await openFixture(page, FIXTURE, { settings: { snap_to_grid: false } })
}

function undo(page: Page): Locator {
  return page.getByRole('button', { name: 'Undo', exact: true })
}

function card(page: Page): Locator {
  return page.locator('[data-tool-card]')
}

function selectionChip(page: Page): Locator {
  return page.getByRole('group', { name: 'Selection' }).getByRole('status')
}

function intervalField(page: Page): Locator {
  return page.locator('[data-plant-spacing-interval-input]')
}

function tool(page: Page, name: string): Locator {
  return page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: new RegExp(`^${name}( \\(.\\))?$`) })
}

/** Arms Plant a row from the keyboard (W). */
async function armRow(page: Page): Promise<void> {
  await mapHost(page).focus()
  await page.keyboard.press('w')
  await expect(card(page)).toHaveAttribute('data-tool-card', 'plant-spacing')
}

/** Arms Plant a row, picks the Apple and keeps an interval: Enter in the field keeps it and gives the map focus back. */
async function pickApple(page: Page, interval = '2'): Promise<void> {
  await armRow(page)
  await page.mouse.click(APPLE.x, APPLE.y)
  await expect(intervalField(page), 'the pick focuses the spacing field').toBeFocused()
  await intervalField(page).fill(interval)
  await page.keyboard.press('Enter')
  await expect(mapHost(page), 'Enter in the field gives the map focus back').toBeFocused()
}

async function click(page: Page, at: Point, modifiers: readonly ('Alt' | 'Shift')[] = []): Promise<void> {
  for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.click(at.x, at.y)
  for (const key of modifiers) await page.keyboard.up(key)
}

async function drag(page: Page, from: Point, to: Point, steps = 10): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps)
  }
  await page.mouse.up()
}

interface Handle { readonly id: string, readonly glyph: string, readonly index: number, readonly x: number, readonly y: number, readonly width: number, readonly height: number }

/** The shown row point or dot handles, by index. */
async function handles(page: Page, role: 'point' | 'dot'): Promise<Handle[]> {
  const all = await page.locator(`[data-canvas-handle^="${role}:"]`).evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect()
    return {
      id: element.getAttribute('data-canvas-handle') ?? '',
      glyph: element.getAttribute('data-canvas-handle-glyph') ?? '',
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      width: box.width,
      height: box.height,
    }
  }))
  return all.map((handle) => ({ ...handle, index: Number(handle.id.split(':').at(-1)) })).sort((a, b) => a.index - b.index)
}

/** The draft's points: one more than the highest point index shown (the picked plant is point 0). */
async function pointCount(page: Page): Promise<number> {
  const points = await handles(page, 'point')
  return points.length === 0 ? 0 : points.at(-1)!.index + 1
}

async function pointAt(page: Page, index: number): Promise<Handle> {
  const point = (await handles(page, 'point')).find((handle) => handle.index === index)
  if (!point) throw new Error(`no point ${index} is shown`)
  return point
}

/** Undo is on, one Undo turns it off: the step made exactly one Design edit on a freshly opened Design. */
async function expectOneUndoStep(page: Page, what: string): Promise<void> {
  await expect(undo(page), `${what}: one Design edit`).toBeEnabled()
  await undo(page).click()
  await expect(undo(page), `${what}: one Undo restores the Design`).toBeDisabled()
}

/** The Design as File > Download a copy saves it. */
async function savedDesign(page: Page): Promise<{ plants: StoredPlant[] }> {
  await page.getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'File' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /^Download a copy/ }).click(),
  ])
  return JSON.parse(await readFile(await download.path(), 'utf8')) as { plants: StoredPlant[] }
}

/** Metres east and north of the Apple: the plane is flat enough over 50 m for these checks. */
function metresFromApple(geo: { readonly lon: number, readonly lat: number }): Point {
  const lat = (APPLE_GEO.lat * Math.PI) / 180
  return { x: (geo.lon - APPLE_GEO.lon) * 111_320 * Math.cos(lat), y: (geo.lat - APPLE_GEO.lat) * 110_574 }
}

function screenToMetres(at: Point): Point {
  return { x: (at.x - APPLE.x) / PX_PER_M, y: -(at.y - APPLE.y) / PX_PER_M }
}

/** The row's plants in the saved Design: the Apple and the Apples the row added. */
async function savedRow(page: Page): Promise<Point[]> {
  const design = await savedDesign(page)
  return design.plants
    .filter((plant) => plant.id === APPLE_ID || (!BASE_PLANT_IDS.has(plant.id) && plant.canonical_name === 'Malus domestica'))
    .map((plant) => metresFromApple(plant.position))
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Distance from `p` to the line through `a` and `b`. */
function offLine(p: Point, a: Point, b: Point): number {
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / distance(a, b)
}

/** The plant count the selection chip leads with ("15 plants · Apple"). */
async function selectedPlants(page: Page): Promise<number> {
  const text = (await selectionChip(page).textContent()) ?? ''
  const match = /^(\d+)/.exec(text.trim())
  return match ? Number(match[1]) : 1
}

test.fail('(canopi-f47t.54, P) clicks bend a row through four points and Enter plants it in one Undo step', async ({ page }) => {
  await openBase(page)
  await pickApple(page)
  for (const at of [P1, P2, P3]) await click(page, at)
  await expect(undo(page), 'a click adds a point and plants nothing').toBeDisabled()
  await expect.poll(() => pointCount(page), 'the picked plant and three points').toBe(4)

  await page.keyboard.press('Enter')
  await expect(selectionChip(page), 'Enter plants the row and selects it').toHaveText(/^\d+ plants · Apple/)
  const row = await savedRow(page)
  expect(row.length, 'the row is planted').toBeGreaterThan(10)
  expect(await selectedPlants(page), 'the selection is the row').toBe(row.length)
  for (const [name, at] of [['the first point', P1], ['the second point', P2], ['the last point', P3]] as const) {
    const point = screenToMetres(at)
    expect(Math.min(...row.map((plant) => distance(plant, point))), `the row passes through ${name}`).toBeLessThanOrEqual(1.2)
  }
  const end = screenToMetres(P3)
  expect(Math.max(...row.map((plant) => offLine(plant, { x: 0, y: 0 }, end))), 'the row bends away from the straight line').toBeGreaterThan(3)
  await expectOneUndoStep(page, 'the planted row')
})

test.fail('(canopi-f47t.54, P) a double-click on the last point plants the row', async ({ page }) => {
  await openBase(page)
  await pickApple(page)
  await click(page, P1)
  await click(page, P2)
  await expect(undo(page), 'a click adds a point and plants nothing').toBeDisabled()
  const last = await pointAt(page, 2)
  await page.mouse.dblclick(last.x, last.y)
  await expect(selectionChip(page), 'the double-click plants the row').toHaveText(/^\d+ plants · Apple/)
  const row = await savedRow(page)
  const bend = screenToMetres(P1)
  expect(Math.min(...row.map((plant) => distance(plant, bend))), 'the row passes through the first point').toBeLessThanOrEqual(1.2)
  await expectOneUndoStep(page, 'the planted row')
})

test.fail('(canopi-f47t.54, P) the check button plants the row', async ({ page }) => {
  await openBase(page)
  await pickApple(page)
  await click(page, P1)
  await click(page, P2)
  const finish = card(page).locator('[data-plant-row-finish]')
  await expect(finish, 'two points show the check button').toBeVisible()
  await expect(undo(page), 'nothing is planted before the finish').toBeDisabled()
  await finish.click()
  await expect(selectionChip(page), 'the check button plants the row').toHaveText(/^\d+ plants · Apple/)
  await expect(finish, 'the planted row leaves no check button').toHaveCount(0)
  await expectOneUndoStep(page, 'the planted row')
})

test.fail('(canopi-f47t.54, P) a click on the first point closes a loop and every N m rounds to equal gaps shown in the card', async ({ page }) => {
  await openBase(page)
  await pickApple(page, '3')
  await click(page, Q1)
  await click(page, Q2)
  await click(page, APPLE)
  const shown = card(page).locator('[data-plant-row-loop-spacing]')
  await expect(shown, 'the closed loop shows its rounded spacing').toBeVisible()
  await expect(undo(page), 'closing the loop plants nothing').toBeDisabled()
  const spacing = Number.parseFloat(((await shown.textContent()) ?? '').replace(',', '.'))
  expect(spacing, 'every 3 m rounds to a nearby equal gap').toBeGreaterThan(2.5)
  expect(spacing).toBeLessThan(3.5)

  await page.keyboard.press('Enter')
  await expect(selectionChip(page), 'Enter plants the loop').toHaveText(/^\d+ plants · Apple/)
  const row = await savedRow(page)
  expect(row.length, 'a loop of some 35 m at about 3 m').toBeGreaterThanOrEqual(10)
  const gaps = row.map((plant) => Math.min(...row.filter((other) => other !== plant).map((other) => distance(plant, other))))
  for (const gap of gaps) expect(Math.abs(gap - Math.min(...gaps)), 'the loop\'s gaps are equal').toBeLessThanOrEqual(0.25)
  await expectOneUndoStep(page, 'the planted loop')
})

test.fail('(canopi-f47t.54, P) N plants evenly plants N plants, the picked one included', async ({ page }) => {
  await openBase(page)
  await pickApple(page)
  await click(page, P1)
  const plants = card(page).locator('[data-plant-row-mode="count"]')
  await expect(plants, 'the card offers N plants').toBeVisible()
  await plants.click()
  const count = card(page).locator('[data-plant-row-count-input]')
  await count.fill('5')
  await count.press('Enter')
  await expect(mapHost(page), 'Enter in the count gives the map focus back').toBeFocused()
  await page.keyboard.press('Enter')
  await expect(selectionChip(page), 'five plants, the picked Apple among them').toHaveText(/^5 plants · Apple/)
  expect((await savedRow(page)).length, 'the row holds five plants').toBe(5)
  await expectOneUndoStep(page, 'the planted row')
})

test.fail('(canopi-f47t.54, P) before planting: drag a point, drag a dot to insert, double-click a dot to insert in place, Alt+click deletes a point, Alt while placing makes it sharp', async ({ page }) => {
  await openBase(page)
  await pickApple(page)
  for (const at of [P1, P2, P3]) await click(page, at)
  await expect.poll(() => pointCount(page), 'the picked plant and three points').toBe(4)

  const second = await pointAt(page, 2)
  const moved = { x: second.x, y: second.y - 30 }
  await drag(page, second, moved)
  await expect.poll(async () => Math.round(distance(await pointAt(page, 2), moved)), 'the dragged point follows the pointer').toBeLessThanOrEqual(2)

  const [firstDot] = await handles(page, 'dot')
  if (!firstDot) throw new Error('the draft shows no midpoint dot')
  await drag(page, firstDot, { x: firstDot.x - 20, y: firstDot.y + 20 })
  await expect.poll(() => pointCount(page), 'a dot drag inserts a point').toBe(5)
  const inserted = await pointAt(page, 1)
  expect(distance(inserted, { x: firstDot.x - 20, y: firstDot.y + 20 }), 'the inserted point is where the drag ended').toBeLessThanOrEqual(2)

  const dot = (await handles(page, 'dot')).at(-1)!
  await page.mouse.dblclick(dot.x, dot.y)
  await expect.poll(() => pointCount(page), 'a double-click on a dot inserts a point in place').toBe(6)

  const third = await pointAt(page, 3)
  await click(page, third, ['Alt'])
  await expect.poll(() => pointCount(page), 'Alt+click deletes the point').toBe(5)

  await click(page, P4, ['Alt'])
  await expect.poll(() => pointCount(page), 'Alt while placing still adds a point').toBe(6)
  expect((await pointAt(page, 5)).glyph, 'a point placed with Alt is sharp').toBe('corner')
  expect((await pointAt(page, 4)).glyph, 'a point placed without Alt is smooth').toBe('vertex')
  await expect(undo(page), 'editing the draft plants nothing').toBeDisabled()
})

test.fail('(canopi-f47t.54, P) Esc, Backspace and Ctrl+Z remove the last point and Ctrl+Shift+Z restores it; Esc steps back to the picked plant, drops it, then returns to Select', async ({ page }) => {
  await openBase(page)
  await pickApple(page)
  for (const at of [P1, P2, P3]) await click(page, at)
  await expect.poll(() => pointCount(page), 'the picked plant and three points').toBe(4)

  await page.keyboard.press('Escape')
  await expect.poll(() => pointCount(page), 'Esc removes the last point').toBe(3)
  await page.keyboard.press('Backspace')
  await expect.poll(() => pointCount(page), 'Backspace removes the last point').toBe(2)
  await pressMod(page, 'z')
  await expect.poll(() => pointCount(page), 'Ctrl+Z removes the last point').toBeLessThanOrEqual(1)
  await expect(intervalField(page), 'the picked plant stays').toBeVisible()
  await pressMod(page, 'Shift+z')
  await expect.poll(() => pointCount(page), 'Ctrl+Shift+Z restores the last removed point').toBe(2)

  await page.keyboard.press('Escape')
  await expect.poll(() => pointCount(page), 'Esc steps back to the picked plant').toBeLessThanOrEqual(1)
  await expect(intervalField(page), 'the picked plant stays after the points').toBeVisible()
  await page.keyboard.press('Escape')
  await expect(intervalField(page), 'the next Esc drops the picked plant').toHaveCount(0)
  await expect(card(page)).toHaveAttribute('data-tool-card', 'plant-spacing')
  await page.keyboard.press('Escape')
  await expect(tool(page, 'Select'), 'the last Esc returns to Select').toHaveAttribute('aria-pressed', 'true')
  await expect(undo(page), 'stepping back edits nothing').toBeDisabled()
})

test.fail('(canopi-f47t.54, P) the card\'s Sharp corner and Delete point act on the last-touched point', async ({ page }) => {
  await openBase(page)
  await pickApple(page)
  for (const at of [P1, P2, P3]) await click(page, at)
  await expect.poll(() => pointCount(page), 'the picked plant and three points').toBe(4)

  const second = await pointAt(page, 2)
  await page.mouse.click(second.x, second.y)
  const sharp = card(page).getByRole('button', { name: 'Sharp corner' })
  await expect(sharp, 'the card offers Sharp corner for the touched point').toBeVisible()
  await sharp.click()
  await expect.poll(async () => (await pointAt(page, 2)).glyph, 'the touched point is sharp').toBe('corner')
  expect((await pointAt(page, 3)).glyph, 'the last point stays smooth').toBe('vertex')
  await expect(card(page).getByRole('button', { name: 'Smooth corner' }), 'the card now offers Smooth corner').toBeVisible()

  await card(page).getByRole('button', { name: 'Delete point' }).click()
  await expect.poll(() => pointCount(page), 'Delete point removes the touched point').toBe(3)
  await expect(undo(page), 'the card\'s point buttons plant nothing').toBeDisabled()
})

test('(canopi-f47t.54, P) a drag from the plant still plants a straight row in one Undo step (guard)', async ({ page }) => {
  await openBase(page)
  await armRow(page)
  await drag(page, APPLE, P1)
  await expect(selectionChip(page), 'the release plants the row and selects it').toHaveText(/^\d+ plants · Apple/)
  const row = await savedRow(page)
  expect(row.length, 'every 50 cm along some 10.6 m').toBeGreaterThan(15)
  expect(await selectedPlants(page)).toBe(row.length)
  const source = row.find((plant) => distance(plant, { x: 0, y: 0 }) < 0.01)!
  const end = row.reduce((far, plant) => (distance(plant, source) > distance(far, source) ? plant : far), source)
  expect(distance(end, screenToMetres(P1)), 'the row ends near the release').toBeLessThanOrEqual(0.6)
  for (const plant of row) expect(offLine(plant, source, end), 'the row is straight').toBeLessThanOrEqual(0.02)
  await expectOneUndoStep(page, 'the planted row')
})

test.describe('touch', () => {
  test.use({ hasTouch: true })

  test.fail('(canopi-f47t.54, P) touch: tapped points get 44 px handles and the check button plants (WebKit touchscreen.tap, Chromium)', async ({ page }) => {
    await openBase(page)
    await page.touchscreen.tap(GROUND.x, GROUND.y)
    await armRow(page)
    await page.touchscreen.tap(APPLE.x, APPLE.y)
    await expect(intervalField(page), 'the pick focuses the spacing field').toBeFocused()
    await intervalField(page).fill('2')
    await page.keyboard.press('Enter')
    for (const at of [P1, P2]) {
      // Apart in time, so the taps are not a double tap.
      await page.waitForTimeout(600)
      await page.touchscreen.tap(at.x, at.y)
    }
    await expect.poll(() => pointCount(page), 'the tapped points are shown').toBe(3)
    for (const point of await handles(page, 'point')) {
      expect([Math.round(point.width), Math.round(point.height)], `${point.id} is a 44 px target after a tap`).toEqual([44, 44])
    }
    const finish = card(page).locator('[data-plant-row-finish]')
    const box = await finish.boundingBox()
    expect(box && Math.min(box.width, box.height), 'the check button is a 44 px target').toBeGreaterThanOrEqual(44)
    await finish.tap()
    await expect(selectionChip(page), 'the check button plants the row').toHaveText(/^\d+ plants · Apple/)
    await expect(undo(page), 'one Design edit').toBeEnabled()
    await undo(page).tap()
    await expect(undo(page), 'one Undo restores the Design').toBeDisabled()
  })

  test.describe('fingers', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'finger drags go through CDP touch input, Chromium-only')

    test.fail('(canopi-f47t.54, P) touch: a finger drags a point before planting (Chromium)', async ({ page }) => {
      await openBase(page)
      const fingers = await Fingers.of(page)
      await fingers.tap(GROUND)
      await armRow(page)
      await fingers.tap(APPLE)
      await expect(intervalField(page), 'the pick focuses the spacing field').toBeFocused()
      await intervalField(page).fill('2')
      await page.keyboard.press('Enter')
      for (const at of [P1, P2]) {
        await page.waitForTimeout(600)
        await fingers.tap(at)
      }
      await expect.poll(() => pointCount(page), 'the tapped points are shown').toBe(3)
      const first = await pointAt(page, 1)
      await fingers.drag(first, { x: first.x + 40, y: first.y + 20 })
      await expect.poll(async () => {
        const moved = await pointAt(page, 1)
        return Math.round(distance(moved, { x: first.x + 40, y: first.y + 20 }))
      }, 'the point follows the finger').toBeLessThanOrEqual(2)
      await expect(undo(page), 'moving a point plants nothing').toBeDisabled()
    })
  })
})
