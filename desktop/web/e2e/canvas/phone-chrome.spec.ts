// The phone chrome (canopi-f47t.54; plan section 4 "2.0 plant along a path", answers 17, 18 and 22-26). The guard: at
// 390x844, 360x560, 740x360 and 844x390, in en and de, nothing but the zoom column floats over the map and every control
// in the context bar takes the tap at its centre, idle, with the labels chip, with a row held at peek, half and full,
// and with the planted row selected. The context bar is the panel sheet's first row: it moves with peek, half, full and
// a finger drag, the sheet's registration covers it, and it holds the map notice on top of one context (Plant a row's
// card, the selection, the labels chip). The inspection launcher is a button of the zoom column, which hides where the
// visible map has no room for it. When a drawing tool starts a draft the panel sheet drops to its peek. After a tap, a
// mouse-typed boundary event keeps the touch handles 44 px (canopi-94o3). Both engines, touch, offline (so the map
// notice shows) unless the basemap is hidden. DOM assertions only, no baselines.
//
// The base fixture at 390x844 with the basemap hidden: its opening camera puts the Apple inside the rectangle zone at
// (114, 349) (touch.spec.ts).
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { pressMod } from '../support/canvas'
import { Fingers, type Point } from '../support/fingers'
import { boxOf, chipFrame, expectHitAtCentre, mapHost, nextFrames, openFixture, overlap, type Box } from '../support/layout'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))
/** The fixture's Apple inside the rectangle zone, at the opening camera on a 390x844 screen. */
const APPLE: Point = { x: 114, y: 349 }
/** Empty ground straight above the Apple, below the tool rail's end, and beside that. */
const ABOVE: Point = { x: 114, y: 240 }
const BESIDE: Point = { x: 220, y: 240 }

interface Edges { readonly top: number, readonly right: number, readonly bottom: number, readonly left: number }

function card(page: Page): Locator {
  return page.locator('[data-tool-card]')
}

async function tap(page: Page, at: Point): Promise<void> {
  await page.touchscreen.tap(at.x, at.y)
  // Apart in time, so two taps never make a double tap.
  await page.waitForTimeout(600)
}

/** The visible map frame the camera fits into (`--map-framing-inset-*` on the map area), as edges in page pixels. */
async function framingEdges(page: Page): Promise<Edges & { readonly area: Edges }> {
  return await page.evaluate(() => {
    const area = document.querySelector<HTMLElement>('[style*="--map-framing-inset-bottom"]')
    if (!area) throw new Error('no map area publishes its framing insets')
    const box = area.getBoundingClientRect()
    const inset = (edge: string) => parseFloat(area.style.getPropertyValue(`--map-framing-inset-${edge}`))
    return {
      top: box.top + inset('top'),
      right: box.right - inset('right'),
      bottom: box.bottom - inset('bottom'),
      left: box.left + inset('left'),
      area: { top: box.top, right: box.right, bottom: box.bottom, left: box.left },
    }
  })
}

/** Raises the panel sheet a step from its handle (ArrowUp: a tap on it moved nothing in WebKit's touch emulation). */
async function raiseSheet(page: Page): Promise<void> {
  await page.locator('[data-sheet-handle]').focus()
  await page.keyboard.press('ArrowUp')
  await expect(sheet(page), 'the panel sheet rests at half height').toHaveAttribute('data-phone-sheet', 'half')
}

function sheet(page: Page): Locator {
  return page.locator('[data-phone-sheet]')
}

function tool(page: Page, name: string): Locator {
  return page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: new RegExp(`^${name}( \\(.\\))?$`) })
}

/** The armed tool's options in the panel sheet (answer 30). */
function toolOptions(page: Page): Locator {
  return page.locator('[data-sheet-panel="options"]')
}

// Answer 17: on a phone, while a drawing tool holds a draft (Plant a row, Polygon, Profile line), the panel sheet drops to
// its peek, so the draft is drawn on the map rather than under the sheet; arming a tool alone keeps the sheet, and a
// sheet raised again during the draft stays where the user puts it.
test.describe('390×844 drafts and the sheet', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('(canopi-f47t.54, H) the half sheet drops to its peek when Plant a row picks its plant, and stays raised when raised again', async ({ page }) => {
    await openFixture(page, FIXTURE, { basemapHidden: true, settings: { snap_to_grid: false } })
    await raiseSheet(page)
    await mapHost(page).focus()
    await page.keyboard.press('w')
    await expect(card(page)).toHaveAttribute('data-tool-card', 'plant-spacing')
    await expect(sheet(page), 'arming the tool keeps the sheet').toHaveAttribute('data-phone-sheet', 'half')
    await tap(page, APPLE)
    await expect(card(page).locator('[data-tool-card-lead="species"]'), 'the tap picks the Apple').toBeVisible()
    await expect(sheet(page), 'the pick drops the sheet to its peek').toHaveAttribute('data-phone-sheet', 'peek')
    await tap(page, ABOVE)
    await raiseSheet(page)
    await nextFrames(page)
    await expect(sheet(page), 'raised again during the draft, the sheet stays').toHaveAttribute('data-phone-sheet', 'half')
  })

  test('(canopi-f47t.54, H) the half sheet drops to its peek at a polygon\'s first corner', async ({ page }) => {
    await openFixture(page, FIXTURE, { basemapHidden: true, settings: { snap_to_grid: false } })
    await raiseSheet(page)
    await tool(page, 'Polygon zone').tap()
    await expect(tool(page, 'Polygon zone')).toHaveAttribute('aria-pressed', 'true')
    await expect(sheet(page), 'arming the tool keeps the sheet').toHaveAttribute('data-phone-sheet', 'half')
    await tap(page, { x: 150, y: 280 })
    await expect(sheet(page), 'the first corner drops the sheet to its peek').toHaveAttribute('data-phone-sheet', 'peek')
  })
})

/** Every shown box matching `selector`. */
async function shownBoxes(page: Page, selector: string): Promise<Box[]> {
  const boxes = await page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const shown = style.visibility !== 'hidden' && style.display !== 'none' && Number.parseFloat(style.opacity) > 0
    return shown ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
  }))
  return boxes.filter((box): box is Box => box !== null && box.width > 0 && box.height > 0)
}

/** The shown row handles' sizes, rounded: points and dots, or points only. */
async function rowHandleSizes(page: Page, selector = '[data-canvas-handle^="point:"], [data-canvas-handle^="dot:"]'): Promise<number[]> {
  return await page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect()
    return Math.round(Math.min(box.width, box.height))
  }))
}

