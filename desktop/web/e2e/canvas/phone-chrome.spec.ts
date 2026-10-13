// The phone chrome's seams for every chrome mix (canopi-f47t.54, stream H; plan section 4 "2.0 plant along a path",
// answer 17). Where the registered chrome leaves the map less than 120 px on an axis, Fit to Design frames the Design in
// a 120 px band grown around the free band's centre, not under the chrome on the whole screen. When a drawing tool
// starts a draft the panel sheet drops to its peek. Held on its side with the Plant a row card on the left, the map
// notice's Retry stays clear of the zoom column, which is placed from the visible map rather than registered with it.
// After a tap, a mouse-typed boundary event keeps the touch handles 44 px (canopi-94o3). Both engines, touch, offline
// (so the map notice shows). DOM assertions only, no baselines.
//
// The base fixture at 390x844: its opening camera puts the Apple inside the rectangle zone at (114, 349) (touch.spec.ts).
// The fit is read where the Design is drawn from the row's handles (the picked Apple and one point), as
// plant-path.spec.ts reads it at 1024x768; the opening scale comes from the row's length in the tool card.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { pressMod } from '../support/canvas'
import { Fingers, type Point } from '../support/fingers'
import { boxOf, expectHitAtCentre, mapHost, nextFrames, openFixture, overlap, type Box } from '../support/layout'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))
/** The fixture's Apple inside the rectangle zone, at the opening camera on a 390x844 screen. */
const APPLE: Point = { x: 114, y: 349 }
const APPLE_GEO = { lon: 3.877071839, lat: 43.611230142 }
/** Empty ground straight below the Apple, above the sheet's peek, and beside that. */
const BELOW: Point = { x: 114, y: 620 }
const BESIDE: Point = { x: 250, y: 620 }
/** fit.ts's least framing extent. */
const MIN_FRAMING_PX = 120

interface Edges { readonly top: number, readonly right: number, readonly bottom: number, readonly left: number }

function card(page: Page): Locator {
  return page.locator('[data-tool-card]')
}

async function tap(page: Page, at: Point): Promise<void> {
  await page.touchscreen.tap(at.x, at.y)
  // Apart in time, so two taps never make a double tap.
  await page.waitForTimeout(600)
}

