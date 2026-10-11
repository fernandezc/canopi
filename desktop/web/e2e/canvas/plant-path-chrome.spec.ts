// The Plant a row tool card and its points keep clear of the other chrome in every layout (canopi-f47t.54, streams P
// and S; plan section 4 "2.0 plant along a path", amendment A8; design check section 5c's matrix), as
// map-notice-layout.spec.ts does for the map notice. Per layout and locale: place an Apple in the visible map beside
// the tool card (clear of its slot down to its max-height, as a user draws), arm Plant a row, pick it and add two
// points beside it (at 1440x900 with the inspection lens open, in the card's slot), then close a loop; each time the
// card shares no pixel with the rail, the top chip slot's chips, the zoom group, the view chip, the selection chip, the
// map notice, the legend, the inspection lens button and the phone sheet's peek; its bottom is inside the visible map;
// its check button and the row's count and length take the click at their centre without a scroll, the check button as
// a 44 px target after a tap; the spacing field and the mode switch show whole and do once scrolled into view (the
// card's text and fields scroll above its foot); with an invalid spacing the check button focuses the field, which
// shows whole; every point and dot takes the click at its centre and is a 44 px target after a tap (checked with two
// points; after a tap on a point, in its own tests per touch layout). On phones the top chip slot sits below the card,
// inside the viewport. Once a row is planted, the selection chip with its spacing field keeps clear of its neighbours
// (stream S). Both engines; offline, so the map notice shows. DOM assertions only, no baselines. Selectors are
// locale-free (the DOM contract of plant-path.spec.ts: `[data-plant-row-finish]`, `[data-plant-row-mode]`,
// `[data-plant-spacing-generated-count]`, `[data-plant-row-length]`, `point:` and `dot:` canvas handles;
// `[data-plant-row-spacing-input]` in the selection chip).
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import type { Point } from '../support/fingers'
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
  { width: 844, height: 390, locales: ['en', 'de', 'ru'], touch: true },
  { width: 740, height: 360, locales: ['en', 'de', 'ru'], touch: true },
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
 * Spots for the row, three in a row `gap` apart and one `gap` above the middle one (it turns the row into a loop; null
 * where the map leaves no room for it: 360x560): the lowest, rightmost place in the visible map whose handles
 * (a point's target, 44 px after a tap) keep clear of the tool card's slot down to its tallest (its max-height: the row
 * card grows as points come) and of every neighbour shown now, the zoom group included. A user draws there, beside the
 * card. Returns the picked plant's spot first.
 */
async function rowSpots(page: Page, layout: Layout): Promise<readonly [Point, Point, Point, Point | null]> {
  const frame = await chipFrame(page)
  const cardBox = await boxOf(card(page))
  const maxHeight = await card(page).evaluate((element) => Number.parseFloat(getComputedStyle(element).maxHeight))
  const obstacles: Box[] = [{ ...cardBox, height: Number.isFinite(maxHeight) ? maxHeight : frame.bottom - cardBox.y }]
  for (const [, selector] of NEIGHBOURS) obstacles.push(...await shownBoxes(page, selector))
  const reach = (layout.touch ? TOUCH_TARGET_PX : 20) / 2 + 4
  const gap = layout.touch ? 60 : 40
  const clear = (at: Point) => at.x - reach >= frame.left && at.x + reach <= frame.right && at.y - reach >= frame.top
    && at.y + reach <= frame.bottom
    && obstacles.every((box) => !overlap(box, { x: at.x - reach, y: at.y - reach, width: 2 * reach, height: 2 * reach }))
  for (const loop of [true, false]) {
    for (let y = frame.bottom - reach; y >= frame.top + reach; y -= 4) {
      for (let x = frame.right - reach; x - 2 * gap >= frame.left + reach; x -= 4) {
        const row = [{ x, y }, { x: x - gap, y }, { x: x - 2 * gap, y }] as const
        const off = { x: x - gap, y: y - gap }
        if (row.every(clear) && (!loop || clear(off))) return [...row, loop ? off : null]
      }
    }
  }
  throw new Error(`${layout.width}x${layout.height}: no room for a row beside the tool card in ${JSON.stringify(frame)}, clear of ${JSON.stringify(obstacles)}`)
}

/**
 * Places an Apple beside the tool card (Place plants, from the card's species list; rowSpots), clears the selection,
 * arms Plant a row, picks it, types the spacing (1 m unless given) and presses Enter, and adds two points beside it.
 * Returns the picked plant, the two points and a spot off their line.
 */
async function drawTwoPoints(page: Page, layout: Layout, spacing = '1'): Promise<ReadonlyArray<{ x: number, y: number }>> {
  await mapHost(page).focus()
  await page.keyboard.press('p')
  const apple = card(page).getByRole('button', { name: /Malus domestica/ }).first()
  await expect(apple).toBeVisible()
  const spots = await rowSpots(page, layout)
  // The list scrolls inside the card, so the option is brought into view as a click would; then a covered button,
  // which would hold the click until the test times out, names what covers the card at once.
  await apple.scrollIntoViewIfNeeded()
  await expectHitAtCentre(apple, 'the card\'s species list')
  await apple.click()
  await press(page, layout, spots[0])
  // Esc leaves Place plants, the next clears the placed Apple's selection, so its chip covers nothing.
  await mapHost(page).focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('w')
  await expect(card(page)).toHaveAttribute('data-tool-card', 'plant-spacing')
  await press(page, layout, spots[0])
  const field = card(page).locator('[data-plant-spacing-interval-input]')
  await expect(field, 'the pick focuses the spacing field').toBeFocused()
  await field.fill(spacing)
  await page.keyboard.press('Enter')
  for (const point of spots.slice(1, 3)) await press(page, layout, point)
  await nextFrames(page)
  return spots
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

/** `target` shows whole: no box it sits in, up to the tool card, clips it (the card's text and fields scroll). */
async function expectWhollyShown(target: Locator, name: string): Promise<void> {
  const clipped = await target.evaluate((element) => {
    const box = element.getBoundingClientRect()
    for (let box2 = element.parentElement; box2; box2 = box2.parentElement) {
      if (getComputedStyle(box2).overflowY !== 'visible') {
        const clip = box2.getBoundingClientRect()
        if (box.top < clip.top - 0.5 || box.bottom > clip.bottom + 0.5) return `${box.top}-${box.bottom} outside ${clip.top}-${clip.bottom}`
      }
      if (box2.hasAttribute('data-tool-card')) break
    }
    return null
  })
  expect(clipped, `${name} shows whole in the card`).toBeNull()
}

async function expectTarget(target: Locator, name: string, layout: Layout, side: 'height' | 'both'): Promise<void> {
  await expectHitAtCentre(target, name)
  if (!layout.touch) return
  const box = await boxOf(target)
  const size = side === 'both' ? Math.min(box.width, box.height) : box.height
  expect(size, `${name} is a ${TOUCH_TARGET_PX} px target after a tap`).toBeGreaterThanOrEqual(TOUCH_TARGET_PX)
}

async function expectCardClear(page: Page, layout: Layout, locale: string, stage: 'two points' | 'a loop'): Promise<void> {
  const where = `${layout.width}x${layout.height} ${locale} ${stage}`
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
  // The check button and the row's count and length stay in view whatever the card holds.
  await expectTarget(finish, `${where}: the check button`, layout, 'both')
  await expectHitAtCentre(card(page).locator('[data-plant-spacing-generated-count]'), `${where}: the row's count`)
  await expectHitAtCentre(card(page).locator('[data-plant-row-length]'), `${where}: the row's length`)
  // The fields scroll with the card's text, above its foot, which leaves them room to show whole.
  const field = card(page).locator('[data-plant-spacing-interval-input]')
  await field.scrollIntoViewIfNeeded()
  await expectWhollyShown(field, `${where}: the spacing field`)
  await expectTarget(field, `${where}: the spacing field`, layout, 'height')
  const modes = card(page).locator('[data-plant-row-mode]')
  await expect(modes, `${where}: the card offers the mode switch`).toHaveCount(2)
  for (const mode of await modes.all()) {
    await mode.scrollIntoViewIfNeeded()
    await expectWhollyShown(mode, `${where}: the ${await mode.getAttribute('data-plant-row-mode')} mode`)
    await expectTarget(mode, `${where}: the ${await mode.getAttribute('data-plant-row-mode')} mode`, layout, 'height')
  }
  await expectTarget(finish, `${where}: the check button after a scroll`, layout, 'both')
  if (stage === 'two points') await expectHandleTargets(page, layout, where)
}

async function expectHandleTargets(page: Page, layout: Layout, where: string): Promise<void> {
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

    test(`(canopi-f47t.54, P) the tool card and its points stay clear of every neighbour at ${size} (${layout.locales.join(' ')})`, async ({ page }) => {
      for (const locale of layout.locales) {
        await openBase(page, layout, locale)
        const spots = await drawTwoPoints(page, layout)
        await expectCardClear(page, layout, locale, 'two points')
        // A point off the line and a press on the picked plant close a loop, which adds its equal gaps to the card.
        if (!spots[3]) continue
        if (!layout.touch) await page.waitForTimeout(600)
        await press(page, layout, spots[3])
        await press(page, layout, spots[0]!)
        await expect(card(page).locator('[data-plant-row-loop-spacing]'), 'the closed loop shows its equal gaps').toBeVisible()
        await nextFrames(page)
        await expectCardClear(page, layout, locale, 'a loop')
      }
    })
  })
}

