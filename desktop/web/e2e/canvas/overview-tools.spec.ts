// Tools in overview (canopi-n2cg; ADR 0015 and 0018, amended 2026-10-14): zoomed out past 0.1 px/m every tool stays
// enabled; picking a drawing tool by its rail button or its key fits the Design, as Fit to Design does, then arms it;
// the Design pin is a button that fits the Design; a plant dragged from the catalog onto the overview fits the Design,
// places nothing and stays picked for Place plants; an empty Design zooms in about the view centre, not the origin;
// a drop on the pin itself is taken as on the map. Both engines, DOM assertions only. The e2e catalog is always 404
// (support/offline.ts), so the drag is synthetic dragenter, dragover and drop events carrying the catalog's drag data,
// each sent to the element under the point as the browser does.
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { designMap } from '../support/canvas'
import { mapHost, nextFrames, openFixture } from '../support/layout'
import { expect, test } from '../support/offline'
import { tooltipOf } from '../support/tooltip'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))
/** Empty map, away from every object and chrome of the fixture's opening camera. */
const NEUTRAL = { x: 800, y: 450 }
/** The drawing tools and their keys, as the rail names them. */
const DRAWING_TOOLS = [
  ['Place plants', 'p'],
  ['Plant a row', 'w'],
  ['Place a stamp', 'k'],
  ['Polygon zone', 'z'],
  ['Rectangle zone', 'r'],
  ['Ellipse zone', 'e'],
  ['Line zone', 'l'],
  ['Text note', 't'],
  ['Measure', 'm'],
] as const
/** The plant catalog's drag data (canvas/plant-stamp-source.ts). */
const PLANT_STAMP_MIME = 'application/x.canopi.plant-stamp+json'

function tool(page: Page, name: string) {
  return page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: new RegExp(`^${name}( \\(.+\\))?$`) })
}

function overviewNotice(page: Page) {
  return page.locator('[data-overview-notice]')
}

function designPin(page: Page) {
  return page.getByRole('button', { name: /^Go to Design: / })
}

/** The scale's denominator, from the map scale chip ("1:240" → 240). */
async function scaleDenominator(page: Page): Promise<number> {
  const text = await page.getByRole('group', { name: 'Zoom' }).getByRole('button', { name: /^Map scale/ }).textContent()
  const match = /1:([\d,\s ]+)/.exec(text ?? '')
  if (!match) throw new Error(`no scale in the map scale chip: ${text}`)
  return Number(match[1]!.replace(/[^\d]/g, ''))
}

/** Wheels out about `at` until the overview notice shows. */
async function zoomOutToOverview(page: Page, at: { x: number, y: number } = NEUTRAL): Promise<void> {
  await page.mouse.move(at.x, at.y)
  for (let step = 0; step < 80 && await overviewNotice(page).count() === 0; step += 1) {
    await page.mouse.wheel(0, 400)
    await nextFrames(page)
  }
  await expect(overviewNotice(page), 'zoomed out to overview').toBeVisible()
}

/** The view has left overview at the Design's fit: no notice, and site scale (the fixture fits at about 1:240). */
async function expectFitted(page: Page, what: string): Promise<void> {
  await expect(overviewNotice(page), `${what}: the view left overview`).toHaveCount(0)
  expect(await scaleDenominator(page), `${what}: the Design is framed at site scale`).toBeLessThan(2000)
}

async function openOverview(page: Page): Promise<void> {
  await openFixture(page, FIXTURE, { basemapHidden: true })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await zoomOutToOverview(page)
}

test('in overview every tool is enabled; a drawing tool\'s button or key fits the Design and arms it', async ({ page }) => {
  await openOverview(page)
  await expect(tool(page, 'Select'), 'Select is enabled in overview').toBeEnabled()
  // Pan (H, off the rail) keeps the overview.
  await designMap(page).focus()
  await page.keyboard.press('h')
  await expect(tool(page, 'Select'), 'Pan is armed').toHaveAttribute('aria-pressed', 'false')
  await expect(overviewNotice(page), 'Pan keeps the overview').toBeVisible()

  for (const [name, key] of DRAWING_TOOLS) {
    await expect(tool(page, name), `${name} is enabled in overview`).toBeEnabled()
    await tool(page, name).click()
    await expectFitted(page, `${name}'s button`)
    await expect(tool(page, name), `${name}'s button arms it`).toHaveAttribute('aria-pressed', 'true')

    await tool(page, 'Select').click()
    await zoomOutToOverview(page)
    await designMap(page).focus()
    await page.keyboard.press(key)
    await expectFitted(page, `${name}'s key ${key}`)
    await expect(tool(page, name), `${name}'s key arms it`).toHaveAttribute('aria-pressed', 'true')

    await tool(page, 'Select').click()
    await zoomOutToOverview(page)
  }
})

test('the Design pin is a button that fits the Design', async ({ page }) => {
  await openOverview(page)
  await expect(designPin(page)).toBeVisible()
  await designPin(page).hover()
  await expect(await tooltipOf(designPin(page))).toHaveText('Fit the whole Design on screen')
  await designPin(page).click()
  await expectFitted(page, 'the pin')
  await expect(tool(page, 'Select'), 'the pin arms no tool').toHaveAttribute('aria-pressed', 'true')

  // From the keyboard: the pin leaves with the overview, so the map takes focus and its keys work at once.
  await zoomOutToOverview(page)
  await designPin(page).focus()
  await page.keyboard.press('Enter')
  await expectFitted(page, 'the pin from the keyboard')
  await expect(designMap(page), 'the map has focus').toBeFocused()
})