// canopi-94o3: after a tap, a browser sends mouse-typed boundary events as the handles re-render under the finger
// (Chromium did at 1024x768); the map's input source turned a mouse pointerleave into a move, which made the pointer a
// mouse and shrank the touch handles to 20 px. A boundary event never changes the pointer kind; a real mouse move still
// does. The leave is dispatched on the map host as the browser sends it, through the real input source.
test.describe('390×844 boundary events', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('(canopi-94o3, H) a mouse-typed pointerleave after a tap keeps the row\'s handles 44 px targets; a mouse move makes the points 20 px', async ({ page }) => {
    await openFixture(page, FIXTURE, { basemapHidden: true, settings: { snap_to_grid: false } })
    await mapHost(page).focus()
    await page.keyboard.press('w')
    await tap(page, APPLE)
    await expect(card(page).locator('[data-tool-card-lead="species"]'), 'the tap picks the Apple').toBeVisible()
    await tap(page, ABOVE)
    await tap(page, BESIDE)
    await tap(page, BESIDE)
    await expect(page.locator('[data-canvas-handle="point:draft:2"][data-canvas-handle-active]'), 'the tapped point is touched').toHaveCount(1)
    await nextFrames(page)
    const touched = await rowHandleSizes(page)
    expect(touched.length, 'the row shows its points and dots').toBeGreaterThanOrEqual(3)
    expect(touched.every((size) => size >= 44), `after a tap the handles are 44 px targets: ${touched}`).toBe(true)

    await mapHost(page).evaluate((host, at) => {
      host.dispatchEvent(new PointerEvent('pointerleave', {
        pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: at.x, clientY: at.y, relatedTarget: document.body,
      }))
    }, { x: 300, y: 420 })
    await nextFrames(page)
    const afterLeave = await rowHandleSizes(page)
    expect(afterLeave.every((size) => size >= 44), `a mouse-typed leave keeps 44 px handles: ${afterLeave}`).toBe(true)

    // Over the map, above the sheet and its context bar.
    await page.mouse.move(300, 420)
    await page.mouse.move(305, 420)
    await expect.poll(async () => (await rowHandleSizes(page, '[data-canvas-handle^="point:"]')).every((size) => size === 20), 'a mouse move makes the points 20 px').toBe(true)
  })
})

// The phone context bar (canopi-f47t.54, stream D, answers 18 and 22): the bar is the panel sheet's first row, so it
// moves with peek, half, full and a finger drag with no position formula of its own, and the sheet's one registration
// with the visible-map-area seam covers it. A fixed bar (a field and a button) is put into the sheet's bar row; the
// basemap is hidden so no map notice registers. Landscape sheets have no drag (their handle steps); WebKit has no touch
// driver, so there the drag is a mouse's (the handle takes pointer events of either kind).
const PHONES = [
  { width: 390, height: 844 },
  { width: 360, height: 560 },
  { width: 740, height: 360 },
  { width: 844, height: 390 },
] as const
/** The fixed bar's height: a tool card's two rows. */
const BAR_PX = 88

async function putFixedBar(page: Page): Promise<Locator> {
  await page.locator('[data-phone-context-bar]').evaluate((row, height) => {
    const bar = document.createElement('div')
    bar.dataset.fixedBar = ''
    bar.style.cssText = `display:flex;align-items:center;gap:8px;height:${height}px;box-sizing:border-box`
    bar.dataset.presses = '0'
    bar.addEventListener('pointerdown', () => { bar.dataset.presses = String(Number(bar.dataset.presses) + 1) })
    const field = document.createElement('input')
    field.setAttribute('aria-label', 'Fixed field')
    field.style.cssText = 'flex:1;min-width:0;height:44px'
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Fixed'
    button.style.cssText = 'flex:1;height:44px'
    bar.append(field, button)
    row.append(bar)
  }, BAR_PX)
  const bar = page.locator('[data-fixed-bar]')
  await expect(bar).toBeVisible()
  expect((await boxOf(bar)).height).toBe(BAR_PX)
  return bar
}

