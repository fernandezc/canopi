import { signal } from '@preact/signals'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createViewReadSurface } from '../canvas/runtime/view/frame-source'
import type { ViewReadSurface } from '../canvas/runtime/view/read-surface'
import type { ScreenPoint } from '../canvas/runtime/view/types'
import { createSessionPlane } from '../canvas/session-plane'
import { setCurrentCanvasSession } from '../canvas/session'
import { createTestCanvasCommandSurface, createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface, createTestViewReadSurface } from './support/canvas-query-surface'
import { createTestView, type TestView } from './support/test-view'

import { focusOwner } from '../app/keyboard/focus-owner'
import { CanvasOverview, OverviewNotice } from '../components/canvas/CanvasOverview'

describe('CanvasOverview', () => {
  let container: HTMLDivElement
  let testView: TestView | null = null

  /** The view of a 400 x 300 map placed as today's viewport { x, y, scale }. */
  function overviewView(viewport: { x?: number; y?: number } = {}): ViewReadSurface {
    const plane = createSessionPlane({ lon: 0, lat: 0 })
    testView = createTestView({ plane, viewport: { x: 200, y: 150, scale: 0.01, ...viewport } })
    return createViewReadSurface(testView.frames)
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
    testView?.dispose()
    testView = null
  })

  it('shows the Design as a named pin button and offers Return to Design, both fitting the Design', async () => {
    const returnToDesign = vi.fn()
    const focusMap = vi.spyOn(focusOwner, 'focusMap').mockImplementation(() => {})
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), view: overviewView() },
      commands: createTestCanvasCommandSurface({ viewport: { returnToDesign } }),
    }))

    await act(async () => render(<><OverviewNotice /><CanvasOverview /></>, container))
    const notice = container.querySelector('[data-overview-notice]')!
    expect(notice.getAttribute('role')).toBe('status')
    expect(notice.textContent).toContain('Zoom in to edit. Plants are hidden at this scale.')
    const returnButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Return to Design')!
    returnButton.click()
    expect(returnToDesign).toHaveBeenCalledOnce()
    // The button leaves with the overview, so the map takes focus and its keys work at once.
    expect(focusMap).toHaveBeenCalledOnce()

    // The pin is a button that fits the Design, named for it, with a tooltip saying so (canopi-n2cg).
    const pin = container.querySelector<HTMLButtonElement>('[data-overview-pin]')!
    expect(pin.tagName).toBe('BUTTON')
    expect(pin.type).toBe('button')
    expect(pin.getAttribute('aria-label')).toMatch(/^Go to Design: /)
    expect(pin.style.left).toBe('200px')
    pin.click()
    expect(returnToDesign).toHaveBeenCalledTimes(2)
    expect(focusMap, 'the pin leaves with the overview: the map takes focus').toHaveBeenCalledTimes(2)
    focusMap.mockRestore()
  })

  it('lets every gesture through to the map: a still press on the pin fits the Design, a drag from it does not', async () => {
    const returnToDesign = vi.fn()
    const focusMap = vi.spyOn(focusOwner, 'focusMap').mockImplementation(() => {})
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), view: overviewView() },
      commands: createTestCanvasCommandSurface({ viewport: { returnToDesign } }),
    }))
    await act(async () => render(<CanvasOverview />, container))
    const pin = container.querySelector<HTMLElement>('[data-overview-pin]')!
    vi.spyOn(pin, 'getBoundingClientRect').mockReturnValue(new DOMRect(190, 140, 120, 32))
    // The map host the pointer lands on (the pin itself takes no pointer events), and a control drawn over the pin's box.
    const map = document.createElement('div')
    map.setAttribute('role', 'application')
    const control = document.createElement('button')
    container.append(map, control)
    const pointer = (type: string, x: number, y: number, init: PointerEventInit = {}, target: Element = map): void => {
      act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, ...init })) })
    }

    // A mouse over the pin's box shows its tooltip although the pin takes no pointer events itself.
    pointer('pointermove', 250, 150, { buttons: 0 })
    expect(document.querySelector('[data-tooltip-layer] [role="tooltip"]')?.textContent).toBe('Fit the whole Design on screen')
    pointer('pointermove', 400, 150, { buttons: 0 })
    expect(document.querySelector('[data-tooltip-layer] [role="tooltip"]')).toBeNull()

    // A drag that starts on the pin is the map's pan: it fits nothing.
    pointer('pointerdown', 250, 150, { buttons: 1 })
    pointer('pointermove', 300, 180, { buttons: 1 })
    pointer('pointerup', 300, 180)
    expect(returnToDesign).not.toHaveBeenCalled()

    // A press on chrome over the pin's box is that chrome's.
    pointer('pointerdown', 250, 150, { buttons: 1 }, control)
    pointer('pointerup', 250, 150, {}, control)
    expect(returnToDesign).not.toHaveBeenCalled()

    // A press beside the pin fits nothing either.
    pointer('pointerdown', 400, 150, { buttons: 1 })
    pointer('pointerup', 400, 150)
    expect(returnToDesign).not.toHaveBeenCalled()

    // A still press on the pin (within the slop) is a tap: the Design fits and the map takes focus.
    pointer('pointerdown', 250, 150, { buttons: 1 })
    pointer('pointermove', 251, 151, { buttons: 1 })
    pointer('pointerup', 251, 151)
    expect(returnToDesign).toHaveBeenCalledOnce()
    expect(focusMap).toHaveBeenCalledOnce()

    // A pointer's click never reaches the pin (the map has the pointer); the keyboard's (detail 0) fits.
    act(() => { pin.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
    expect(returnToDesign).toHaveBeenCalledOnce()
    pin.click()
    expect(returnToDesign).toHaveBeenCalledTimes(2)
    focusMap.mockRestore()
  })

  it('omits an offscreen marker while retaining the notice action', async () => {
    const returnToDesign = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), view: overviewView({ x: -100 }) },
      commands: createTestCanvasCommandSurface({ viewport: { returnToDesign } }),
    }))

    await act(async () => render(<><OverviewNotice /><CanvasOverview /></>, container))
    expect(container.textContent).toContain('Zoom in to edit')
    expect(container.querySelector('[data-overview-pin]')).toBeNull()
    const returnButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Return to Design')
    returnButton?.click()
    expect(returnToDesign).toHaveBeenCalledOnce()
  })

  it('places the pin at ViewReadSurface.designPin', async () => {
    const designPin = signal<ScreenPoint | null>({ x: 123, y: 45 })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: {
        ...createTestCanvasQuerySurface(),
        view: { ...createTestViewReadSurface(), mode: signal('overview'), designPin },
      },
    }))

    await act(async () => render(<><OverviewNotice /><CanvasOverview /></>, container))
    const pin = container.querySelector<HTMLElement>('[data-overview-pin]')!
    expect([pin.style.left, pin.style.top]).toEqual(['123px', '45px'])

    await act(async () => { designPin.value = { x: 300, y: 200 } })
    expect([pin.style.left, pin.style.top]).toEqual(['300px', '200px'])

    // Within 24 px of an edge the surface publishes no pin; the notice stays.
    await act(async () => { designPin.value = null })
    expect(container.querySelector('[data-overview-pin]')).toBeNull()
    expect(container.querySelector('[data-overview-notice]')).not.toBeNull()
  })
})
