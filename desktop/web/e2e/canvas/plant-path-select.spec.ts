// Editing a planted row under Select (canopi-f47t.54, stream S; plan section 4 "2.0 plant along a path", amendment A2,
// A7, A11, A16): a row is selected by the selection chip's "Select row" on one of its plants or by selecting all of its
// plants; Select then shows its points and dots, and each edit (a point drag, a dot drag or double-click, Alt+click, the
// chip's spacing and mode) re-spaces its plants at the release in one Undo step without touching the device spacing;
// the point menu offers Delete point and Sharp or Smooth corner while drawing and under Select; moving all of a row's
// plants keeps the row, moving one takes it out; a locked member hides the points and disables the chip's field. Both
// engines unless a test says otherwise; the long press is Chromium-only (CDP touch). DOM assertions only, no baselines.
//
// e2e/fixtures/plant-path.canopi (one open hazel row: four points, the second sharp, every 3.5 m, six members), opened
// and then reopened from its Web Draft as design-reveal.spec.ts does, at 1024x768 with grid snapping off: its opening
// camera puts the rectangle zone's north-west corner at (312, 223) and draws 10.414 px per metre. The DOM contract these
// tests read (stream S builds it): the row's points and dots are canvas handles `point:<owner>:<index>` and
// `dot:<owner>:<index>`; the selection chip carries "Select row", the spacing field `[data-plant-row-spacing-input]`
// and the mode switch `[data-plant-row-mode="interval" | "count"]`.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expectCanvasDrawn, pressMod } from '../support/canvas'
import { Fingers, type Point } from '../support/fingers'
import { expectHitAtCentre, mapHost, openFixture } from '../support/layout'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/plant-path.canopi', import.meta.url))

/** The row's six hazels on screen, in path order. */
const MEMBERS: readonly Point[] = [
  { x: 507.8, y: 383.4 },
  { x: 533.5, y: 357.7 },
  { x: 559.3, y: 331.8 },
  { x: 587.8, y: 353.6 },
  { x: 616.6, y: 370.1 },
  { x: 647.9, y: 351.4 },
]
const HAZEL = 'European hazelnut'
/** The Apple in the rectangle zone, a plant of no row. */
const APPLE: Point = { x: 353.7, y: 264.7 }
/** Empty ground for a new row's points, and away from everything. */
const ROW_P1: Point = { x: 430, y: 345 }
const ROW_P2: Point = { x: 450, y: 280 }
const GROUND: Point = { x: 560, y: 590 }
/** A drag of the last segment's dot, away from the row, that lengthens it by one more plant. */
const DOT_DRAG_ADDING_ONE: Point = { x: 0, y: 30 }

test.use({ viewport: { width: 1024, height: 768 } })

async function openRowFromDraft(page: Page): Promise<void> {
  await openFixture(page, FIXTURE, { keepOnReload: true, settings: { snap_to_grid: false } })
  await page.reload()
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
  await expectCanvasDrawn(page)
}

function undo(page: Page): Locator {
  return page.getByRole('button', { name: 'Undo', exact: true })
}

function chip(page: Page): Locator {
  return page.getByRole('group', { name: 'Selection' })
}

function chipText(page: Page): Locator {
  return chip(page).getByRole('status')
}

function selectRow(page: Page): Locator {
  return chip(page).getByRole('button', { name: 'Select row' })
}

/** The plant count the selection chip leads with ("6 plants · European hazelnut"); 1 for a lone plant's name. */
async function selectedPlants(page: Page): Promise<number> {
  const text = ((await chipText(page).textContent()) ?? '').trim()
  const match = /^(\d+)/.exec(text)
  return match ? Number(match[1]) : 1
}

interface Handle { readonly id: string, readonly glyph: string, readonly index: number, readonly x: number, readonly y: number }

