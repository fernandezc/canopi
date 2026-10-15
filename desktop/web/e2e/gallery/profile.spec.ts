// The Site data profile in real engines (canopi-f47t.42, plan section 4, stream D, g5): Profile from the Site data
// toolbar, three clicks and a double-click finish a line and arm Select; the chart draws one path per curve, hovering
// says where, Steepest moves the cursor, × ends the profile;
// Copy values writes tab-separated text in the locale's decimals (the gallery's clipboard stub reads it back); and
// "Profile this line" on a Line zone's canvas menu draws that line's profile (U49 Q29); in Russian the header fits with
// Copied beside the iconed Copy values, down to a 360 px phone's sheet (canopi-vggx). The memory backend samples its
// analytic site, which covers the west of the fixture Design. The gallery runs no canvas key router, so Enter, Backspace
// and the Esc order are checked through the real key path in jsdom (canvas-interaction-e2e.profile.test.ts). DOM
// assertions only, no baselines.
import type { Locator, Page } from '@playwright/test'
import { copiedTexts, expect, openGallery, test } from '../support/gallery'

/**
 * The map, and a point at a fraction of its box. The tool rail covers its left sixth and Site data its right third, so
 * lines run from 22 % to 60 % of the width, across the planting and the analytic site west of it.
 */
async function mapPoints(page: Page, name = 'Design map'): Promise<{ map: Locator, at: (fx: number, fy?: number) => { x: number, y: number } }> {
  const map = page.getByRole('application', { name })
  const box = await map.boundingBox()
  if (!box) throw new Error('no map')
  return { map, at: (fx, fy = 0.5) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy }) }
}

/** Past the recogniser's 500 ms multi-click window, so each point is a first click. */
const PAST_MULTI_CLICK_MS = 600

function tool(page: Page, name: string): Locator {
  return page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: new RegExp(`^${name}( \\(.\\))?$`) })
}

function siteData(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Site data' })
}

function chart(page: Page): Locator {
  return siteData(page).getByRole('region', { name: 'Profile' })
}

/** Arms Profile from the Site data toolbar and clicks `points` in turn, the last one twice (a double-click). */
async function drawProfile(page: Page, points: readonly { x: number, y: number }[]): Promise<void> {
  await siteData(page).getByRole('button', { name: 'Profile', exact: true }).click()
  await expect(page.getByText('Click to add points. Double-click or press Enter to finish.')).toBeVisible()
  for (const point of points.slice(0, -1)) {
    await page.mouse.click(point.x, point.y)
    await page.waitForTimeout(PAST_MULTI_CLICK_MS)
  }
  const last = points[points.length - 1]!
  await page.mouse.dblclick(last.x, last.y)
}