/** A row handle's centre on screen. */
async function handleAt(page: Page, id: string): Promise<Point> {
  const box = await page.locator(`[data-canvas-handle="${id}"]`).boundingBox()
  if (!box) throw new Error(`no handle ${id} is shown`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * The picked Apple and the row's second point on screen. A two-point row shows no handle on the picked plant, so there
 * the Apple is read through the straight segment's midpoint dot; from three points it has its own.
 */
async function rowEnds(page: Page, points: 2 | 3): Promise<readonly [Point, Point]> {
  const point = await handleAt(page, 'point:draft:1')
  if (points === 3) return [await handleAt(page, 'point:draft:0'), point]
  const dot = await handleAt(page, 'dot:draft:0')
  return [{ x: 2 * dot.x - point.x, y: 2 * dot.y - point.y }, point]
}

function metresFromApple(geo: { readonly lon: number, readonly lat: number }): Point {
  const lat = (APPLE_GEO.lat * Math.PI) / 180
  return { x: (geo.lon - APPLE_GEO.lon) * 111_320 * Math.cos(lat), y: (geo.lat - APPLE_GEO.lat) * 110_574 }
}

/** The fixture's plants, zone corners (an ellipse's centre) and label anchors, in metres east and north of the Apple. */
function designPoints(): Point[] {
  type Geo = { readonly lon: number, readonly lat: number }
  const design = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    plants: { position: Geo }[], zones: { zone_type: string, points: Geo[] }[], annotations: { position: Geo }[]
  }
  return [
    ...design.plants.map((plant) => plant.position),
    ...design.zones.flatMap((zone) => zone.zone_type === 'ellipse' ? zone.points.slice(0, 1) : zone.points),
    ...design.annotations.map((annotation) => annotation.position),
  ].map(metresFromApple)
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

/** fit.ts's framing on one axis: a band under 120 px grows to 120 px around its centre, inside the area. */
function grownSpan(start: number, end: number, areaStart: number, areaEnd: number): readonly [number, number] {
  if (end - start >= MIN_FRAMING_PX) return [start, end]
  const from = Math.min(Math.max((start + end) / 2 - MIN_FRAMING_PX / 2, areaStart), areaEnd - MIN_FRAMING_PX)
  return [from, from + MIN_FRAMING_PX]
}

test.describe('390×844 card and half sheet', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  // Answer 17 and stream P's finding 1: the grown Plant a row card and the half sheet leave a band of about 62 px; Fit to
  // Design used to frame the whole screen then, putting the Design under the card and the sheet.
  test('(canopi-f47t.54, H) with the card and the half sheet leaving under 120 px, Fit to Design frames the Design in a 120 px band around the free band', async ({ page }) => {
    await openFixture(page, FIXTURE, { settings: { snap_to_grid: false } })
    await mapHost(page).focus()
    await page.keyboard.press('w')
    await expect(card(page)).toHaveAttribute('data-tool-card', 'plant-spacing')
    await tap(page, APPLE)
    const field = card(page).locator('[data-plant-spacing-interval-input]')
    await expect(field, 'the pick focuses the spacing field').toBeFocused()
    await page.keyboard.press('Enter')
    await tap(page, BELOW)
    await expect(card(page).locator('[data-plant-row-finish]'), 'the row holds two points').toBeVisible()
    await nextFrames(page)
    const before = await rowEnds(page, 2)
    const lengthText = await card(page).locator('[data-plant-row-length] b').textContent()
    const lengthM = Number.parseFloat((lengthText ?? '').replace(',', '.'))
    expect(lengthM, `the row's length reads as metres: ${lengthText}`).toBeGreaterThan(0)
    // The opening scale, in px per metre, and the opening camera: north up, the Apple where it was picked.
    const openingScale = Math.hypot(before[1].x - before[0].x, before[1].y - before[0].y) / lengthM
    // A third point shows the picked plant's own handle, which the fit keeps on screen with the Design.
    await tap(page, BESIDE)
    await expect(page.locator('[data-canvas-handle="point:draft:0"]'), 'three points show the picked plant\'s handle').toHaveCount(1)

    await page.locator('[data-sheet-handle]').focus()
    await page.keyboard.press('ArrowUp')
    await expect(page.locator('[data-phone-sheet]'), 'the panel sheet rests at half height').toHaveAttribute('data-phone-sheet', 'half')
    await expect(card(page).locator('[data-plant-row-finish]'), 'the row is still held').toBeVisible()
    await nextFrames(page)
    const frame = await framingEdges(page)
    expect(frame.bottom - frame.top, 'the card and the half sheet leave the map under 120 px of height').toBeLessThan(MIN_FRAMING_PX)
    const [top, bottom] = grownSpan(frame.top, frame.bottom, frame.area.top, frame.area.bottom)
    const [left, right] = grownSpan(frame.left, frame.right, frame.area.left, frame.area.right)

    await page.getByRole('group', { name: 'Zoom' }).getByRole('button', { name: 'Fit to Design' }).click()
    let last = ''
    await expect.poll(async () => {
      const now = JSON.stringify(await rowEnds(page, 3))
      const still = now === last
      last = now
      return still
    }, { message: 'the fit comes to rest', intervals: [100] }).toBe(true)
    const after = JSON.parse(last) as [Point, Point]
    // The camera change, screen to screen, in complex numbers: after = after0 + k (before - before0).
    const db = { re: before[1].x - before[0].x, im: before[1].y - before[0].y }
    const da = { re: after[1].x - after[0].x, im: after[1].y - after[0].y }
    const norm = db.re * db.re + db.im * db.im
    const k = { re: (da.re * db.re + da.im * db.im) / norm, im: (da.im * db.re - da.re * db.im) / norm }
    const fitted = (metres: Point): Point => {
      const opening = { re: APPLE.x + metres.x * openingScale - before[0].x, im: APPLE.y - metres.y * openingScale - before[0].y }
      return { x: after[0].x + k.re * opening.re - k.im * opening.im, y: after[0].y + k.re * opening.im + k.im * opening.re }
    }
    // A pixel of slack: the opening Apple and the length are read to a pixel and to the card's rounding.
    const slack = 2
    for (const point of [...designPoints().map(fitted), after[0]]) {
      const where = `the Design at (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`
      expect(point.y, `${where} is below the grown frame's top ${top}`).toBeGreaterThanOrEqual(top - slack)
      expect(point.y, `${where} is above the grown frame's bottom ${bottom}`).toBeLessThanOrEqual(bottom + slack)
      expect(point.x, `${where} is right of the frame's left ${left}`).toBeGreaterThanOrEqual(left - slack)
      expect(point.x, `${where} is left of the frame's right ${right}`).toBeLessThanOrEqual(right + slack)
    }
  })
})

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

// Answer 17: on a phone, while a drawing tool holds a draft (Plant a row, Polygon, Profile line), the panel sheet drops to
// its peek, so the draft is drawn on the map rather than under the sheet; arming a tool alone keeps the sheet, and a
// sheet raised again during the draft stays where the user puts it.
test.describe('390×844 drafts and the sheet', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('(canopi-f47t.54, H) the half sheet drops to its peek when Plant a row picks its plant, and stays raised when raised again', async ({ page }) => {
    await openFixture(page, FIXTURE, { settings: { snap_to_grid: false } })
    await raiseSheet(page)
    await mapHost(page).focus()
    await page.keyboard.press('w')
    await expect(card(page)).toHaveAttribute('data-tool-card', 'plant-spacing')
    await expect(sheet(page), 'arming the tool keeps the sheet').toHaveAttribute('data-phone-sheet', 'half')
    await tap(page, APPLE)
    await expect(card(page).locator('[data-plant-spacing-interval-input]'), 'the tap picks the Apple').toBeFocused()
    await expect(sheet(page), 'the pick drops the sheet to its peek').toHaveAttribute('data-phone-sheet', 'peek')
    await page.keyboard.press('Enter')
    await tap(page, BELOW)
    await raiseSheet(page)
    await nextFrames(page)
    await expect(sheet(page), 'raised again during the draft, the sheet stays').toHaveAttribute('data-phone-sheet', 'half')
  })

  test('(canopi-f47t.54, H) the half sheet drops to its peek at a polygon\'s first corner', async ({ page }) => {
    await openFixture(page, FIXTURE, { settings: { snap_to_grid: false } })
    await raiseSheet(page)
    await tool(page, 'Polygon zone').tap()
    await expect(tool(page, 'Polygon zone')).toHaveAttribute('aria-pressed', 'true')
    await expect(sheet(page), 'arming the tool keeps the sheet').toHaveAttribute('data-phone-sheet', 'half')
    await tap(page, { x: 150, y: 280 })
    await expect(sheet(page), 'the first corner drops the sheet to its peek').toHaveAttribute('data-phone-sheet', 'peek')
  })
})