/** The sheet, its bar row and its dock region (the handle, the tabs and the panel), as page boxes. */
async function sheetParts(page: Page): Promise<{ sheet: Box, bar: Box, dock: Box }> {
  return await page.locator('[data-phone-sheet]').evaluate((section) => {
    const box = (element: Element | null) => {
      if (!element) throw new Error('a part of the sheet is missing')
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    return {
      sheet: box(section),
      bar: box(section.querySelector('[data-phone-context-bar]')),
      dock: box(section.querySelector('[data-key-region="dock"]')),
    }
  })
}

/** The bar is the sheet's first row: its top at the sheet's top border, its bottom at the dock region's top. */
function expectBarDocked(parts: { sheet: Box, bar: Box, dock: Box }, where: string): void {
  expect(Math.abs(parts.bar.y - parts.sheet.y), `${where}: the bar's top is at the sheet's top (${parts.bar.y} vs ${parts.sheet.y})`).toBeLessThanOrEqual(1)
  const barBottom = parts.bar.y + parts.bar.height
  expect(Math.abs(barBottom - parts.dock.y), `${where}: the bar's bottom is at the sheet's content top (${barBottom} vs ${parts.dock.y})`).toBeLessThanOrEqual(1)
}

/** The seam's insets on the map area, chips' and framing, against the sheet's cover of its edge. */
async function expectInsetsCoverSheet(page: Page, portrait: boolean, where: string): Promise<void> {
  const { sheet } = await sheetParts(page)
  const insets = await page.evaluate(() => {
    const area = document.querySelector<HTMLElement>('[style*="--map-inset-bottom"]')
    if (!area) throw new Error('no map area publishes its insets')
    const box = area.getBoundingClientRect()
    const read = (name: string) => parseFloat(area.style.getPropertyValue(name))
    return {
      area: { right: box.right, bottom: box.bottom },
      chips: { bottom: read('--map-inset-bottom'), right: read('--map-inset-right') },
      framing: { bottom: read('--map-framing-inset-bottom'), right: read('--map-framing-inset-right') },
    }
  })
  const edge = portrait ? 'bottom' : 'right'
  const cover = portrait ? insets.area.bottom - sheet.y : insets.area.right - sheet.x
  for (const kind of ['chips', 'framing'] as const) {
    expect(Math.abs(insets[kind][edge] - cover), `${where}: the ${kind} inset on the ${edge} (${insets[kind][edge]}) is the sheet's cover (${cover})`).toBeLessThanOrEqual(1)
  }
}

/**
 * The zoom column, placed from the framing frame, clears the bar; where that frame is shorter than the column (360x560
 * with the sheet at half, any full sheet) it hides instead (answer 25).
 */
async function expectZoomClearOfBar(page: Page, bar: Locator, where: string): Promise<void> {
  const barBox = await boxOf(bar)
  const frame = await framingEdges(page)
  const column = page.locator('[data-zoom-group]')
  const height = await column.evaluate((element) => (element as HTMLElement).offsetHeight)
  const shown = await shownBoxes(page, '[data-zoom-group]')
  if (height > frame.bottom - frame.top) {
    expect(shown, `${where}: the ${height} px column hides in a ${frame.bottom - frame.top} px frame`).toEqual([])
    return
  }
  expect(shown.length, `${where}: the column shows in a ${frame.bottom - frame.top} px frame`).toBe(1)
  expect(overlap(shown[0]!, barBox), `${where}: the zoom column clears the bar`).toBe(false)
}

async function expectBarTakesTap(page: Page, bar: Locator, where: string): Promise<void> {
  await expectHitAtCentre(bar, `${where}: the bar`)
  const box = await boxOf(bar)
  const before = Number(await bar.getAttribute('data-presses'))
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  await expect(bar, `${where}: a tap at the bar's centre lands on the bar`).toHaveAttribute('data-presses', String(before + 1))
}

/** Every animation frame while `act` runs, the bar's place in the sheet; returns the frames sampled. */
async function sampleDuringDrag(page: Page, act: () => Promise<void>): Promise<{ sheet: Box, bar: Box, dock: Box }[]> {
  await page.evaluate(() => {
    const samples: unknown[] = []
    ;(window as unknown as { barSamples: unknown[] }).barSamples = samples
    const section = document.querySelector('[data-phone-sheet]')!
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    const sample = () => {
      if (!(window as unknown as { barSamples?: unknown[] }).barSamples) return
      samples.push({
        sheet: box(section),
        bar: box(section.querySelector('[data-phone-context-bar]')!),
        dock: box(section.querySelector('[data-key-region="dock"]')!),
      })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await act()
  return await page.evaluate(() => {
    const holder = window as unknown as { barSamples?: { sheet: Box, bar: Box, dock: Box }[] }
    const samples = holder.barSamples ?? []
    delete holder.barSamples
    return samples
  })
}

for (const phone of PHONES) {
  const size = `${phone.width}×${phone.height}`
  const portrait = phone.height > phone.width
  test.describe(`${size} context bar`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height }, hasTouch: true })

    test(`(canopi-f47t.54, D) a bar in the sheet's first row moves with peek, half and full, is covered by the sheet's registration, clears the zoom column and takes taps (${size})`, async ({ page }) => {
      await openFixture(page, FIXTURE, { basemapHidden: true, openWith: portrait ? 'button' : 'shortcut' })
      const bar = await putFixedBar(page)
      for (const height of ['peek', 'half', 'full'] as const) {
        if (height !== 'peek') {
          await page.locator('[data-sheet-handle]').focus()
          await page.keyboard.press('ArrowUp')
        }
        await expect(sheet(page)).toHaveAttribute('data-phone-sheet', height)
        await nextFrames(page)
        await nextFrames(page)
        const where = `${size} ${height}`
        expectBarDocked(await sheetParts(page), where)
        await expectInsetsCoverSheet(page, portrait, where)
        await expectZoomClearOfBar(page, bar, where)
        await expectBarTakesTap(page, bar, where)
      }
    })

    test(`(canopi-f47t.54, D) a key from a control in the bar is not the dock's: Select all from the bar selects on the map, from a sheet tab it does not (${size})`, async ({ page }) => {
      await openFixture(page, FIXTURE, { basemapHidden: true, openWith: portrait ? 'button' : 'shortcut' })
      const bar = await putFixedBar(page)
      expect(await bar.evaluate((element) => element.closest('[data-key-region="dock"]') === null), 'the bar is outside the dock key region').toBe(true)
      await page.locator('[data-sheet-tab]').first().focus()
      await pressMod(page, 'a')
      await nextFrames(page)
      await expect(page.locator('[data-selection-chip]'), 'from a sheet tab, Select all is left to the page').toHaveCount(0)
      await bar.getByRole('button', { name: 'Fixed' }).focus()
      await pressMod(page, 'a')
      await expect(page.locator('[data-selection-chip]'), 'from a button in the bar, Select all selects on the map').toHaveCount(1)
    })

    if (portrait) {
      test(`(canopi-f47t.54, D) during a drag of the handle the bar stays the sheet's first row on every frame, and the drag's peek stop keeps the bar (${size})`, async ({ page, browserName }) => {
        await openFixture(page, FIXTURE, { basemapHidden: true })
        await putFixedBar(page)
        const peek = await sheetParts(page)
        const handle = await boxOf(page.locator('[data-sheet-handle]'))
        const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
        const up = { x: from.x, y: from.y - phone.height * 0.4 }
        const down = { x: from.x, y: phone.height - 2 }
        const drag = async (path: readonly Point[]) => {
          if (browserName === 'chromium') {
            const fingers = await Fingers.of(page)
            await fingers.start(0, from)
            for (const at of path) {
              await fingers.move({ 0: at })
              await nextFrames(page)
            }
            await fingers.end(0)
          } else {
            await page.mouse.move(from.x, from.y)
            await page.mouse.down()
            for (const at of path) {
              await page.mouse.move(at.x, at.y)
              await nextFrames(page)
            }
            await page.mouse.up()
          }
        }
        const steps = (start: Point, to: Point, count: number) => Array.from({ length: count }, (_, step) => ({
          x: start.x + (to.x - start.x) * ((step + 1) / count),
          y: start.y + (to.y - start.y) * ((step + 1) / count),
        }))
        // Up 40 % of the screen, then down to the bottom edge, in one press: the drag clamps at its peek stop.
        const samples = await sampleDuringDrag(page, () => drag([...steps(from, up, 12), ...steps(up, down, 16)]))
        expect(samples.length, 'frames were sampled during the drag').toBeGreaterThan(10)
        const dragged = samples.filter((parts) => Math.abs(parts.sheet.height - peek.sheet.height) > 4)
        expect(dragged.length, 'the sheet followed the finger').toBeGreaterThan(3)
        samples.forEach((parts, index) => expectBarDocked(parts, `${size} drag frame ${index}`))
        const lowest = Math.min(...samples.map((parts) => parts.sheet.height))
        expect(lowest, `the drag's peek stop keeps the bar and the tabs (${lowest} vs the peek's ${peek.sheet.height})`).toBeGreaterThanOrEqual(peek.sheet.height - 1)
      })
    }
  })
}

