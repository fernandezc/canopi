// The window-level tooltip layer (canopi-xpqt). Every button tooltip (components/shared/ButtonTooltip.tsx) and the
// canvas hover card (canvas/runtime/chrome/hover-tooltip.ts) are drawn in one element on <body> at --z-tooltip
// (styles/global.css `[data-tooltip-layer]`), placed from their anchor's window box. A tooltip drawn inside its frame
// is trapped in that frame's stacking context and clipped by its overflow, whatever its own z-index; the stacking
// policy test (src/__tests__/stacking-order.test.ts) keeps every tooltip here. Framework-free, so the canvas runtime
// may use it.

export type TooltipSide = 'left' | 'right' | 'top' | 'bottom'

interface TooltipPlacement {
  /** Window position of the tooltip's top-left corner, in CSS pixels. */
  readonly left: number
  readonly top: number
  /** The side it opens on: the preferred one, or the opposite when only that one has room. */
  readonly side: TooltipSide
}

interface Rect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
interface Size { readonly width: number; readonly height: number }

const OPPOSITE: Readonly<Record<TooltipSide, TooltipSide>> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }

/**
 * Places a tooltip of `size` beside `anchor` on `side`: flips to the opposite side when only that one has room, takes
 * the roomier side when neither has, then shifts along the edge so the whole box is `margin` inside the window. Beside
 * (left, right) it is centred on the anchor; above or below it ends at the anchor's end edge, as bars along the top or
 * bottom of the window want.
 */
export function placeTooltip(
  anchor: Rect,
  size: Size,
  viewport: Size,
  side: TooltipSide,
  { gap = 8, margin = 8 }: { readonly gap?: number; readonly margin?: number } = {},
): TooltipPlacement {
  const room: Record<TooltipSide, number> = {
    left: anchor.left - gap - margin,
    right: viewport.width - margin - anchor.right - gap,
    top: anchor.top - gap - margin,
    bottom: viewport.height - margin - anchor.bottom - gap,
  }
  const need = side === 'left' || side === 'right' ? size.width : size.height
  const opposite = OPPOSITE[side]
  const chosen = room[side] >= need ? side
    : room[opposite] >= need ? opposite
      : room[side] >= room[opposite] ? side : opposite
  let left: number
  let top: number
  if (chosen === 'left' || chosen === 'right') {
    left = chosen === 'right' ? anchor.right + gap : anchor.left - gap - size.width
    top = (anchor.top + anchor.bottom) / 2 - size.height / 2
  } else {
    left = anchor.right - size.width
    top = chosen === 'bottom' ? anchor.bottom + gap : anchor.top - gap - size.height
  }
  return { left: clamp(left, margin, viewport.width - margin - size.width), top: clamp(top, margin, viewport.height - margin - size.height), side: chosen }
}

/** Into [min, max]; a box larger than the window starts at `min`. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

let layer: HTMLElement | null = null

/** The one tooltip layer on <body>, created at the first tooltip (and again if a test emptied the body). */
export function tooltipLayer(): HTMLElement {
  if (layer?.isConnected) return layer
  layer = document.body.querySelector<HTMLElement>(':scope > [data-tooltip-layer]')
  if (!layer) {
    layer = document.createElement('div')
    layer.dataset.tooltipLayer = ''
    document.body.appendChild(layer)
  }
  return layer
}

let watching = false
let keyboardLast = false

/**
 * Whether focus that arrives now is keyboard focus: the engine's `:focus-visible`, or a key press as the last input.
 * WebKit's `:focus-visible` misses focus a script moves on a key (a rail's arrows, a menu closing on Esc), where a
 * keyboard user still wants the button's tooltip. Call `watchInputModality` first.
 */
export function keyboardFocus(element: Element): boolean {
  let visible: boolean
  try {
    visible = element.matches(':focus-visible')
  } catch {
    visible = false
  }
  return visible || keyboardLast
}

/** Starts recording whether the last input was a key or a pointer press (once per page, on the first tooltip). */
export function watchInputModality(): void {
  if (watching) return
  watching = true
  document.addEventListener('keydown', () => { keyboardLast = true }, true)
  document.addEventListener('pointerdown', () => { keyboardLast = false }, true)
}