interface Landscape {
  readonly width: number
  readonly height: number
  /** The new Apple, then the row's two points: clear ground right of the card, left of the zoom column, above the peek. */
  readonly row: readonly [Point, Point, Point]
}

const LANDSCAPES: readonly Landscape[] = [
  { width: 740, height: 360, row: [{ x: 600, y: 220 }, { x: 640, y: 220 }, { x: 640, y: 180 }] },
  { width: 844, height: 390, row: [{ x: 680, y: 240 }, { x: 720, y: 240 }, { x: 720, y: 200 }] },
]

/** Places an Apple from Place plants' species list, then holds a Plant a row draft from it with two more points. */
async function holdRow(page: Page, row: readonly [Point, Point, Point]): Promise<void> {
  await mapHost(page).focus()
  await page.keyboard.press('p')
  const apple = card(page).getByRole('button', { name: /Malus domestica/ }).first()
  await apple.scrollIntoViewIfNeeded()
  await apple.click()
  await tap(page, row[0])
  // Esc leaves Place plants, the next clears the placed Apple's selection.
  await mapHost(page).focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('w')
  await tap(page, row[0])
  await expect(card(page).locator('[data-plant-spacing-interval-input]'), 'the tap picks the Apple').toBeFocused()
  await page.keyboard.press('Enter')
  await tap(page, row[1])
  await tap(page, row[2])
  await expect(card(page).locator('[data-plant-row-finish]'), 'the row holds three points').toBeVisible()
}

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

