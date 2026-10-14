// One window-level tooltip layer (canopi-xpqt; design check fixes20-dc-tooltips). Every button tooltip and the canvas
// hover card are drawn in one body-level layer at --z-tooltip, placed from their anchor so the whole box is inside the
// window, and on top of every frame: the blurred rails, the tool card, the dock and the WebGL map. The probe below
// (stream commit 0) checks the engine assumption the layer rests on; the tests after it check each tooltip.
// "On top" is read with elementFromPoint at points inset from the box's rounded corners and at its centre, with the
// tooltip's pointer-events switched on for the read (it takes no pointer otherwise, so elementFromPoint skips it).
// Chromium and WebKit; DOM assertions only, no baselines.
import { fileURLToPath } from 'node:url'
import { boxOf, mapHost, openFixture, type Box } from '../support/layout'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))

test.describe('the body-level layer (probe)', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a fixed body-level box at --z-tooltip paints above the blurred rails, the tool card, the dock and the WebGL map', async ({ page }) => {
    await openFixture(page, FIXTURE)
    await page.locator('[data-panel-rail] [data-panel="layers"]').click()
    const targets: Array<[string, Box]> = [
      ['the tool rail', await boxOf(page.locator('[data-tool-rail]'))],
      ['the tool card', await boxOf(page.locator('[data-tool-card]').first())],
      ['the zoom group', await boxOf(page.locator('[data-zoom-group]'))],
      ['the panel rail', await boxOf(page.locator('[data-panel-rail]'))],
      ['the dock', await boxOf(page.locator('[data-dock-width]'))],
      ['the map', await boxOf(mapHost(page).locator('canvas').first())],
    ]
    const misses = await page.evaluate((boxes) => {
      const layer = document.createElement('div')
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:var(--z-tooltip)'
      document.body.appendChild(layer)
      const found: string[] = []
      for (const [name, box] of boxes) {
        const probe = document.createElement('div')
        const width = Math.min(48, box.width - 4)
        const height = Math.min(28, box.height - 4)
        const left = box.x + box.width / 2 - width / 2
        const top = box.y + box.height / 2 - height / 2
        probe.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;`
          + 'border-radius:var(--radius-md);background:#f00;pointer-events:auto'
        layer.appendChild(probe)
        for (const [x, y] of [[left + 6, top + 6], [left + width - 6, top + height - 6], [left + width / 2, top + height / 2]]) {
          const hit = document.elementFromPoint(x!, y!)
          if (hit !== probe) found.push(`${name} at (${x}, ${y}): ${hit?.tagName}.${hit?.className}`)
        }
      }
      layer.remove()
      return found
    }, targets)
    expect(misses, 'the probe box is on top everywhere').toEqual([])
  })

  test('a disabled button gets pointerenter and pointerleave from a mouse', async ({ page }) => {
    await openFixture(page, FIXTURE)
    await page.evaluate(() => {
      const button = document.createElement('button')
      button.disabled = true
      button.textContent = 'Disabled probe'
      button.style.cssText = 'position:fixed;left:600px;top:400px;width:120px;height:40px;z-index:9999'
      button.dataset.probe = ''
      const seen: string[] = []
      ;(window as unknown as { probeSeen: string[] }).probeSeen = seen
      button.addEventListener('pointerenter', (event) => seen.push(`enter:${event.pointerType}`))
      button.addEventListener('pointerleave', (event) => seen.push(`leave:${event.pointerType}`))
      document.body.appendChild(button)
    })
    await page.mouse.move(100, 100)
    await page.mouse.move(660, 420, { steps: 4 })
    await page.mouse.move(100, 100, { steps: 4 })
    await expect.poll(() => page.evaluate(() => (window as unknown as { probeSeen: string[] }).probeSeen))
      .toEqual(['enter:mouse', 'leave:mouse'])
  })
})
