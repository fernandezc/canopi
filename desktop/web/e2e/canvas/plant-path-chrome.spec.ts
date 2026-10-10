// The Plant a row tool card and its points keep clear of the other chrome in every layout (canopi-f47t.54, streams P
// and S; plan section 4 "2.0 plant along a path", amendment A8; design check section 5c's matrix), as
// map-notice-layout.spec.ts does for the map notice. Per layout and locale: place an Apple at the centre of the visible
// map, arm Plant a row, pick it and add two points (at 1440x900 with the inspection lens open, in the card's slot); the
// card then shares no pixel with the rail, the top chip slot's chips, the zoom group, the view chip, the selection
// chip, the map notice, the legend, the inspection lens button and the phone sheet's peek; its bottom is inside the
// visible map; its check button, spacing field and mode switch take the click at their centre and are 44 px targets
// after a tap; every point and dot takes the click at its centre and is a 44 px target after a tap. On phones the top
// chip slot sits below the card, inside the viewport. Once a row is planted, the selection chip with its spacing field
// keeps clear of its neighbours (stream S). Both engines; offline, so the map notice shows. DOM assertions only, no
// baselines. Selectors are locale-free (the DOM contract of plant-path.spec.ts: `[data-plant-row-finish]`,
// `[data-plant-row-mode]`, `point:` and `dot:` canvas handles; `[data-plant-row-spacing-input]` in the selection chip).
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { boxOf, chipFrame, expectHitAtCentre, mapHost, nextFrames, openFixture, overlap, type Box } from '../support/layout'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))
const TOUCH_TARGET_PX = 44

interface Layout {
  readonly width: number
  readonly height: number
  readonly locales: readonly string[]
  readonly touch: boolean
  /** The labelled tool rail (1440x900 named rail) instead of icons. */
  readonly namedRail?: boolean
  /** The inspection lens is open first: it shares the card's slot, and the card stacks above it (design check 5c). */
  readonly lensOpen?: boolean
  readonly name?: string
}

const LAYOUTS: readonly Layout[] = [
  { width: 1440, height: 900, locales: ['en', 'de', 'fr', 'ru', 'ja'], touch: false, lensOpen: true, name: 'icon rail' },
  { width: 1440, height: 900, locales: ['en', 'de'], touch: false, namedRail: true, lensOpen: true, name: 'named rail' },
  { width: 1024, height: 768, locales: ['en', 'de', 'ru'], touch: true },
  { width: 768, height: 1024, locales: ['en', 'fr'], touch: false },
  { width: 761, height: 700, locales: ['en', 'de', 'ru'], touch: false },
  { width: 700, height: 500, locales: ['en', 'de', 'ru'], touch: false },
  { width: 390, height: 844, locales: ['en', 'de', 'fr', 'ru', 'ja'], touch: true },
  { width: 360, height: 560, locales: ['en', 'de', 'ru'], touch: true },
  { width: 844, height: 390, locales: ['en', 'de'], touch: true },
  { width: 740, height: 360, locales: ['en', 'de'], touch: true },
]

/** The card's neighbours; an element that is absent or has no area is not one. */
const NEIGHBOURS: ReadonlyArray<readonly [string, string]> = [
  ['the tool rail', '[data-tool-rail]'],
  ['the top chip slot\'s chips', '[data-top-chip-slot] > *'],
  ['the zoom group', '[data-zoom-group]'],
  ['the view chip', '[data-view-chip]'],
  ['the selection chip', '[data-selection-chip]'],
  ['the map notice', '[data-map-notice]'],
  ['the legend', '[data-pinned-plant-name-legend]'],
  ['the inspection lens button', '[data-inspection-launcher]'],
  ['the phone sheet\'s peek', '[data-phone-sheet]'],
]

function card(page: Page): Locator {
  return page.locator('[data-tool-card]')
}

async function openBase(page: Page, layout: Layout, locale: string): Promise<void> {
  await openFixture(page, FIXTURE, {
    locale,
    settings: { snap_to_grid: false, tool_names_visible: layout.namedRail === true },
    // The start screen's library covers its open button in the landscape phone layouts.
    openWith: 'shortcut',
  })
  if (!layout.lensOpen) return
  const launcher = page.locator('[data-inspection-launcher]')
  await launcher.click()
  await expect(launcher, 'the inspection lens is open').toBeHidden()
}

