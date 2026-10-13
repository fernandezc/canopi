// The phone's context bar (canopi-f47t.54, stream D, answers 18 and 22-26): what it shows, by priority. Its place in the
// panel sheet and its taps are checked in the browser (e2e/canvas/phone-chrome.spec.ts).
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanopiFile } from '../types/design'
import type { ToolId } from '../canvas/runtime/interaction-types'
import { locale } from '../app/settings/state'
import { PhoneContextBar } from '../components/canvas/PhoneContextBar'
import { PLANT_LABELS_CHIP_MS } from '../components/canvas/PlantLabelsChip'
import { plantFinderMapMatches } from '../app/plant-finder/map-matches'
import { setPlantLabels } from '../app/plant-display/actions'
import { designSessionFixture, replaceCurrentDesignState } from './support/design-session-state'
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
    queries = createTestCanvasQuerySurface({ scene: store.persisted, plantLabelCoverage: { labelled: 2, inView: 2 } })
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
    plantFinderMapMatches.value = null
    designSessionFixture.file = null
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
  const highlight = () => container.querySelector<HTMLElement>('[role="group"][aria-label="Plants highlighted on the map"]')
  const labels = () => container.querySelector<HTMLElement>('[data-plant-labels-chip]')

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

  it('shows the highlighted plants when no card or selection does, and gives way to them', async () => {
    await act(() => { plantFinderMapMatches.value = { query: 'apple', canonicalNames: ['Malus domestica'] } })
    expect(highlight()?.textContent).toContain('2 plants match')
    await selectApple()
    expect(chip()).not.toBeNull()
    expect(highlight(), 'the selection is the one context').toBeNull()
    await act(() => {
      queries.setSelection([])
      currentCanvasSelection.value = new Set()
    })
    await choose('polygon')
    expect(card()?.dataset.toolCard).toBe('polygon')
    expect(highlight(), 'the card is the one context').toBeNull()
    await choose('select')
    expect(highlight()).not.toBeNull()
  })

  it('shows the labels chip after the labels change only when nothing else holds the bar, its window running meanwhile', async () => {
    vi.useFakeTimers()
    try {
      replaceCurrentDesignState(emptyDesign(), null, 'Display')
      await act(() => setPlantLabels('codes'))
      expect(labels()?.textContent).toBe('Codes shown for 2 of 2 plants in view')
      await choose('polygon')
      expect(labels(), 'the card is the one context').toBeNull()
      await choose('select')
      expect(labels(), 'back under Select, in its window').not.toBeNull()
      await act(() => { vi.advanceTimersByTime(PLANT_LABELS_CHIP_MS) })
      expect(labels()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('in overview shows its notice alone, whatever the tool', async () => {
    await choose('polygon')
    await act(() => queries.setPlacement({ x: 0, y: 0, scale: 0.01 }))
    expect(container.querySelector('[data-overview-notice]')).not.toBeNull()
    expect(card()).toBeNull()
  })
})

function emptyDesign(): CanopiFile {
  return {
    version: 9, name: 'Display', description: null, plant_species_colors: {}, plant_species_symbols: {}, plant_species_codes: {},
    layers: [], plants: [], zones: [], annotations: [], measurement_guides: [], consortiums: [], groups: [], timeline: [],
    budget: [], budget_currency: 'EUR', views: [], stories: [], created_at: '', updated_at: '', extra: {},
  }
}
