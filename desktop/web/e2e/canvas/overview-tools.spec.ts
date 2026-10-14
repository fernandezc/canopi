// Tools in overview (canopi-n2cg; ADR 0015 and 0018, amended 2026-10-14): zoomed out past 0.1 px/m every tool stays
// enabled; picking a drawing tool by its rail button or its key fits the Design, as Fit to Design does, then arms it;
// the Design pin is a button that fits the Design; a plant dragged from the catalog onto the overview fits the Design,
// places nothing and stays picked for Place plants; an empty Design zooms in about the view centre, not the origin.
// Both engines, DOM assertions only. The e2e catalog is always 404 (support/offline.ts), so the drop is a synthetic
// dragover and drop carrying the catalog's drag data.
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { designMap } from '../support/canvas'
import { mapHost, nextFrames, openFixture } from '../support/layout'
import { expect, test } from '../support/offline'

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
  await expect(designPin(page).getByRole('tooltip')).toHaveText('Fit the whole Design on screen')
  await designPin(page).click()
  await expectFitted(page, 'the pin')
  await expect(tool(page, 'Select'), 'the pin arms no tool').toHaveAttribute('aria-pressed', 'true')
})

test('a plant dropped from the catalog on the overview fits the Design, places nothing and stays picked', async ({ page }) => {
  await openOverview(page)
  const undo = page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Undo' })
  await expect(undo).toBeDisabled()

  const defaultPrevented = await mapHost(page).evaluate((host, { mime, at }) => {
    const data = new Map<string, string>([[mime, JSON.stringify({
      canonical_name: 'Pyrus communis', common_name: 'Pear', stratum: 'mid', width_max_m: 3,
    })]])
    const dataTransfer = {
      effectAllowed: 'copy',
      dropEffect: 'none',
      get types() { return Array.from(data.keys()) },
      setData(type: string, value: string) { data.set(type, value) },
      getData(type: string) { return data.get(type) ?? '' },
    }
    const fire = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, {
        clientX: { value: at.x },
        clientY: { value: at.y },
        dataTransfer: { value: dataTransfer },
      })
      host.dispatchEvent(event)
      return event
    }
    const over = fire('dragover')
    const effect = dataTransfer.dropEffect
    const drop = fire('drop')
    return { over: over.defaultPrevented, effect, drop: drop.defaultPrevented }
  }, { mime: PLANT_STAMP_MIME, at: NEUTRAL })

  expect(defaultPrevented, 'the overview takes the drag, so the browser fires the drop').toEqual({ over: true, effect: 'copy', drop: true })
  await expectFitted(page, 'the drop')
  await expect(tool(page, 'Place plants'), 'the drop arms Place plants').toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-tool-card]'), 'the dropped plant stays picked').toContainText('Pear')
  await expect(undo, 'the drop placed nothing').toBeDisabled()
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
