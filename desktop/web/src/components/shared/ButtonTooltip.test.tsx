import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tooltipOf } from '../../__tests__/support/tooltip'
import { ButtonTooltip } from './ButtonTooltip'

describe('ButtonTooltip', () => {
  let root: HTMLDivElement
  let frames: FrameRequestCallback[]
  const nextFrame = () => act(() => {
    const due = frames
    frames = []
    for (const frame of due) frame(0)
  })

  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame))
    vi.stubGlobal('cancelAnimationFrame', () => { frames = [] })
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    render(null, root)
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('follows its button and hides with it while open, when only layout or CSS moves or hides the button', () => {
    act(() => { render(<button type="button"><ButtonTooltip label="My location" side="top" shown /></button>, root) })
    const button = root.querySelector('button')!
    let box = new DOMRect(300, 500, 44, 44)
    button.getBoundingClientRect = () => box
    nextFrame()
    const tooltip = tooltipOf(button)!
    const placedAt = tooltip.style.top
    expect(tooltip.style.visibility).not.toBe('hidden')

    // The phone sheet is dragged up: the zoom column moves through its CSS top, with no render.
    box = new DOMRect(300, 300, 44, 44)
    nextFrame()
    expect(tooltip.style.top).not.toBe(placedAt)

    // The column has no room and turns visibility: hidden.
    button.style.visibility = 'hidden'
    nextFrame()
    expect(tooltip.style.visibility).toBe('hidden')

    // It is shown again, then laid out with no box (display: none above it).
    button.style.visibility = ''
    nextFrame()
    expect(tooltip.style.visibility).not.toBe('hidden')
    box = new DOMRect(0, 0, 0, 0)
    nextFrame()
    expect(tooltip.style.visibility).toBe('hidden')
  })

  it('stops following once closed', () => {
    act(() => { render(<button type="button"><ButtonTooltip label="Zoom in" shown /></button>, root) })
    act(() => { render(<button type="button"><ButtonTooltip label="Zoom in" /></button>, root) })
    nextFrame()
    expect(frames).toEqual([])
  })
})