// Answer 17: the phone zoom column is placed from the visible map, not registered with it, so the map notice's room
// ends left of the column; held on its side with the Plant a row card on the left, the notice's Retry is never under the
// zoom group, with the sheet at its peek or its side sheet at half.
for (const layout of LANDSCAPES) {
  const size = `${layout.width}×${layout.height}`
  test.describe(`${size} notice`, () => {
    test.use({ viewport: { width: layout.width, height: layout.height }, hasTouch: true })

    test(`(canopi-f47t.54, H) with a row held, the map notice and its Retry clear the zoom group, sheet at peek or half (${size})`, async ({ page }) => {
      await openFixture(page, FIXTURE, { settings: { snap_to_grid: false }, openWith: 'shortcut' })
      await holdRow(page, layout.row)
      for (const height of ['peek', 'half'] as const) {
        if (height === 'half') await raiseSheet(page)
        await expect(sheet(page)).toHaveAttribute('data-phone-sheet', height)
        await expect(card(page).locator('[data-plant-row-finish]'), `${size} ${height}: the row is still held`).toBeVisible()
        await nextFrames(page)
        const notice = page.locator('[data-map-notice]')
        await expect(notice, `${size} ${height}: offline, the map notice shows`).toBeVisible()
        const noticeBox = await boxOf(notice)
        const retry = notice.locator('button')
        const retryBox = await boxOf(retry)
        const zoom = await shownBoxes(page, '[data-zoom-group]')
        expect(zoom.length, `${size} ${height}: the zoom group shows`).toBeGreaterThan(0)
        for (const box of zoom) {
          expect(overlap(noticeBox, box), `${size} ${height}: the map notice clears the zoom group`).toBe(false)
          expect(overlap(retryBox, box), `${size} ${height}: Retry is not under the zoom group`).toBe(false)
        }
        for (const [name, selector] of [['the tool card', '[data-tool-card]'], ['the panel sheet', '[data-phone-sheet]']] as const) {
          for (const box of await shownBoxes(page, selector)) {
            expect(overlap(noticeBox, box), `${size} ${height}: the map notice clears ${name}`).toBe(false)
          }
        }
        await expectHitAtCentre(retry, `${size} ${height}: the map notice's Retry`)
      }
    })
  })
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
    await openFixture(page, FIXTURE, { settings: { snap_to_grid: false } })
    await mapHost(page).focus()
    await page.keyboard.press('w')
    await tap(page, APPLE)
    await expect(card(page).locator('[data-plant-spacing-interval-input]'), 'the tap picks the Apple').toBeFocused()
    await page.keyboard.press('Enter')
    await tap(page, BELOW)
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
    }, { x: 300, y: 600 })
    await nextFrames(page)
    const afterLeave = await rowHandleSizes(page)
    expect(afterLeave.every((size) => size >= 44), `a mouse-typed leave keeps 44 px handles: ${afterLeave}`).toBe(true)

    await page.mouse.move(300, 600)
    await page.mouse.move(305, 600)
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
 * The zoom column, placed from the framing frame, clears the bar wherever the frame is as tall as the column. A shorter
 * frame (360x560 with the sheet at half) is answer 25's: the column hides there, as at full.
 */
async function expectZoomClearOfBar(page: Page, bar: Locator, where: string): Promise<void> {
  const barBox = await boxOf(bar)
  const frame = await framingEdges(page)
  for (const zoom of await shownBoxes(page, '[data-zoom-group]')) {
    if (zoom.height > frame.bottom - frame.top) {
      test.info().annotations.push({ type: 'zoom column taller than its frame', description: `${where}: ${zoom.height} px in ${frame.bottom - frame.top} px` })
      continue
    }
    expect(overlap(zoom, barBox), `${where}: the zoom column clears the bar`).toBe(false)
  }
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