async function handles(page: Page, role: 'point' | 'dot'): Promise<Handle[]> {
  const all = await page.locator(`[data-canvas-handle^="${role}:"]`).evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect()
    return {
      id: element.getAttribute('data-canvas-handle') ?? '',
      glyph: element.getAttribute('data-canvas-handle-glyph') ?? '',
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    }
  }))
  return all.map((handle) => ({ ...handle, index: Number(handle.id.split(':').at(-1)) })).sort((a, b) => a.index - b.index)
}

async function points(page: Page): Promise<number> {
  return (await handles(page, 'point')).length
}

async function pointAt(page: Page, index: number): Promise<Handle> {
  const point = (await handles(page, 'point')).find((handle) => handle.index === index)
  if (!point) throw new Error(`no point ${index} is shown`)
  return point
}

/** Selects the row by clicking every one of its plants, the first plainly and the others with Shift. */
async function selectAllMembers(page: Page, members: readonly Point[] = MEMBERS): Promise<void> {
  await page.mouse.click(members[0]!.x, members[0]!.y)
  await page.keyboard.down('Shift')
  for (const member of members.slice(1)) await page.mouse.click(member.x, member.y)
  await page.keyboard.up('Shift')
  await expect(chipText(page), 'the row\'s plants are selected').toHaveText(new RegExp(`^${members.length} plants · ${HAZEL}`))
}

async function drag(page: Page, from: Point, to: Point, beforeRelease?: () => Promise<void>): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10)
  }
  await beforeRelease?.()
  await page.mouse.up()
}

/** Undo is on; one Undo turns it off and brings the six-plant row back, still selected. */
async function expectOneUndoStep(page: Page, what: string): Promise<void> {
  await expect(undo(page), `${what}: one Design edit`).toBeEnabled()
  await undo(page).click()
  await expect(undo(page), `${what}: one Undo restores the Design`).toBeDisabled()
  await expect(chipText(page), `${what}: the restored row stays selected`).toHaveText(new RegExp(`^6 plants · ${HAZEL}`))
}

function menuEntries(page: Page): Locator {
  return page.getByRole('menu').getByRole('menuitem')
}

async function expectMenu(page: Page, names: readonly RegExp[], how: string): Promise<void> {
  await expect(menuEntries(page), how).toHaveCount(names.length)
  for (const [index, name] of names.entries()) await expect(menuEntries(page).nth(index), how).toHaveAccessibleName(name)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
}

/** The device's Plant a row interval, as the tool card's field shows it after a pick. */
async function deviceInterval(page: Page): Promise<string> {
  await mapHost(page).focus()
  await page.keyboard.press('w')
  await page.mouse.click(APPLE.x, APPLE.y)
  const field = page.locator('[data-tool-card] [data-plant-spacing-interval-input]')
  await expect(field).toBeFocused()
  const value = await field.inputValue()
  await page.keyboard.press('Escape')
  await mapHost(page).focus()
  await page.keyboard.press('v')
  await expect(page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: /^Select( \(.\))?$/ })).toHaveAttribute('aria-pressed', 'true')
  return value
}

interface SavedRowDesign {
  readonly plants: ReadonlyArray<{ readonly id: string }>
  readonly plant_rows?: ReadonlyArray<{ readonly members: ReadonlyArray<{ readonly plant_id: string }> }>
}

/** The Design as File > Download a copy saves it. */
async function savedDesign(page: Page): Promise<SavedRowDesign> {
  await page.getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'File' }).click()
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /^Download a copy/ }).click(),
  ])
  return JSON.parse(await readFile(await file.path(), 'utf8')) as SavedRowDesign
}

/** The row's member ids and every plant id, in order. */
function rowIds(design: SavedRowDesign): { readonly members: readonly string[], readonly plants: readonly string[] } {
  return { members: design.plant_rows?.[0]?.members.map((member) => member.plant_id) ?? [], plants: design.plants.map((plant) => plant.id) }
}