/** The middle of the visible map the seam leaves (`--map-inset-*`), less a shift left, as a tap spot. */
async function mapSpot(page: Page, left = 0): Promise<Point> {
  const frame = await chipFrame(page)
  return { x: Math.round((frame.left + frame.right) / 2 - left), y: Math.round((frame.top + frame.bottom) / 2) }
}

/**
 * Places an Apple in the middle of the visible map from Place plants' species list (the tool's options, which close once
 * it is chosen), then holds a Plant a row draft from it with two more points left of it, each in the middle of the map.
 */
async function holdRowInBar(page: Page): Promise<void> {
  await mapHost(page).focus()
  await page.keyboard.press('p')
  // With no species chosen, arming Place plants opens its chooser.
  const apple = toolOptions(page).getByRole('button', { name: /Malus domestica/ }).first()
  await expect(apple, 'Place plants opens its chooser').toBeVisible()
  await apple.scrollIntoViewIfNeeded()
  await apple.click()
  await expect(toolOptions(page), 'choosing a species closes the options').toHaveCount(0)
  await nextFrames(page)
  const spot = await mapSpot(page)
  await tap(page, spot)
  // Esc leaves Place plants, the next clears the placed Apple's selection.
  await mapHost(page).focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('w')
  await tap(page, spot)
  await expect(card(page).locator('[data-tool-card-lead="species"]'), 'the tap picks the Apple').toBeVisible()
  await nextFrames(page)
  await tap(page, await mapSpot(page, 50))
  await nextFrames(page)
  await tap(page, await mapSpot(page, 100))
  await expect(card(page).locator('[data-plant-row-finish]'), 'the row holds three points').toBeVisible()
}

// The tool's options (answer 30): on a phone a row's spacing field is the panel sheet's, in its dock key region, not a
// card over the map. Its keys reach the row as the card's field did on the desktop (Enter keeps a valid spacing and
// gives the map its focus, or keeps the field on an invalid one; Esc removes the last point and gives the map its
// focus, the tool kept; Backspace edits the text), and the draft outlives the sheet resting at its peek and raised
// again.
test.describe('390×844 row options in the sheet', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('(canopi-f47t.54, D4 probe) the spacing field in the sheet takes Enter, Esc and Backspace as on the desktop, and the draft outlives peek and half', async ({ page }) => {
    await openFixture(page, FIXTURE, { basemapHidden: true, settings: { snap_to_grid: false } })
    await holdRowInBar(page)
    const options = page.locator('[data-sheet-panel="options"]')
    const field = options.locator('[data-plant-spacing-interval-input]')
    const lastPoint = page.locator('[data-canvas-handle="point:draft:2"]')
    const openOptions = async () => {
      await page.locator('[data-tool-options-button]').tap()
      await expect(sheet(page), 'Options raises the sheet to half').toHaveAttribute('data-phone-sheet', 'half')
      await expect(field, 'the spacing field is the options\'').toBeVisible()
    }
    await openOptions()
    expect(await field.evaluate((element) => element.closest('[data-key-region="dock"]') !== null
      && element.closest('[data-phone-context-bar]') === null), 'the field is in the dock key region, not the bar').toBe(true)
    await expect(page.locator('[data-plant-spacing-interval-input]'), 'one spacing field').toHaveCount(1)
    await expect(lastPoint, 'the row holds three points').toHaveCount(1)

    // Backspace edits the text and leaves the points.
    await field.focus()
    const typed = await field.inputValue()
    await page.keyboard.press('End')
    await page.keyboard.press('Backspace')
    await expect(field, 'Backspace removes the last character').toHaveValue(typed.slice(0, -1))
    await expect(lastPoint, 'Backspace in the field keeps the points').toHaveCount(1)

    // Enter on an invalid spacing keeps the field; on a valid one the map takes the focus, the row still held.
    await field.fill('0')
    await page.keyboard.press('Enter')
    await expect(field, 'Enter on an invalid spacing keeps the field focused').toBeFocused()
    await expect(card(page).locator('[data-plant-row-finish]'), 'nothing is planted').toBeVisible()
    await field.fill('2')
    await page.keyboard.press('Enter')
    await expect(mapHost(page), 'Enter on a valid spacing gives the map its focus').toBeFocused()
    await expect(lastPoint, 'Enter in the field plants nothing').toHaveCount(1)

    // Esc removes the last point and gives the map its focus; the tool stays.
    await field.focus()
    await page.keyboard.press('Escape')
    await expect(lastPoint, 'Esc in the field removes the last point').toHaveCount(0)
    await expect(mapHost(page), 'Esc in the field gives the map its focus').toBeFocused()
    await expect(card(page), 'Esc in the field keeps the tool').toHaveAttribute('data-tool-card', 'plant-spacing')

    // The sheet rests at its peek, then the options raise it again: the draft and its spacing are kept.
    await page.locator('[data-sheet-handle]').focus()
    await page.keyboard.press('Home')
    await expect(sheet(page)).toHaveAttribute('data-phone-sheet', 'peek')
    await expect(options, 'at the peek the options close').toHaveCount(0)
    await expect(card(page).locator('[data-plant-row-finish]'), 'at the peek the row is still held').toBeVisible()
    await openOptions()
    await expect(field, 'the spacing is kept').toHaveValue('2 m')
    await expect(page.locator('[data-canvas-handle="point:draft:1"]'), 'the row keeps its points').toHaveCount(1)
    await expect(card(page).locator('[data-plant-row-finish]'), 'the row is still held').toBeVisible()
  })
})

// On a phone an armed tool is one touch row of the context bar (answer 30): its name, a short status, Plant a row's check
// button and Options, so the bar is one touch row (with the map notice's row on top, offline) for every tool, a held row
// and the selection, held upright or on its side, in en and de; it never scrolls or runs past its box, and its controls
// are 44 px targets that take the tap. On the small phones the zoom column stands beside the sheet at its peek whatever
// tool is armed.
const BAR_SIZES = [...PHONES, { width: 375, height: 667 }] as const
/** Place plants, Plant a row, Place a stamp, Polygon, Rectangle, Ellipse, Line, Note and Measure. */
const TOOL_KEYS = ['p', 'w', 'k', 'z', 'r', 'e', 'l', 't', 'm'] as const

