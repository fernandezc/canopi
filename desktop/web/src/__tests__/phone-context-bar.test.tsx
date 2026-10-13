// The phone's context bar (canopi-f47t.54, stream D, answers 18 and 22-26): what it shows, by priority. Its place in the
// panel sheet and its taps are checked in the browser (e2e/canvas/phone-chrome.spec.ts).
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolId } from '../canvas/runtime/interaction-types'
import { locale } from '../app/settings/state'
import { PhoneContextBar } from '../components/canvas/PhoneContextBar'
import { setCurrentCanvasSession } from '../canvas/session'
import { SceneStore } from '../canvas/runtime/scene/store'
import {
  currentCanvasSelection,
  IDLE_CANVAS_TOOL_GUIDANCE,
  setCanvasTool,
  setCanvasToolGuidance,
  type CanvasToolGuidance,
} from '../canvas/session-state'
import {
  createTestCanvasCommandSurface,
  createTestCanvasDocumentSurface,
  createTestCanvasKeyboardPort,
} from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface, type TestCanvasQuerySurface } from './support/canvas-query-surface'

describe('Phone context bar', () => {
  let container: HTMLDivElement
  let queries: TestCanvasQuerySurface

  beforeEach(async () => {
    locale.value = 'en'
    container = document.createElement('div')
    document.body.append(container)
    const store = new SceneStore()
    store.updatePersisted((draft) => {
      draft.plants = ['apple-1', 'apple-2'].map((id, index) => ({
        id, canonicalName: 'Malus domestica', commonName: 'Apple', kind: 'plant', locked: false, color: null,
        symbol: 'tree', position: { x: index * 4, y: 0 }, canopySpreadM: null, rotationDeg: 0, notes: null,
        plantedDate: null, quantity: 1,
      }))
    })
    queries = createTestCanvasQuerySurface({ scene: store.persisted })
    setCurrentCanvasSession({
      commands: createTestCanvasCommandSurface(),
      queries,
      documents: createTestCanvasDocumentSurface(),
      keyboard: createTestCanvasKeyboardPort(),
    })
    await act(() => render(<PhoneContextBar />, container))
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCanvasTool('select')
    setCanvasToolGuidance(IDLE_CANVAS_TOOL_GUIDANCE)
    currentCanvasSelection.value = new Set()
    setCurrentCanvasSession(null)
  })

  async function selectApple(): Promise<void> {
    await act(() => {
      queries.setSelection([{ kind: 'plant', id: 'apple-1' }])
      currentCanvasSelection.value = new Set(['apple-1'])
    })
  }

  async function choose(tool: ToolId, guidance: Partial<CanvasToolGuidance> = {}): Promise<void> {
    await act(() => {
      setCanvasTool(tool)
      setCanvasToolGuidance({ ...IDLE_CANVAS_TOOL_GUIDANCE, ...guidance })
    })
  }

  const card = () => container.querySelector<HTMLElement>('[data-tool-card]')
  const chip = () => container.querySelector<HTMLElement>('[data-selection-chip]')

  it('shows nothing under Select or Pan with nothing else to show, keeping the card\'s live region for the next tool', async () => {
    for (const tool of ['select', 'hand'] as const) {
      await choose(tool)
      expect(card(), `${tool}: no card`).toBeNull()
      expect(container.querySelector('[role="status"][aria-live="polite"]'), `${tool}: the card's live region stays mounted`).not.toBeNull()
      expect(container.textContent).toBe('')
    }
  })

  it('shows the armed tool\'s card in the bar for any other tool', async () => {
    for (const tool of ['plant-spacing', 'polygon', 'profile', 'rectangle'] as const) {
      await choose(tool)
      expect(card()?.dataset.toolCard, tool).toBe(tool)
      expect(card()?.dataset.placement, `${tool}: the card is the bar's`).toBe('bar')
    }
  })

  it('shows the selection under Select or Pan, on one line in the bar, and never with a tool\'s card', async () => {
    await selectApple()
    for (const tool of ['select', 'hand'] as const) {
      await choose(tool)
      expect(chip()?.dataset.selectionChip, `${tool}: the selection chip is the bar's`).toBe('bar')
      expect(card(), `${tool}: no card`).toBeNull()
    }
    // A selection kept while a drawing tool is armed is not summarised: the card is the one context.
    await choose('plant-spacing')
    expect(card()?.dataset.toolCard).toBe('plant-spacing')
    expect(chip()).toBeNull()
    await choose('select')
    expect(chip()?.dataset.selectionChip, 'back under Select the selection shows again').toBe('bar')
  })
})