// Stream S's probe (amendment section (d)): a Scene Edit that replaces some of the row's plants keeps the row selected and
// rebuilds its handles, and after a tap on Select row the 44 px handles are hit at their centre.
test.describe('touch', () => {
  test.use({ hasTouch: true })

  test('(canopi-f47t.54, S) probe: a tap on Select row selects the row with 44 px points hit at their centre; a dot drag that adds a plant keeps the row selected, and one Undo restores its six plants with their ids', async ({ page }) => {
    await openRowFromDraft(page)
    const fixture = rowIds(JSON.parse(await readFile(FIXTURE, 'utf8')) as SavedRowDesign)
    await page.touchscreen.tap(MEMBERS[2]!.x, MEMBERS[2]!.y)
    await expect(chipText(page)).toHaveText(new RegExp(`^${HAZEL}`))
    const button = await selectRow(page).boundingBox()
    await page.touchscreen.tap(button!.x + button!.width / 2, button!.y + button!.height / 2)
    await expect(chipText(page), 'Select row selects the six plants').toHaveText(new RegExp(`^6 plants · ${HAZEL}`))
    await expect.poll(() => points(page), 'the row\'s four points are shown').toBe(4)
    for (const point of await page.locator('[data-canvas-handle^="point:"]').all()) {
      const box = await point.boundingBox()
      expect(box!.width, 'a point is a 44 px target after a tap').toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
      await expectHitAtCentre(point, `row point ${await point.getAttribute('data-canvas-handle')}`)
    }

    // A finger's 44 px points leave no room for the dots; the mouse's smaller ones do.
    await page.mouse.move(GROUND.x, GROUND.y)
    await expect.poll(async () => (await handles(page, 'dot')).length, 'the mouse shows a dot on each segment').toBe(3)
    const dot = (await handles(page, 'dot')).at(-1)!
    await drag(page, dot, { x: dot.x + DOT_DRAG_ADDING_ONE.x, y: dot.y + DOT_DRAG_ADDING_ONE.y })
    await expect(chipText(page), 'the row is still selected, with one plant more').toHaveText(new RegExp(`^7 plants · ${HAZEL}`))
    await expect.poll(() => points(page), 'with its new point').toBe(5)
    await expectOneUndoStep(page, 'the dot drag')
    expect(rowIds(await savedDesign(page)), 'one Undo restores the six plants with their ids').toEqual(fixture)
  })
})

test('(canopi-f47t.54, S) Select row on a row plant shows the row\'s curve, points and dots', async ({ page }) => {
  await openRowFromDraft(page)
  await page.mouse.click(MEMBERS[2]!.x, MEMBERS[2]!.y)
  await expect(chipText(page)).toHaveText(new RegExp(`^${HAZEL}`))
  await expect(selectRow(page), 'a row plant offers Select row').toBeVisible()
  await selectRow(page).click()
  await expect(chipText(page), 'Select row selects its six plants').toHaveText(new RegExp(`^6 plants · ${HAZEL}`))
  await expect.poll(() => points(page), 'the row\'s four points are shown').toBe(4)
  await expect.poll(async () => (await handles(page, 'dot')).length, 'and a dot on each of its three segments').toBe(3)
  expect((await pointAt(page, 1)).glyph, 'the stored sharp point is drawn sharp').toBe('corner')
  await expect(selectRow(page), 'a selected row offers no Select row').toHaveCount(0)
})

test('(canopi-f47t.54, S) under Select, dragging a point re-spaces the row at release in one Undo step', async ({ page }) => {
  await openRowFromDraft(page)
  await selectAllMembers(page)
  await expect.poll(() => points(page), 'selecting all of a row\'s plants shows its points').toBe(4)
  const last = await pointAt(page, 3)
  await drag(page, last, { x: last.x + 45, y: last.y }, async () => {
    await expect(undo(page), 'nothing reaches the Design before the release').toBeDisabled()
  })
  await expect.poll(() => selectedPlants(page), 'the longer row is re-spaced with more plants').toBeGreaterThan(6)
  await expect.poll(async () => Math.round((await pointAt(page, 3)).x - last.x), 'the point stays where it was released').toBe(45)
  await expectOneUndoStep(page, 'the moved point')
})