async function expectOneTouchRow(page: Page, where: string): Promise<void> {
  await nextFrames(page)
  const bar = page.locator('[data-phone-context-bar]')
  const notice = bar.locator(':scope > [data-map-notice]')
  const noticeHeight = await notice.count() > 0 && await notice.isVisible() ? (await boxOf(notice)).height : 0
  const height = (await boxOf(bar)).height - noticeHeight
  expect(height, `${where}: the bar is one touch row and its rule under the notice's row (${height} px)`).toBeGreaterThanOrEqual(44 - 0.5)
  expect(height, `${where}: the bar is one touch row and its rule under the notice's row (${height} px)`).toBeLessThanOrEqual(45 + 0.5)
  const spill = await bar.evaluate((element) => [element, ...element.querySelectorAll<HTMLElement>('[data-tool-card], [data-selection-chip]')]
    .map((box) => ({ x: box.scrollWidth - box.clientWidth, y: box.scrollHeight - box.clientHeight }))
    .filter((over) => over.x > 1 || over.y > 1))
  expect(spill, `${where}: nothing in the bar scrolls or runs past its box`).toEqual([])
  await expectBarControls(page, where)
}

async function expectZoomAtPeek(page: Page, where: string): Promise<void> {
  if ((await sheet(page).getAttribute('data-phone-sheet')) !== 'peek') {
    await page.locator('[data-sheet-handle]').focus()
    await page.keyboard.press('Home')
    await expect(sheet(page)).toHaveAttribute('data-phone-sheet', 'peek')
  }
  await nextFrames(page)
  const shown = await shownBoxes(page, '[data-zoom-group]')
  expect(shown.length, `${where}: the zoom column shows at the sheet's peek`).toBe(1)
  expect(overlap(shown[0]!, (await sheetParts(page)).sheet), `${where}: the zoom column clears the sheet`).toBe(false)
}

for (const phone of BAR_SIZES) {
  const size = `${phone.width}×${phone.height}`
  const portrait = phone.height > phone.width
  // The small upright phones, where D3's grown bar hid the column.
  const zoomAtPeek = portrait && phone.height < 700
  test.describe(`${size} one-row bar`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height }, hasTouch: true })

    for (const locale of ['en', 'de']) {
      test(`(canopi-f47t.54, D4) every tool, a held row and the selection keep the bar one touch row, its controls take the tap${zoomAtPeek ? ' and the zoom column shows at peek' : ''} (${size} ${locale})`, async ({ page }) => {
        const where = `${size} ${locale}`
        await openFixture(page, FIXTURE, { locale, settings: { snap_to_grid: false }, openWith: portrait ? 'button' : 'shortcut' })
        await expect(page.locator('[data-map-notice]'), `${where}: offline, the map notice shows`).toBeVisible()
        for (const key of TOOL_KEYS) {
          await mapHost(page).focus()
          await page.keyboard.press(key)
          await expect(card(page), `${where} ${key}: the tool's row is the bar's`).toHaveAttribute('data-placement', 'bar')
          await expectOneTouchRow(page, `${where} ${key}`)
          if (zoomAtPeek) await expectZoomAtPeek(page, `${where} ${key}`)
        }
        await holdRowInBar(page)
        await expectOneTouchRow(page, `${where} a row held`)
        if (zoomAtPeek) await expectZoomAtPeek(page, `${where} a row held`)
        // The check button plants the row; its plants stay selected, shown under Select.
        await card(page).locator('[data-plant-row-finish]').tap()
        await mapHost(page).focus()
        await page.keyboard.press('Escape')
        await expect(page.locator('[data-selection-chip]'), `${where}: the planted plants are selected`).toBeVisible()
        await expectOneTouchRow(page, `${where} the selection`)
      })
    }
  })
}

// Options (or a tap on the tool's name) shows the tool's options at half in place of the open panel, with no tab
// selected: the tool's guidance, which the bar's row has no room for. Options again, a tab or the tool's disarming puts
// the panel back as it was; the sheet resting at its peek closes both.
test.describe('390×844 tool options', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('(canopi-f47t.54, D4) Options shows the tool\'s options in place of the open panel, and the panel comes back as it was', async ({ page }) => {
    await openFixture(page, FIXTURE, { basemapHidden: true, settings: { snap_to_grid: false } })
    await raiseSheet(page)
    const selected = page.locator('[data-sheet-tab][aria-selected="true"]')
    const panel = page.locator('[data-phone-sheet] [role="tabpanel"]')
    const before = await selected.getAttribute('data-panel')
    await mapHost(page).focus()
    await page.keyboard.press('z')
    await expect(card(page)).toHaveAttribute('data-tool-card', 'polygon')
    const expectPanelBack = async (why: string) => {
      await expect(toolOptions(page), `${why}: the options close`).toHaveCount(0)
      await expect(panel, `${why}: the panel comes back`).toBeVisible()
      await expect(selected, `${why}: its tab is selected again`).toHaveAttribute('data-panel', before!)
      await expect(sheet(page), `${why}: at its height`).toHaveAttribute('data-phone-sheet', 'half')
    }

    await page.locator('[data-tool-options-button]').tap()
    await expect(toolOptions(page), 'Options shows the tool\'s options').toBeVisible()
    await expect(toolOptions(page), 'the options hold the polygon\'s guidance').toContainText('Click to add corners')
    await expect(page.locator('[data-tool-options-button]')).toHaveAttribute('aria-expanded', 'true')
    await expect(panel, 'in place of the open panel').toHaveCount(0)
    await expect(selected, 'no tab is selected').toHaveCount(0)
    await expect(sheet(page)).toHaveAttribute('data-phone-sheet', 'half')
    await page.locator('[data-tool-options-button]').tap()
    await expectPanelBack('Options again')

    // A tap on the tool's name opens them too; disarming the tool closes them.
    const name = await boxOf(card(page).locator('b').first())
    await page.touchscreen.tap(name.x + name.width / 2, name.y + name.height / 2)
    await expect(toolOptions(page), 'a tap on the tool\'s name shows its options').toBeVisible()
    await mapHost(page).focus()
    await page.keyboard.press('Escape')
    await expect(card(page), 'Esc disarms the polygon').toHaveCount(0)
    await expectPanelBack('the tool disarmed')

    // A tab over the options shows its own panel.
    await page.keyboard.press('z')
    await page.locator('[data-tool-options-button]').tap()
    const other = page.locator('[data-sheet-tab]:not([data-panel="' + before + '"])').first()
    const otherPanel = await other.getAttribute('data-panel')
    await other.tap()
    await expect(toolOptions(page), 'a tab closes the options').toHaveCount(0)
    await expect(selected, 'and selects its panel').toHaveAttribute('data-panel', otherPanel!)

    // Raised to full the options stay; at the peek both close.
    await page.locator('[data-tool-options-button]').tap()
    await page.locator('[data-sheet-handle]').focus()
    await page.keyboard.press('ArrowUp')
    await expect(sheet(page)).toHaveAttribute('data-phone-sheet', 'full')
    await expect(toolOptions(page), 'raised to full the options stay').toBeVisible()
    await page.keyboard.press('Home')
    await expect(sheet(page)).toHaveAttribute('data-phone-sheet', 'peek')
    await expect(toolOptions(page), 'at the peek the options close').toHaveCount(0)
    await expect(panel, 'and the panel').toHaveCount(0)
  })

  test('(canopi-f47t.54, D4) Place plants with no species opens its chooser at half; choosing one puts the panel back, and a tap with none chosen opens it again', async ({ page }) => {
    await openFixture(page, FIXTURE, { basemapHidden: true, settings: { snap_to_grid: false } })
    await raiseSheet(page)
    const selected = page.locator('[data-sheet-tab][aria-selected="true"]')
    const before = await selected.getAttribute('data-panel')
    const apple = toolOptions(page).getByRole('button', { name: /Malus domestica/ }).first()
    await mapHost(page).focus()
    await page.keyboard.press('p')
    await expect(apple, 'arming Place plants with no species shows its chooser').toBeVisible()
    await expect(sheet(page)).toHaveAttribute('data-phone-sheet', 'half')
    await expect(selected, 'in place of the open panel').toHaveCount(0)

    // Rested at its peek, the sheet opens the chooser again at a tap on the map with no species chosen.
    await page.locator('[data-sheet-handle]').focus()
    await page.keyboard.press('Home')
    await expect(toolOptions(page), 'at the peek the chooser closes').toHaveCount(0)
    await tap(page, ABOVE)
    await expect(apple, 'a tap on the map with no species opens the chooser again').toBeVisible()
    await expect(sheet(page)).toHaveAttribute('data-phone-sheet', 'half')
    await apple.click()
    await expect(toolOptions(page), 'choosing a species closes the chooser').toHaveCount(0)
    await expect(sheet(page), 'the sheet goes back to its peek').toHaveAttribute('data-phone-sheet', 'peek')
    await expect(card(page).locator('[data-tool-card-lead="species"]'), 'the bar names the chosen species').toBeVisible()

    // With a species chosen Options is Change species, over the open panel, which comes back once one is chosen.
    await raiseSheet(page)
    await page.locator('[data-tool-options-button]').tap()
    await expect(apple, 'Options shows the chooser').toBeVisible()
    await apple.click()
    await expect(toolOptions(page)).toHaveCount(0)
    await expect(selected, 'the panel comes back').toHaveAttribute('data-panel', before!)
    await expect(sheet(page)).toHaveAttribute('data-phone-sheet', 'half')
  })
})