test.describe('Profile (g5)', () => {
  test('three clicks and a double-click draw a profile and arm Select; hovering says where, Steepest moves the cursor', async ({ page }) => {
    await openGallery(page, { surface: 'site-data' })
    const { at } = await mapPoints(page)

    await drawProfile(page, [at(0.22), at(0.4, 0.45), at(0.6)])

    await expect(tool(page, 'Select')).toHaveAttribute('aria-pressed', 'true')
    const profile = chart(page)
    await expect(profile.getByRole('heading', { name: 'Profile' })).toBeVisible()
    const legend = profile.getByRole('listitem')
    await expect(legend.first()).toContainText('IGN ground elevation')
    // One path per curve.
    await expect(profile.locator(':scope > svg path')).toHaveCount(await legend.count())
    await expect(legend.first()).toContainText(/Rise [+−-]?\d/)
    // Every axis label shows whole: none is cut by the SVG's box, and none leaves the chart.
    const clipped = await profile.evaluate((section) => {
      const svg = section.querySelector(':scope > svg')!
      const box = section.getBoundingClientRect()
      return {
        overflow: getComputedStyle(svg).overflow,
        outside: Array.from(svg.querySelectorAll('text')).filter((text) => {
          const rect = text.getBoundingClientRect()
          return rect.left < box.left || rect.right > box.right
        }).map((text) => text.textContent),
      }
    })
    expect(clipped).toEqual({ overflow: 'visible', outside: [] })

    const plot = await profile.locator(':scope > svg').boundingBox()
    if (!plot) throw new Error('no plot')
    await page.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.3)
    await expect(profile.getByText(/^At \d/)).toBeVisible()
    await page.mouse.move(plot.x + plot.width * 0.5, plot.y - 40)
    await expect(profile.getByText(/^At \d/)).toHaveCount(0)

    await profile.getByRole('button', { name: /^Steepest / }).first().click()
    await expect(profile.getByText(/^At \d/)).toBeVisible()

    await profile.getByRole('button', { name: 'Close profile' }).click()
    await expect(chart(page)).toHaveCount(0)
  })

  test('Copy values copies tab-separated text in the locale\'s decimals', async ({ page }) => {
    await openGallery(page, { surface: 'site-data', locale: 'fr' })
    const { at } = await mapPoints(page, 'Carte du Design')
    const panel = page.locator('aside').filter({ has: page.getByRole('button', { name: 'Profil', exact: true }) })
    await panel.getByRole('button', { name: 'Profil', exact: true }).click()
    await page.mouse.click(at(0.22).x, at(0.22).y)
    await page.waitForTimeout(PAST_MULTI_CLICK_MS)
    await page.mouse.dblclick(at(0.6).x, at(0.6).y)

    await panel.getByRole('button', { name: 'Copier les valeurs' }).click()
    await expect(panel.getByText('Copié')).toBeVisible()
    const [text] = (await copiedTexts(page)).slice(-1)
    const lines = text!.trimEnd().split('\n')
    expect(lines[0]).toMatch(/^Distance \(m\)\tLongitude\tLatitude\tIGN ground elevation \(m\)/)
    const first = lines[1]!.split('\t')
    expect(first[0]).toBe('0,00')
    expect(first[1]).toMatch(/^\d+,\d{7}$/)
    expect(first[2]).toMatch(/^\d+,\d{7}$/)
    expect(lines.slice(1).some((line) => /\t\d+,\d{2}(\t|$)/.test(line)), 'some value in the locale\'s decimals').toBe(true)
  })

  test('in Russian the header fits with Copied beside the iconed Copy values, down to a 360 px phone\'s sheet, and keeps its height while scrubbing (canopi-vggx)', async ({ page }) => {
    await openGallery(page, { surface: 'site-data', locale: 'ru' })
    const { at } = await mapPoints(page, 'Карта проекта')
    const panel = page.locator('aside').filter({ has: page.getByRole('button', { name: 'Профиль', exact: true }) })
    await panel.getByRole('button', { name: 'Профиль', exact: true }).click()
    await page.mouse.click(at(0.22).x, at(0.22).y)
    await page.waitForTimeout(PAST_MULTI_CLICK_MS)
    await page.mouse.dblclick(at(0.6).x, at(0.6).y)

    const copy = panel.getByRole('button', { name: 'Копировать значения', exact: true })
    await expect(copy.locator('svg')).toHaveAttribute('width', '16')
    const plot = panel.getByRole('region', { name: 'Профиль' }).locator(':scope > svg')
    const cursorAt = panel.getByText(/^На \d/)
    // The header's row at the desktop panel, then at the panel a phone's sheet leaves (390 and 360 px viewports, less
    // the sheet's padding and border), with Copied showing: nothing overflows it, the button's label is never cut, every
    // control ends inside the row, and scrubbing the plots (which adds "На …") keeps the row's height, so the plots
    // never move under the finger.
    const measure = (asideWidth: number | null) => copy.evaluate((button, width) => {
      const aside = button.closest('aside')!
      if (width !== null) {
        aside.style.width = `${width}px`
        aside.style.flex = 'none'
      }
      const header = button.parentElement!
      const row = header.getBoundingClientRect()
      return {
        width,
        height: Math.round(row.height),
        header: header.scrollWidth <= header.clientWidth,
        label: button.scrollWidth <= button.clientWidth,
        outside: Array.from(header.children).filter((child) => {
          const rect = child.getBoundingClientRect()
          return rect.width > 0 && (rect.left < row.left - 0.5 || rect.right > row.right + 0.5)
        }).map((child) => child.textContent || child.getAttribute('aria-label')),
      }
    }, asideWidth)
    for (const width of [null, 372, 342]) {
      await measure(width)
      await copy.click()
      await expect(panel.getByText('Скопировано')).toBeVisible()
      const still = await measure(width)
      expect({ ...still, height: 0 }).toEqual({ width, height: 0, header: true, label: true, outside: [] })
      const box = await plot.boundingBox()
      if (!box) throw new Error('no plot')
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3)
      // "На …" is in the header (cut to its room, which beside Copied on a phone may be none).
      await expect(cursorAt).toHaveCount(1)
      await expect(panel.getByText('Скопировано')).toBeVisible()
      expect(await measure(width)).toEqual(still)
      // Copied clears before the next width, so each copy shows it afresh.
      await expect(panel.getByText('Скопировано')).toHaveCount(0)
    }
  })

  test('Profile this line on a Line zone\'s menu draws that line\'s profile', async ({ page }) => {
    await openGallery(page, { surface: 'site-data' })
    const { at } = await mapPoints(page)
    // Without snapping the line lies exactly where it was dragged, so the right-click finds it.
    const snap = page.getByRole('button', { name: 'Snap to grid' })
    await snap.click()
    await expect(snap).toHaveAttribute('aria-pressed', 'false')
    await tool(page, 'Line zone').click()
    const [from, to] = [at(0.22, 0.62), at(0.6, 0.62)]
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
    await expect(chart(page)).toHaveCount(0)

    // With Select armed, a right-click on the line (off the length chip at its middle and the fixture's lavender on it
    // near 30 %, whose plant menu would open instead) opens its menu.
    await tool(page, 'Select').click()
    await page.mouse.click(at(0.25, 0.62).x, at(0.25, 0.62).y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Profile this line' }).click()

    await expect(chart(page).getByRole('listitem').first()).toContainText('IGN ground elevation')
  })
})