test('(canopi-f47t.54, S) under Select, a dot drag inserts a point, Alt+click deletes one and a double-click on a dot inserts in place, each one Undo step', async ({ page }) => {
  await openRowFromDraft(page)
  await selectAllMembers(page)
  await expect.poll(() => points(page), 'selecting all of a row\'s plants shows its points').toBe(4)

  const [dot] = await handles(page, 'dot')
  await drag(page, dot!, { x: dot!.x - 15, y: dot!.y + 25 })
  await expect.poll(() => points(page), 'a dot drag inserts a point').toBe(5)
  await expectOneUndoStep(page, 'the dot drag')
  await expect.poll(() => points(page)).toBe(4)

  const third = await pointAt(page, 2)
  await page.keyboard.down('Alt')
  await page.mouse.click(third.x, third.y)
  await page.keyboard.up('Alt')
  await expect.poll(() => points(page), 'Alt+click deletes a point').toBe(3)
  await expectOneUndoStep(page, 'the deleted point')
  await expect.poll(() => points(page)).toBe(4)

  const lastDot = (await handles(page, 'dot')).at(-1)!
  await page.mouse.dblclick(lastDot.x, lastDot.y)
  await expect.poll(() => points(page), 'a double-click on a dot inserts a point in place').toBe(5)
  await expectOneUndoStep(page, 'the inserted point')
})

test.fail('(canopi-f47t.54, S) right-click and long press on a row point open Delete point and Sharp corner, while drawing and under Select (long press Chromium)', async ({ page, browserName }) => {
  await openRowFromDraft(page)
  await selectAllMembers(page)
  await expect.poll(() => points(page), 'selecting all of a row\'s plants shows its points').toBe(4)
  const sharp = await pointAt(page, 1)
  await page.mouse.click(sharp.x, sharp.y, { button: 'right' })
  await expectMenu(page, [/^Delete point/, /^Smooth corner/], 'a right-click on a sharp row point')
  const smooth = await pointAt(page, 2)
  await page.mouse.click(smooth.x, smooth.y, { button: 'right' })
  await expectMenu(page, [/^Delete point/, /^Sharp corner/], 'a right-click on a smooth row point')

  if (browserName === 'chromium') {
    const fingers = await Fingers.of(page)
    await fingers.tap(smooth, { holdMs: 600 })
    await expectMenu(page, [/^Delete point/, /^Sharp corner/], 'a long press on a row point')
  }
  await expect(undo(page), 'opening the menus edits nothing').toBeDisabled()

  await page.mouse.click(GROUND.x, GROUND.y)
  await mapHost(page).focus()
  await page.keyboard.press('w')
  await page.mouse.click(APPLE.x, APPLE.y)
  await page.keyboard.press('Enter')
  await page.mouse.click(ROW_P1.x, ROW_P1.y)
  await page.mouse.click(ROW_P2.x, ROW_P2.y)
  const drawn = await pointAt(page, 1)
  await page.mouse.click(drawn.x, drawn.y, { button: 'right' })
  await expectMenu(page, [/^Finish shape/, /^Delete point/, /^Sharp corner/], 'a right-click on a point while drawing')
  await expect(undo(page), 'drawing plants nothing').toBeDisabled()
})

