import { afterEach, describe, expect, it } from 'vitest'
import { placeTooltip, tooltipLayer } from './tooltip-layer'

const WINDOW = { width: 1000, height: 800 }
const TIP = { width: 120, height: 30 }
const box = (left: number, top: number, width = 40, height = 40) => ({ left, top, right: left + width, bottom: top + height })

describe('placeTooltip', () => {
  it('opens on the preferred side when it has room: beside, centred on the button', () => {
    expect(placeTooltip(box(100, 300), TIP, WINDOW, 'right')).toEqual({ left: 148, top: 305, side: 'right' })
    expect(placeTooltip(box(500, 300), TIP, WINDOW, 'left')).toEqual({ left: 372, top: 305, side: 'left' })
  })

  it('opens above or below ending at the button\'s end edge', () => {
    expect(placeTooltip(box(500, 300), TIP, WINDOW, 'top')).toEqual({ left: 420, top: 262, side: 'top' })
    expect(placeTooltip(box(500, 300), TIP, WINDOW, 'bottom')).toEqual({ left: 420, top: 348, side: 'bottom' })
  })

  it('flips to the opposite side when only that one has room', () => {
    // A panel rail button at the window's right edge asking for the right.
    expect(placeTooltip(box(950, 300), TIP, WINDOW, 'right').side).toBe('left')
    expect(placeTooltip(box(20, 300), TIP, WINDOW, 'left').side).toBe('right')
    // A bottom-row map control asking for below; a top bar button asking for above.
    expect(placeTooltip(box(500, 750), TIP, WINDOW, 'bottom').side).toBe('top')
    expect(placeTooltip(box(500, 10), TIP, WINDOW, 'top')).toMatchObject({ side: 'bottom', top: 58 })
  })

  it('takes the roomier side when neither has room, and still ends inside the window', () => {
    const wide = { width: 600, height: 30 }
    const placed = placeTooltip(box(380, 300), wide, WINDOW, 'left')
    expect(placed.side).toBe('right')
    expect(placed.left).toBe(WINDOW.width - 8 - wide.width)
  })

  it('shifts along the edge so the whole box is inside the window', () => {
    // A phone's top-left Menu button: below it, ending at its end edge, would run past the window's start.
    expect(placeTooltip(box(4, 4, 44, 44), { width: 200, height: 30 }, { width: 390, height: 844 }, 'bottom'))
      .toEqual({ left: 8, top: 56, side: 'bottom' })
    // A tool strip button at the top: centring would run above the window.
    expect(placeTooltip(box(10, 0, 40, 20), { width: 100, height: 60 }, WINDOW, 'right').top).toBe(8)
    // The bottom-right map control's tall tooltip.
    expect(placeTooltip(box(960, 760), { width: 200, height: 120 }, WINDOW, 'top')).toEqual({ left: 792, top: 632, side: 'top' })
  })

  it('keeps a box wider than a phone window at its start margin', () => {
    expect(placeTooltip(box(100, 100), { width: 500, height: 30 }, { width: 390, height: 844 }, 'top').left).toBe(8)
  })
})

describe('tooltipLayer', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('is one element on <body>, made at the first call and again after the body was emptied', () => {
    const layer = tooltipLayer()
    expect(layer.parentElement).toBe(document.body)
    expect(layer.hasAttribute('data-tooltip-layer')).toBe(true)
    expect(tooltipLayer()).toBe(layer)
    document.body.innerHTML = ''
    const again = tooltipLayer()
    expect(again).not.toBe(layer)
    expect(document.querySelectorAll('[data-tooltip-layer]')).toHaveLength(1)
  })
})
