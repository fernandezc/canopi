// The window-level tooltip layers (canopi-xpqt). Every button tooltip (components/shared/ButtonTooltip.tsx) is drawn in
// one element on <body> at --z-tooltip (styles/global.css `[data-tooltip-layer]`), above popups, and the canvas hover
// card (canvas/runtime/chrome/hover-tooltip.ts) in another at --z-hover-card (`[data-hover-card-layer]`), under every
// surface the user opens; each is placed from its anchor's window box. A tooltip drawn inside its frame
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

const layers = new Map<string, HTMLElement>()

/** The layer on <body> marked by `attribute`, created at its first use (and again if a test emptied the body). */
function bodyLayer(attribute: 'data-tooltip-layer' | 'data-hover-card-layer'): HTMLElement {
  const known = layers.get(attribute)
  if (known?.isConnected) return known
  let layer = document.body.querySelector<HTMLElement>(`:scope > [${attribute}]`)
  if (!layer) {
    layer = document.createElement('div')
    layer.setAttribute(attribute, '')
    document.body.appendChild(layer)
  }
  layers.set(attribute, layer)
  return layer
}

/** The one tooltip layer on <body>, above popups. */
export function tooltipLayer(): HTMLElement {
  return bodyLayer('data-tooltip-layer')
}

/** The canvas hover card's layer on <body>, under every popup, dialog and full-window surface. */
export function hoverCardLayer(): HTMLElement {
  return bodyLayer('data-hover-card-layer')
}