test.fail('(canopi-f47t.54, S) the selection chip\'s spacing field and mode re-space the row in one Undo step and leave the device interval unchanged', async ({ page }) => {
  await openRowFromDraft(page)
  const before = await deviceInterval(page)

  await page.mouse.click(MEMBERS[2]!.x, MEMBERS[2]!.y)
  await expect(selectRow(page), 'a row plant offers Select row').toBeVisible()
  await selectRow(page).click()
  const spacing = chip(page).locator('[data-plant-row-spacing-input]')
  await expect(spacing, 'a selected row shows its spacing').toBeVisible()
  await spacing.fill('2.5')
  await spacing.press('Enter')
  await expect.poll(() => selectedPlants(page), 'a closer spacing re-spaces the row with more plants').toBeGreaterThan(6)
  await expectOneUndoStep(page, 'the new spacing')

  await chip(page).locator('[data-plant-row-mode="count"]').click()
  const count = chip(page).locator('[data-plant-row-count-input]')
  await count.fill('4')
  await count.press('Enter')
  await expect(chipText(page), 'four plants evenly').toHaveText(new RegExp(`^4 plants · ${HAZEL}`))
  await expectOneUndoStep(page, 'the count')

  await page.mouse.click(GROUND.x, GROUND.y)
  expect(await deviceInterval(page), 'the row\'s spacing never writes the device interval').toBe(before)
})

test('(canopi-f47t.54, S) moving all of a row\'s plants keeps it a row; moving one plant leaves the rest a row without it', async ({ page }) => {
  await openRowFromDraft(page)
  await selectAllMembers(page)
  await expect.poll(() => points(page), 'selecting all of a row\'s plants shows its points').toBe(4)
  // Arrow-key nudges move the selection through the same path as a move drag (A11), without pressing on a handle.
  await mapHost(page).focus()
  await page.keyboard.press('ArrowDown')
  await expect(undo(page), 'the nudge is one Design edit').toBeEnabled()
  await expect.poll(() => points(page), 'the moved plants are still a row').toBe(4)
  await expect(chipText(page)).toHaveText(new RegExp(`^6 plants · ${HAZEL}`))

  await page.mouse.click(GROUND.x, GROUND.y)
  await expect(chip(page)).toBeHidden()
  await page.mouse.click(MEMBERS[5]!.x, MEMBERS[5]!.y)
  await expect(chipText(page)).toHaveText(new RegExp(`^${HAZEL}`))
  await page.keyboard.press('ArrowRight')
  await page.mouse.click(GROUND.x, GROUND.y)
  await page.mouse.click(MEMBERS[2]!.x, MEMBERS[2]!.y)
  await selectRow(page).click()
  await expect(chipText(page), 'the row keeps the five plants that stayed').toHaveText(new RegExp(`^5 plants · ${HAZEL}`))
  await page.mouse.click(GROUND.x, GROUND.y)
  await page.mouse.click(MEMBERS[5]!.x, MEMBERS[5]!.y)
  await expect(chipText(page)).toHaveText(new RegExp(`^${HAZEL}`))
  await expect(selectRow(page), 'the moved plant left the row').toHaveCount(0)
})

test.fail('(canopi-f47t.54, S) a row with a locked plant shows its curve but no points and a disabled spacing field', async ({ page }) => {
  await openRowFromDraft(page)
  await page.mouse.click(MEMBERS[5]!.x, MEMBERS[5]!.y)
  await expect(chipText(page)).toHaveText(new RegExp(`^${HAZEL}`))
  await pressMod(page, 'Shift+l')
  await page.mouse.click(MEMBERS[2]!.x, MEMBERS[2]!.y)
  await expect(selectRow(page), 'a row plant offers Select row').toBeVisible()
  await selectRow(page).click()
  await expect(chipText(page)).toHaveText(new RegExp(`^6 plants · ${HAZEL}`))
  await expect(chip(page).locator('[data-plant-row-spacing-input]'), 'the locked row\'s spacing is shown, disabled').toBeDisabled()
  await expect(chip(page).locator('[data-plant-row-mode="count"]'), 'and its mode switch').toBeDisabled()
  expect(await points(page), 'a locked row shows no points').toBe(0)
  expect((await handles(page, 'dot')).length, 'nor dots').toBe(0)
})