test('a plant dropped from the catalog on the overview fits the Design, places nothing and stays picked', async ({ page }) => {
  await openOverview(page)
  const undo = page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Undo' })
  await expect(undo).toBeDisabled()

  // Bare map beside the pin (the fixture's origin, so its pin, sits at NEUTRAL in overview).
  const pin = await designPin(page).boundingBox()
  if (!pin) throw new Error('no Design pin')
  const defaultPrevented = await dragPlantOnto(page, { x: pin.x + pin.width + 120, y: pin.y + pin.height / 2 + 120 })

  expect(defaultPrevented, 'the overview takes the drag, so the browser fires the drop').toEqual({ over: true, effect: 'copy', drop: true })
  await expectFitted(page, 'the drop')
  await expect(tool(page, 'Place plants'), 'the drop arms Place plants').toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-tool-card]'), 'the dropped plant stays picked').toContainText('Pear')
  await expect(undo, 'the drop placed nothing').toBeDisabled()
})

test('a plant dragged onto the Design pin is taken as on the map: the Design fits and the plant stays picked', async ({ page }) => {
  await openOverview(page)
  const box = await designPin(page).boundingBox()
  if (!box) throw new Error('no Design pin')
  const defaultPrevented = await dragPlantOnto(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 })

  expect(defaultPrevented, 'the drag over the pin reaches the map, so the browser fires the drop').toEqual({ over: true, effect: 'copy', drop: true })
  await expectFitted(page, 'the drop on the pin')
  await expect(tool(page, 'Place plants'), 'the drop arms Place plants').toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-tool-card]'), 'the dropped plant stays picked').toContainText('Pear')
})

test('an empty Design picked from overview zooms in about the view centre, not the origin', async ({ page }) => {
  await page.goto('')
  await page.locator('[data-start-screen]').getByRole('button', { name: 'New Design' }).first().click()
  await page.locator('[data-site-locate]').getByRole('button', { name: 'Skip, I’ll find it on the map' }).click()
  await expect(overviewNotice(page)).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const host = await mapHost(page).boundingBox()
  if (!host) throw new Error('no map')
  const centre = { x: host.x + host.width / 2, y: host.y + host.height / 2 }
  await expect.poll(() => lastView(page), 'the opening view is remembered').not.toBeNull()
  const opening = (await lastView(page))!

  // A New Design opens with its origin (and pin) at the centre; a left drag beside the pin pans the map.
  const grab = { x: centre.x + 150, y: centre.y + 120 }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x - 200, grab.y - 100, { steps: 10 })
  await page.mouse.up()
  await expect.poll(async () => (await lastView(page))?.lon, 'the pan settled').not.toBe(opening.lon)
  const panned = (await lastView(page))!

  await designMap(page).focus()
  await page.keyboard.press('r')
  await expect(overviewNotice(page), 'the view left overview').toHaveCount(0)
  await expect(tool(page, 'Rectangle zone')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await lastView(page))?.zoom ?? 0, 'the zoom-in settled').toBeGreaterThan(panned.zoom + 4)
  const fitted = (await lastView(page))!
  const fromPanned = Math.hypot(fitted.lon - panned.lon, fitted.lat - panned.lat)
  const panLength = Math.hypot(panned.lon - opening.lon, panned.lat - opening.lat)
  expect(fromPanned, 'the view stays centred where it was').toBeLessThan(panLength / 100)
})

/** The view the Web Edition remembers (settings `last_view`, written once the view settles). */
async function lastView(page: Page): Promise<{ lon: number, lat: number, zoom: number } | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('canopi:web-app-data:v3:settings')
    const view = raw ? (JSON.parse(raw) as { settings?: { last_view?: { lon: number, lat: number, zoom: number } } }).settings?.last_view : null
    return view ?? null
  })
}

/**
 * Drags the catalog's Pear to `at` as the browser does: each drag step's events go to the element under the point (hit
 * testing, so chrome over the map is in the way), dragenter first, a frame between steps. Returns what the page did.
 */
async function dragPlantOnto(page: Page, at: { x: number, y: number }): Promise<{ over: boolean, effect: string, drop: boolean }> {
  const fire = (type: string) => page.evaluate(({ mime, at, type }) => {
    const store = window as unknown as { __e2eDragData?: Map<string, string>, __e2eDropEffect?: string }
    store.__e2eDragData ??= new Map<string, string>([[mime, JSON.stringify({
      canonical_name: 'Pyrus communis', common_name: 'Pear', stratum: 'mid', width_max_m: 3,
    })]])
    const data = store.__e2eDragData
    const dataTransfer = {
      effectAllowed: 'copy',
      get dropEffect() { return store.__e2eDropEffect ?? 'none' },
      set dropEffect(value: string) { store.__e2eDropEffect = value },
      get types() { return Array.from(data.keys()) },
      setData(type: string, value: string) { data.set(type, value) },
      getData(type: string) { return data.get(type) ?? '' },
    }
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      clientX: { value: at.x },
      clientY: { value: at.y },
      dataTransfer: { value: dataTransfer },
    })
    const target = document.elementFromPoint(at.x, at.y)
    if (!target) throw new Error('nothing under the drag')
    if (type === 'dragover') store.__e2eDropEffect = 'none'
    target.dispatchEvent(event)
    return { prevented: event.defaultPrevented, effect: dataTransfer.dropEffect }
  }, { mime: PLANT_STAMP_MIME, at, type })
  await fire('dragenter')
  await nextFrames(page)
  const over = await fire('dragover')
  await nextFrames(page)
  const drop = await fire('drop')
  return { over: over.prevented, effect: over.effect, drop: drop.prevented }
}
