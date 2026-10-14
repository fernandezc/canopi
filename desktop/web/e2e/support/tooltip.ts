// A button's tooltip as a user sees it: drawn in the window-level tooltip layer (src/utils/tooltip-layer.ts), not
// inside its button; ButtonTooltip ties the two with data-tooltip-anchor and data-tooltip-for.
import type { Locator } from '@playwright/test'

/** The tooltip `button` shows (absent while it shows none). */
export async function tooltipOf(button: Locator): Promise<Locator> {
  const id = await button.locator('[data-tooltip-anchor]').getAttribute('data-tooltip-anchor')
  if (!id) throw new Error('the button has no ButtonTooltip')
  return button.page().locator(`[data-tooltip-layer] [data-tooltip-for="${id}"]`)
}
