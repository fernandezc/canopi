// Reads a ButtonTooltip the way a user sees it: it shows in the window-level tooltip layer (utils/tooltip-layer.ts),
// not inside its button, while a mouse hovers the button, keyboard focus is on it, or a tap asked for its reason.
import { act } from 'preact/test-utils'

/** The tooltip `button` shows now, or null. */
export function tooltipOf(button: Element): HTMLElement | null {
  const id = button.querySelector('[data-tooltip-anchor]')?.getAttribute('data-tooltip-anchor')
  if (!id) return null
  return Array.from(document.querySelectorAll<HTMLElement>('[data-tooltip-layer] [data-tooltip-for]'))
    .find((tooltip) => tooltip.dataset.tooltipFor === id) ?? null
}

/** A copy of the tooltip `button` shows while a mouse hovers it, or null when it shows none; the hover then ends. */
export function hoveredTooltip(button: Element): HTMLElement | null {
  act(() => { button.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' })) })
  const shown = tooltipOf(button)
  const copy = shown ? shown.cloneNode(true) as HTMLElement : null
  act(() => { button.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' })) })
  return copy
}
