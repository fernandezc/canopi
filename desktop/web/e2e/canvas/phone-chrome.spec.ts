// The phone chrome's seams for every chrome mix (canopi-f47t.54, stream H; plan section 4 "2.0 plant along a path",
// answer 17): where the registered chrome leaves the map less than 120 px on an axis, Fit to Design frames the Design in
// a 120 px band grown around the free band's centre, not under the chrome on the whole screen. Both engines, touch,
// offline (so the map notice shows). DOM assertions only, no baselines.
//
// The base fixture at 390x844: its opening camera puts the Apple inside the rectangle zone at (114, 349) (touch.spec.ts).
// The Design is read where it is drawn from the row's handles (the picked Apple and one point), as
// plant-path.spec.ts reads it at 1024x768; the opening scale comes from the row's length in the tool card.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import type { Point } from '../support/fingers'
import { mapHost, nextFrames, openFixture } from '../support/layout'
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
