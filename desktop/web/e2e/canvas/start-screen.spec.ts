// The start screen takes every tap (canopi-u85o; plan section 4 "2.0 release close", A12 and Q13). On a narrow window or a
// landscape phone the start screen is one page that scrolls (intro, then Drafts and recent Designs): each of its rows is
// as tall as its content, so the library never lies over the intro's buttons. On a phone the panel sheet's peek stays
// up, and the start screen ends above it through the visible-map-area seam (`--map-inset-bottom` on the map area), so the
// library's own New Design is not under the sheet. Both engines, touch where the layout is a phone. DOM assertions only,
// no baselines.
import type { Page } from '@playwright/test'
import { expectHitAtCentre } from '../support/layout'
import { expect, test } from '../support/offline'

const SIZES = [
  { width: 360, height: 560 },
  { width: 740, height: 360 },
  { width: 844, height: 390 },
  { width: 700, height: 500 },
  { width: 390, height: 844 },
] as const

function startScreen(page: Page) {
  return page.locator('[data-start-screen]')
}

for (const size of SIZES) {
  const name = `${size.width}×${size.height}`
  test.describe(name, () => {
    test.use({ viewport: size, hasTouch: size.width < 900 })

    test(`(canopi-u85o) every start screen button takes a tap at its centre once scrolled into view (${name})`, async ({ page }) => {
      await page.goto('')
      await expect(startScreen(page)).toBeVisible()
      const buttons = startScreen(page).getByRole('button')
      const count = await buttons.count()
      expect(count, 'the start screen shows its buttons').toBeGreaterThan(3)
      for (let index = 0; index < count; index++) {
        const button = buttons.nth(index)
        await button.scrollIntoViewIfNeeded()
        const label = (await button.textContent())?.trim() || `button ${index}`
        await expectHitAtCentre(button, `${label} (${name})`)
      }
    })

    test(`(canopi-u85o) Open asks for a file (${name})`, async ({ page }) => {
      await page.goto('')
      const open = startScreen(page).getByRole('button').filter({ hasText: /\.canopi/ }).first()
      await open.scrollIntoViewIfNeeded()
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), open.click()])
      expect(chooser.isMultiple(), 'Open asks for one file').toBe(false)
    })
  })
}