/** A tap where the layout is touch (apart in time, so taps never make a double tap), else a click. */
async function press(page: Page, layout: Layout, at: { x: number, y: number }): Promise<void> {
  if (layout.touch) {
    await page.touchscreen.tap(at.x, at.y)
    await page.waitForTimeout(600)
  } else {
    await page.mouse.click(at.x, at.y)
  }
}

/**
 * Places an Apple at the centre of the visible map (Place plants, from the card's species list), arms Plant a row, picks
 * it, keeps the spacing with Enter and adds two points to the right of it. Returns the picked plant and the two points.
 */
async function drawTwoPoints(page: Page, layout: Layout): Promise<ReadonlyArray<{ x: number, y: number }>> {
  const frame = await chipFrame(page)
  const half = { x: (frame.right - frame.left) / 2, y: (frame.bottom - frame.top) / 2 }
  const centre = { x: frame.left + half.x, y: frame.top + half.y }
  await mapHost(page).focus()
  await page.keyboard.press('p')
  const apple = card(page).getByRole('button', { name: /Malus domestica/ }).first()
  await expect(apple).toBeVisible()
  // A covered button would hold the click until the test times out; this names what covers the card at once.
  await expectHitAtCentre(apple, 'the card\'s species list')
  await apple.click()
  await press(page, layout, centre)
  await mapHost(page).focus()
  await page.keyboard.press('w')
  await expect(card(page)).toHaveAttribute('data-tool-card', 'plant-spacing')
  await press(page, layout, centre)
  const field = card(page).locator('[data-plant-spacing-interval-input]')
  await expect(field, 'the pick focuses the spacing field').toBeFocused()
  await field.fill('1')
  await page.keyboard.press('Enter')
  const points = [
    { x: centre.x + half.x * 0.25, y: centre.y + half.y * 0.1 },
    { x: centre.x + half.x * 0.5, y: centre.y - half.y * 0.2 },
  ]
  for (const point of points) await press(page, layout, point)
  await nextFrames(page)
  return [centre, ...points]
}

async function shownBoxes(page: Page, selector: string): Promise<Box[]> {
  const boxes = await page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const shown = style.visibility !== 'hidden' && style.display !== 'none' && Number.parseFloat(style.opacity) > 0
    return shown ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
  }))
  return boxes.filter((box): box is Box => box !== null && box.width > 0 && box.height > 0)
}

async function expectTarget(target: Locator, name: string, layout: Layout, side: 'height' | 'both'): Promise<void> {
  await expectHitAtCentre(target, name)
  if (!layout.touch) return
  const box = await boxOf(target)
  const size = side === 'both' ? Math.min(box.width, box.height) : box.height
  expect(size, `${name} is a ${TOUCH_TARGET_PX} px target after a tap`).toBeGreaterThanOrEqual(TOUCH_TARGET_PX)
}

async function expectCardClear(page: Page, layout: Layout, locale: string): Promise<void> {
  const where = `${layout.width}x${layout.height} ${locale}`
  const cardBox = await boxOf(card(page))
  for (const [name, selector] of NEIGHBOURS) {
    for (const box of await shownBoxes(page, selector)) {
      expect(overlap(cardBox, box), `${where}: the tool card clears ${name}`).toBe(false)
    }
  }
  const frame = await chipFrame(page)
  expect(cardBox.y + cardBox.height, `${where}: the card's bottom is inside the visible map`).toBeLessThanOrEqual(frame.bottom + 0.5)
  const finish = card(page).locator('[data-plant-row-finish]')
  await expect(finish, `${where}: two points show the check button`).toBeVisible()
  await expectTarget(finish, 'the check button', layout, 'both')
  await expectTarget(card(page).locator('[data-plant-spacing-interval-input]'), 'the spacing field', layout, 'height')
  const modes = card(page).locator('[data-plant-row-mode]')
  await expect(modes, `${where}: the card offers the mode switch`).toHaveCount(2)
  for (const mode of await modes.all()) await expectTarget(mode, `the ${await mode.getAttribute('data-plant-row-mode')} mode`, layout, 'height')
  const handles = page.locator('[data-canvas-handle^="point:"], [data-canvas-handle^="dot:"]')
  expect(await handles.count(), `${where}: the points are shown`).toBeGreaterThanOrEqual(3)
  for (const handle of await handles.all()) {
    await expectTarget(handle, `${where}: handle ${await handle.getAttribute('data-canvas-handle')}`, layout, 'both')
  }
}