// On a phone the selection is the context bar's one context under Select (answers 18, 23 and 26): once Plant a row plants,
// its plants stay selected and the selection chip is the sheet's first row in place of the card, on one line (its text
// ellipsised, its labels short), and Select all of this species and Clear take the tap at their centre.
for (const phone of PHONES) {
  const size = `${phone.width}×${phone.height}`
  const portrait = phone.height > phone.width
  test.describe(`${size} selection in the bar`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height }, hasTouch: true })

    for (const locale of ['en', 'de']) {
      test(`(canopi-f47t.54, D) a planted row's selection is the bar's one line, and its buttons take the tap (${size} ${locale})`, async ({ page }) => {
        const where = `${size} ${locale}`
        await openFixture(page, FIXTURE, { locale, settings: { snap_to_grid: false }, openWith: portrait ? 'button' : 'shortcut' })
        await holdRowInBar(page)
        await mapHost(page).focus()
        await page.keyboard.press('Enter')
        // The planted plants stay selected; the first Esc leaves Plant a row for Select, which shows them.
        await page.keyboard.press('Escape')
        const chip = page.locator('[data-selection-chip]')
        await expect(chip, `${where}: the planted plants are selected`).toHaveAttribute('data-selection-chip', 'bar')
        await expect(card(page), `${where}: the card leaves the bar to the selection`).toHaveCount(0)
        await nextFrames(page)
        expect(await chip.evaluate((element) => element.parentElement?.hasAttribute('data-phone-context-bar')), `${where}: the chip is the bar's`).toBe(true)
        expectBarDocked(await sheetParts(page), where)
        const text = await boxOf(chip.locator('[role="status"]'))
        const buttons = await chip.getByRole('button').all()
        expect(buttons.length, `${where}: Select all of this species and Clear`).toBe(2)
        for (const button of buttons) {
          const box = await boxOf(button)
          expect(Math.abs(box.y + box.height / 2 - (text.y + text.height / 2)), `${where}: ${await button.textContent()} is on the text's line`).toBeLessThanOrEqual(4)
          await expectHitAtCentre(button, `${where}: the chip's ${await button.textContent()}`)
        }
      })
    }
  })
}

// On a phone the inspection lens's launcher is a button of the zoom column (answer 25): with it the column still stands
// between the top bar and the sheet at its peek, held upright or on its side, and a tap opens the lens.
for (const phone of PHONES) {
  const size = `${phone.width}×${phone.height}`
  const portrait = phone.height > phone.width
  test.describe(`${size} lens launcher`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height }, hasTouch: true })

    test(`(canopi-f47t.54, D) the inspection launcher is a button of the zoom column, which fits beside the sheet, and a tap opens the lens (${size})`, async ({ page }) => {
      await openFixture(page, FIXTURE, { openWith: portrait ? 'button' : 'shortcut' })
      const column = page.locator('[data-zoom-group]')
      const launcher = column.locator('[data-inspection-launcher]')
      await expect(launcher, `${size}: the launcher is in the zoom column`).toBeVisible()
      await expect(page.locator('[data-inspection-launcher]'), `${size}: no other launcher floats`).toHaveCount(1)
      await nextFrames(page)
      const columnBox = await boxOf(column)
      const titleBar = await boxOf(page.locator('[data-workspace-title-bar]'))
      expect(columnBox.y, `${size}: the column starts below the top bar`).toBeGreaterThanOrEqual(titleBar.y + titleBar.height)
      expect(overlap(columnBox, (await sheetParts(page)).sheet), `${size}: the column clears the sheet`).toBe(false)
      await expectHitAtCentre(launcher, `${size}: the launcher`)
      const box = await boxOf(launcher)
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
      await expect(launcher, `${size}: the launcher hides while the lens is open`).toBeHidden()
      await expect(page.locator(`#${await launcher.getAttribute('aria-controls')}`), `${size}: the tap opens the lens`).toBeVisible()
    })
  })
}