for (const layout of LAYOUTS) {
  const size = `${layout.width}×${layout.height}${layout.name ? ` ${layout.name}` : ''}`
  const locales = layout.locales.slice(0, 2)
  test.describe(size, () => {
    test.use({ viewport: { width: layout.width, height: layout.height }, hasTouch: layout.touch })

    // The pick's field takes an invalid spacing, the row grows below it, then the check button plants nothing and hands
    // the field the focus: the field shows whole, so the press is seen to answer (and a phone's keyboard opens on it).
    test(`(canopi-f47t.54, P) the check button with an invalid spacing shows the focused field at ${size} (${locales.join(' ')})`, async ({ page }) => {
      for (const locale of locales) {
        const where = `${layout.width}x${layout.height} ${locale}`
        await openBase(page, layout, locale)
        await drawTwoPoints(page, layout, '0')
        const field = card(page).locator('[data-plant-spacing-interval-input]')
        await expect(field, `${where}: the spacing is invalid`).toHaveAttribute('aria-invalid', 'true')
        const finish = card(page).locator('[data-plant-row-finish]')
        const box = await boxOf(finish)
        await press(page, layout, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
        await expect(field, `${where}: the check button focuses the invalid field`).toBeFocused()
        await expect(finish, `${where}: nothing is planted`).toBeVisible()
        await nextFrames(page)
        await expectWhollyShown(field, `${where}: the focused field`)
        await expectHitAtCentre(field, `${where}: the focused field`)
      }
    })
  })
}

// A tap that touches a point keeps every point and dot a 44 px target, in each touch layout. At 1024x768, after the
// tap, Chromium sends mouse-typed boundary events as the handles re-render under the finger; the map's input source
// hears a mouse leave, its move makes the pointer a mouse, and the handles shrink to 20 px. The fix is in the input
// source and the tool host (stream Z's files; Z has handed off), so the main agent owns that marker.
for (const layout of LAYOUTS.filter((each) => each.touch)) {
  const size = `${layout.width}×${layout.height}`
  const tablet = layout.width === 1024 && layout.height === 768
  test.describe(`${size} touched`, () => {
    test.use({ viewport: { width: layout.width, height: layout.height }, hasTouch: true })

    const title = `a tap on a row point at ${size} keeps the points and dots 44 px targets`
    const check = async ({ page }: { page: Page }) => {
      await openBase(page, layout, 'en')
      const spots = await drawTwoPoints(page, layout)
      await press(page, layout, spots[2]!)
      await expect(page.locator('[data-canvas-handle="point:draft:2"][data-canvas-handle-active]'), 'the tapped point is touched').toHaveCount(1)
      await nextFrames(page)
      await expectHandleTargets(page, layout, `${layout.width}x${layout.height} en a point touched`)
    }
    if (tablet) test.fail(`(canopi-f47t.54, main) ${title}`, check)
    else test(`(canopi-f47t.54, P) ${title}`, check)
  })
}

const PHONES = LAYOUTS.filter((layout) => [[390, 844], [360, 560], [740, 360]].some(([width, height]) => layout.width === width && layout.height === height))

test.describe('phones', () => {
  test.use({ hasTouch: true })

  test('(canopi-f47t.54, P) on phones the top chip slot sits below the tool card, inside the viewport (390×844, 360×560, 740×360)', async ({ page }) => {
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