for (const layout of LAYOUTS) {
  const size = `${layout.width}×${layout.height}${layout.name ? ` ${layout.name}` : ''}`
  test.describe(size, () => {
    test.use({ viewport: { width: layout.width, height: layout.height }, hasTouch: layout.touch })

    test.fail(`(canopi-f47t.54, P) the tool card and its points stay clear of every neighbour at ${size} (${layout.locales.join(' ')})`, async ({ page }) => {
      for (const locale of layout.locales) {
        await openBase(page, layout, locale)
        await drawTwoPoints(page, layout)
        await expectCardClear(page, layout, locale)
      }
    })
  })
}

const PHONES = LAYOUTS.filter((layout) => [[390, 844], [360, 560], [740, 360]].some(([width, height]) => layout.width === width && layout.height === height))

test.describe('phones', () => {
  test.use({ hasTouch: true })

  test.fail('(canopi-f47t.54, P) on phones the top chip slot sits below the tool card, inside the viewport (390×844, 360×560, 740×360)', async ({ page }) => {
    for (const layout of PHONES) {
      const where = `${layout.width}x${layout.height}`
      await page.setViewportSize({ width: layout.width, height: layout.height })
      await openBase(page, layout, 'en')
      await drawTwoPoints(page, layout)
      const cardBox = await boxOf(card(page))
      const slot = await boxOf(page.locator('[data-top-chip-slot]'))
      expect(slot.y, `${where}: the top chip slot sits below the card`).toBeGreaterThanOrEqual(cardBox.y + cardBox.height)
      expect(slot.x, `${where}: the slot starts inside the viewport`).toBeGreaterThanOrEqual(0)
      expect(slot.x + slot.width, `${where}: the slot ends inside the viewport`).toBeLessThanOrEqual(layout.width)
      expect(slot.y, `${where}: the slot is above the viewport's bottom`).toBeLessThan(layout.height)
    }
  })
})

const CHIP_LAYOUTS: readonly Layout[] = [
  ...PHONES.map((layout) => ({ ...layout, locales: ['en', 'de', 'ru'] })),
  { width: 1024, height: 768, locales: ['en', 'de', 'ru'], touch: false },
]

test.fail('(canopi-f47t.54, S) the selection chip with a row\'s spacing field stays clear of its neighbours at 390×844, 360×560, 740×360 and 1024×768 (en de ru)', async ({ page }) => {
  for (const layout of CHIP_LAYOUTS) {
    for (const locale of layout.locales) {
      const where = `${layout.width}x${layout.height} ${locale}`
      await page.setViewportSize({ width: layout.width, height: layout.height })
      await openBase(page, { ...layout, touch: false }, locale)
      await drawTwoPoints(page, { ...layout, touch: false })
      await page.keyboard.press('Enter')
      const chip = page.locator('[data-selection-chip]')
      const spacing = chip.locator('[data-plant-row-spacing-input]')
      await expect(spacing, `${where}: the planted row is selected with its spacing field`).toBeVisible()
      await nextFrames(page)
      const chipBox = await boxOf(chip)
      for (const [name, selector] of [...NEIGHBOURS.filter(([, selector]) => selector !== '[data-selection-chip]'), ['the tool card', '[data-tool-card]'] as const]) {
        for (const box of await shownBoxes(page, selector)) {
          expect(overlap(chipBox, box), `${where}: the selection chip clears ${name}`).toBe(false)
        }
      }
      expect(chipBox.x, `${where}: the chip starts inside the viewport`).toBeGreaterThanOrEqual(0)
      expect(chipBox.x + chipBox.width, `${where}: the chip ends inside the viewport`).toBeLessThanOrEqual(layout.width)
      await expectHitAtCentre(spacing, `${where}: the row's spacing field`)
      for (const mode of await chip.locator('[data-plant-row-mode]').all()) await expectHitAtCentre(mode, `${where}: the row's mode switch`)
    }
  }
})
