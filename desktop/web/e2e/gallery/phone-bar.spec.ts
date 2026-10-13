// The Web gallery at phone width shows the phone chrome the app shows (canopi-f47t.54, answers 18 and 22-24): the
// panel sheet's first row is the context bar, which holds the selection and the armed tool's card.
// DOM assertions only, no baselines.
import { expect, openGallery, test } from '../support/gallery'

test.describe('the Web gallery on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('(canopi-f47t.54, D) the fixture\'s selection is the context bar\'s', async ({ page }) => {
    await openGallery(page, { surface: 'workspace', edition: 'web', state: 'populated' })
    await expect(page.locator('[data-phone-context-bar] [data-selection-chip]'), 'the selection chip is the bar\'s').toBeVisible()
  })

  test('(canopi-f47t.54, D) the armed tool\'s card is the context bar\'s', async ({ page }) => {
    await openGallery(page, { surface: 'workspace', edition: 'web', state: 'populated' })
    const tools = page.getByRole('toolbar', { name: 'Tools' })
    await tools.getByRole('button', { name: 'More tools' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Place plants' }).click()
    await expect(page.locator('[data-phone-context-bar] [data-tool-card="plant-stamp"]'), 'Place plants\' card is the bar\'s').toBeVisible()
  })
})