// On a phone the top chips are the context bar's (answer 24): with nothing selected under Select, the labels chip shown
// after Shift+L changes the labels is the sheet's first row, and the canvas mounts no top chip slot.
for (const phone of PHONES) {
  const size = `${phone.width}×${phone.height}`
  const portrait = phone.height > phone.width
  test.describe(`${size} labels chip in the bar`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height }, hasTouch: true })

    test(`(canopi-f47t.54, D) the labels chip is the bar's, and no top chip slot floats (${size})`, async ({ page }) => {
      await openFixture(page, FIXTURE, { basemapHidden: true, openWith: portrait ? 'button' : 'shortcut' })
      await mapHost(page).focus()
      await page.keyboard.press('Shift+L')
      const chip = page.locator('[data-plant-labels-chip]')
      await expect(chip, `${size}: the labels chip shows`).toBeVisible()
      expect(await chip.evaluate((element) => element.closest('[data-phone-context-bar]') !== null), `${size}: the chip is the bar's`).toBe(true)
      await expect(page.locator('[data-top-chip-slot]'), `${size}: no top chip slot`).toHaveCount(0)
      await nextFrames(page)
      expectBarDocked(await sheetParts(page), size)
    })
  })
}

// On a phone the map notice is a status row on top of the context bar (answer 24), shown alone or with whatever the bar
// holds (here Plant a row's card), in the panel sheet: Retry takes the tap at its centre, at peek and half.
for (const phone of PHONES) {
  const size = `${phone.width}×${phone.height}`
  const portrait = phone.height > phone.width
  test.describe(`${size} notice in the bar`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height }, hasTouch: true })

    test(`(canopi-f47t.54, D) offline, the map notice is the bar's top row, alone or above the card, and Retry takes the tap (${size})`, async ({ page }) => {
      await openFixture(page, FIXTURE, { settings: { snap_to_grid: false }, openWith: portrait ? 'button' : 'shortcut' })
      const notice = page.locator('[data-map-notice]')
      const expectNoticeOnTop = async (where: string) => {
        await expect(notice, `${where}: offline, the map notice shows`).toBeVisible()
        expect(await notice.evaluate((element) => element.parentElement?.hasAttribute('data-phone-context-bar') && element.parentElement.firstElementChild === element), `${where}: the notice is the bar's first row`).toBe(true)
        await nextFrames(page)
        expectBarDocked(await sheetParts(page), where)
        await expectHitAtCentre(notice.getByRole('button'), `${where}: Retry`)
      }
      await expectNoticeOnTop(`${size} alone`)
      await holdRowInBar(page)
      for (const height of ['peek', 'half'] as const) {
        if (height === 'half') await raiseSheet(page)
        const where = `${size} ${height} with a row held`
        await expectNoticeOnTop(where)
        const noticeBox = await boxOf(notice)
        const cardBox = await boxOf(card(page))
        expect(cardBox.y, `${where}: the card stands below the notice`).toBeGreaterThanOrEqual(noticeBox.y + noticeBox.height - 0.5)
      }
    })
  })
}

/**
 * Every shown element that floats over the visible map (absolutely or fixed placed, inside the map area, meeting the
 * frame the visible-map-area seam leaves): the zoom column, the map itself (its canvas, handles and credits) and the map
 * area's own full-bleed layers are not chrome floating over it.
 */
async function floatingOverMap(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const area = document.querySelector<HTMLElement>('[style*="--map-inset-bottom"]')
    if (!area) throw new Error('no map area publishes its insets')
    const box = area.getBoundingClientRect()
    const inset = (edge: string) => parseFloat(area.style.getPropertyValue(`--map-inset-${edge}`))
    const frame = { top: box.top + inset('top'), right: box.right - inset('right'), bottom: box.bottom - inset('bottom'), left: box.left + inset('left') }
    const found: string[] = []
    for (const element of area.querySelectorAll<HTMLElement>('*')) {
      if (element.closest('[data-zoom-group], [role="application"], [data-canvas-handle]')) continue
      const style = getComputedStyle(element)
      if (style.position !== 'absolute' && style.position !== 'fixed') continue
      if (style.visibility === 'hidden' || style.display === 'none' || element.closest('[hidden]')) continue
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      // The map area's own layers span the whole frame.
      if (rect.left <= frame.left && rect.right >= frame.right && rect.top <= frame.top && rect.bottom >= frame.bottom) continue
      const meets = rect.left < frame.right - 1 && rect.right > frame.left + 1 && rect.top < frame.bottom - 1 && rect.bottom > frame.top + 1
      if (!meets) continue
      const marks = [...element.attributes].filter((attribute) => attribute.name.startsWith('data-') || attribute.name === 'aria-label' || attribute.name === 'class')
        .map((attribute) => `${attribute.name}=${attribute.value}`).join(' ')
      found.push(`<${element.tagName.toLowerCase()} ${marks}> at ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`)
    }
    return found
  })
}

/** The share of the screen's height an open panel keeps under the context bar. */
const OPEN_PANEL_SHARE = 0.25
/** The bar's least height over an open panel: a row's card, three touch targets and a focus ring's room. */
const BAR_LEAST_PX = 3 * 44 + 8

/**
 * The guard of answers 18 and 22-26: nothing but the zoom column floats over the map; the sheet, its context bar
 * included, stays below the top bar; an open panel keeps a quarter of the screen under the bar, as far as the bar keeps
 * its least height; and every control in the bar is a 44 px target (ADR 0010) that takes the tap at its centre (scrolled
 * into view where the bar's card scrolls).
 */
async function expectPhoneChrome(page: Page, where: string): Promise<void> {
  await nextFrames(page)
  expect(await floatingOverMap(page), `${where}: nothing but the zoom column floats over the map`).toEqual([])
  const titleBar = await boxOf(page.locator('[data-workspace-title-bar]'))
  const { sheet: sheetBox } = await sheetParts(page)
  expect(sheetBox.y, `${where}: the sheet's top (${sheetBox.y}) is below the top bar (${titleBar.y + titleBar.height})`).toBeGreaterThanOrEqual(titleBar.y + titleBar.height)
  const panel = page.locator('[data-phone-sheet] [role="tabpanel"]')
  if (await panel.count() > 0) {
    const panelBox = await boxOf(panel)
    const { bar, dock } = await sheetParts(page)
    // What the sheet leaves the panel under a bar at its least height, below the handle and the tabs.
    const room = panelBox.y + panelBox.height - bar.y - BAR_LEAST_PX - (panelBox.y - dock.y)
    const least = Math.min(page.viewportSize()!.height * OPEN_PANEL_SHARE, room)
    expect(panelBox.height, `${where}: the open panel keeps a quarter of the screen under the bar, or what the bar's least height leaves (${panelBox.height} of ${least} px)`).toBeGreaterThanOrEqual(least - 1)
  }
  await expectBarControls(page, where)
}

/** Every control in the context bar is a 44 px target (ADR 0010) that takes the tap at its centre. */
async function expectBarControls(page: Page, where: string): Promise<void> {
  const controls = page.locator('[data-phone-context-bar]').locator('button, input, select, textarea, [role="button"]')
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue
    const name = `${(await control.getAttribute('aria-label')) ?? (await control.textContent()) ?? 'a control'} in the bar`
    const box = await boxOf(control)
    expect(Math.min(box.width, box.height), `${where}: ${name} is a 44 px target (${box.width}x${box.height})`).toBeGreaterThanOrEqual(44 - 0.5)
    await expectHitAtCentre(control, `${where}: ${name}`)
  }
}

/** Raises the sheet from its peek a step at a time from its handle, runs `check` at each stop, and expects each step up
 *  to raise it (a portrait half sheet grows past half for its panel, and stops a touch target short of full; a landscape
 *  peek stays below the top bar, and its half and full sheets differ in width). */
async function expectStopsInOrder(page: Page, check: (height: string) => Promise<void>): Promise<void> {
  const heights: number[] = []
  for (const height of ['peek', 'half', 'full'] as const) {
    if (height !== 'peek') {
      await page.locator('[data-sheet-handle]').focus()
      await page.keyboard.press('ArrowUp')
    }
    await expect(sheet(page)).toHaveAttribute('data-phone-sheet', height)
    await check(height)
    heights.push((await sheetParts(page)).sheet.height)
  }
  expect(heights[1]!, `raising the sheet to half never lowers it (peek ${heights[0]}, half ${heights[1]})`).toBeGreaterThanOrEqual(heights[0]! - 0.5)
  expect(heights[2]!, `raising the sheet to full never lowers it (half ${heights[1]}, full ${heights[2]})`).toBeGreaterThanOrEqual(heights[1]! - 0.5)
  const viewport = page.viewportSize()!
  if (viewport.height > viewport.width) {
    expect(heights[2]! - heights[1]!, `upright, raising the sheet to full raises it a touch target at least (half ${heights[1]}, full ${heights[2]})`).toBeGreaterThanOrEqual(44 - 0.5)
  }
}

// The tallest card the bar holds is Place plants' chooser, and the notice row goes on top of it offline: held upright or
// on its side, down to an iPhone SE's 568x320, in en and de, the sheet stays below the top bar at its peek (the bar
// scrolls instead), each step up raises it, an open panel keeps its share under the card, and the card's
// and the notice's controls are 44 px targets that take the tap.
for (const phone of [...PHONES, { width: 568, height: 320 }]) {
  const size = `${phone.width}×${phone.height}`
  const portrait = phone.height > phone.width
  test.describe(`${size} Place plants in the bar`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height }, hasTouch: true })

    for (const locale of ['en', 'de']) {
      test(`(canopi-f47t.54, D) offline with Place plants armed, the sheet keeps below the top bar, rises at each step and leaves the open panel its share (${size} ${locale})`, async ({ page }) => {
        await openFixture(page, FIXTURE, { locale, settings: { snap_to_grid: false }, openWith: portrait ? 'button' : 'shortcut' })
        const where = `${size} ${locale}`
        await expect(page.locator('[data-map-notice]'), `${where}: offline, the map notice shows`).toBeVisible()
        await mapHost(page).focus()
        await page.keyboard.press('p')
        await expect(card(page), `${where}: Place plants' card is the bar's`).toHaveAttribute('data-tool-card', 'plant-stamp')
        // Arming it with no species opened its chooser; the sheet rests at its peek first.
        await expect(toolOptions(page), `${where}: Place plants opens its chooser`).toBeVisible()
        await page.locator('[data-sheet-handle]').focus()
        await page.keyboard.press('Home')
        await expectStopsInOrder(page, (height) => expectPhoneChrome(page, `${where} Place plants, sheet at ${height}`))
      })
    }
  })
}

for (const phone of PHONES) {
  const size = `${phone.width}×${phone.height}`
  const portrait = phone.height > phone.width
  test.describe(`${size} phone chrome guard`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height }, hasTouch: true })

    for (const locale of ['en', 'de']) {
      test(`(canopi-f47t.54, D) nothing but the zoom column floats over the map and every control in the bar takes the tap (${size} ${locale})`, async ({ page }) => {
        await openFixture(page, FIXTURE, { locale, settings: { snap_to_grid: false }, openWith: portrait ? 'button' : 'shortcut' })
        const where = `${size} ${locale}`
        await expect(page.locator('[data-map-notice]'), `${where}: offline, the map notice shows`).toBeVisible()
        await expectPhoneChrome(page, `${where} idle`)

        await mapHost(page).focus()
        await page.keyboard.press('Shift+L')
        await expect(page.locator('[data-plant-labels-chip]'), `${where}: the labels chip shows`).toBeVisible()
        await expectPhoneChrome(page, `${where} the labels chip`)

        await holdRowInBar(page)
        for (const height of ['peek', 'half', 'full'] as const) {
          if (height !== 'peek') {
            await page.locator('[data-sheet-handle]').focus()
            await page.keyboard.press('ArrowUp')
          }
          await expect(sheet(page)).toHaveAttribute('data-phone-sheet', height)
          await expectPhoneChrome(page, `${where} a row held, sheet at ${height}`)
        }

        // The check button plants the row; its plants stay selected, shown under Select at the sheet's peek.
        await card(page).locator('[data-plant-row-finish]').click()
        await page.locator('[data-sheet-handle]').focus()
        await page.keyboard.press('Home')
        await expect(sheet(page)).toHaveAttribute('data-phone-sheet', 'peek')
        await mapHost(page).focus()
        await page.keyboard.press('Escape')
        await expect(page.locator('[data-selection-chip]'), `${where}: the planted plants are selected`).toBeVisible()
        await expectPhoneChrome(page, `${where} the selection`)
      })
    }
  })
}
