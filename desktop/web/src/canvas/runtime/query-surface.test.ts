import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ipc/species', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../ipc/species')>(),
  getSpeciesBatch: vi.fn(async () => []),
  getFlowerColorBatch: vi.fn(async () => []),
  getCommonNames: vi.fn(async () => ({})),
}))

import {
  createSceneInteractionEventHarness,
  type SceneInteractionEventHarness,
} from '../../__tests__/support/canvas-interaction-events'
import { SceneCanvasRuntime } from './scene-runtime'
import type { PointerWorld } from './interaction-ports'
import { createDetachedCanvasRuntimeAppAdapter } from './app-adapter'
import { CURRENT_CANOPI_FILE_VERSION } from '../../generated/canopi-design-format'
import { geoAt } from '../../__tests__/support/geo-design'
import type { CanopiFile } from '../../types/design'
import { currentCanvasSelection } from '../session-state'

const harnesses: SceneInteractionEventHarness[] = []

afterEach(() => {
  for (const events of harnesses.splice(0)) events.dispose()
  document.body.replaceChildren()
})

async function mountedRuntime(): Promise<{ runtime: SceneCanvasRuntime, container: HTMLDivElement, events: SceneInteractionEventHarness }> {
  const runtime = new SceneCanvasRuntime()
  runtime.connectRenderTarget({ setSnapshot: vi.fn(), setDraft: vi.fn(), requestRender: vi.fn() })
  const container = document.createElement('div')
  document.body.appendChild(container)
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
  await runtime.init(container)
  const events = createSceneInteractionEventHarness(container)
  harnesses.push(events)
  return { runtime, container, events }
}

describe('the runtime query surface', () => {
  it('subscribePointerWorld hears the live interaction session over the map, and nothing once the map unmounts', async () => {
    const { runtime, container, events } = await mountedRuntime()
    const points: (PointerWorld | null)[] = []
    const stop = runtime.querySurface.subscribePointerWorld((point) => { points.push(point) })

    // A button-less move over the map itself is heard; one over the page beside it is not.
    events.pointerMove({ x: 100, y: 80 }, { target: container, buttons: 0 })
    events.pointerMove({ x: 110, y: 80 }, { target: document.body, buttons: 0 })
    const { frames } = runtime.cameraHost
    const expected = frames.viewFrame.peek().view.screenToWorld({ x: 100, y: 80 })
    expect(points).toHaveLength(1)
    expect(points[0]!.world.x).toBeCloseTo(expected!.x, 9)
    expect(points[0]!.world.y).toBeCloseTo(expected!.y, 9)
    expect(points[0]!.screen).toEqual({ x: 100, y: 80 })
    expect(points[0]!.pointerKind).toBe('mouse')
    events.pointerLeave({ x: 100, y: 80 })
    expect(points.at(-1)).toBeNull()

    expect(runtime.keyboardPort).not.toBeNull()
    await runtime.unmountRenderer()
    expect(runtime.keyboardPort).toBeNull()
    events.pointerMove({ x: 120, y: 90 }, { target: container, buttons: 0 })
    expect(points).toHaveLength(2)
    stop()
    runtime.destroy()
  })

  it('the pointer ends with the map: an unmount with the mouse still over it publishes null', async () => {
    const { runtime, container, events } = await mountedRuntime()
    const points: (PointerWorld | null)[] = []
    const stop = runtime.querySurface.subscribePointerWorld((point) => { points.push(point) })

    events.pointerMove({ x: 100, y: 80 }, { target: container, buttons: 0 })
    expect(points.at(-1)).not.toBeNull()
    // A map failure unmounts the renderer; until Retry no cursor is over a map, so nothing reads the old point.
    await runtime.unmountRenderer()

    expect(points).toHaveLength(2)
    expect(points.at(-1)).toBeNull()
    stop()
    runtime.destroy()
  })

  it('a pointer feed subscribed before a Retry is heard from the session remountRenderer mounts', async () => {
    const { runtime, container, events } = await mountedRuntime()
    const points: (PointerWorld | null)[] = []
    const stop = runtime.querySurface.subscribePointerWorld((point) => { points.push(point) })
    await runtime.unmountRenderer()

    await runtime.remountRenderer(container)
    events.pointerMove({ x: 60, y: 40 }, { target: container, buttons: 0 })

    const expected = runtime.cameraHost.frames.viewFrame.peek().view.screenToWorld({ x: 60, y: 40 })
    expect(points).toHaveLength(1)
    expect(points[0]!.world.x).toBeCloseTo(expected.x, 9)
    expect(points[0]!.world.y).toBeCloseTo(expected.y, 9)
    stop()
    runtime.destroy()
  })
})

// A planted row (plan §4 "2.0 plant along a path", A7): the selection chip reads the row the selection is part of, and
// Select row selects all of its plants as session state.
function rowFile(): CanopiFile {
  const plant = (id: string, x: number) => ({
    id, canonical_name: 'Corylus avellana', common_name: null, color: null, position: geoAt(x, 0), rotation: null,
    scale: 3, notes: null, planted_date: null, quantity: 1, locked: false,
  })
  const plants = [plant('h1', 0), plant('h2', 2), plant('h3', 4), plant('lone', 10)]
  return {
    version: CURRENT_CANOPI_FILE_VERSION, name: 'Row', description: null, plant_species_colors: {},
    layers: [{ name: 'plants', visible: true, locked: false, opacity: 1 }],
    plants, zones: [], annotations: [], measurement_guides: [],
    plant_rows: [{
      id: 'hedge',
      anchors: [{ position: geoAt(0, 0), sharp: false }, { position: geoAt(4, 0), sharp: false }],
      closed: false,
      spacing: { kind: 'interval', interval_m: 2 },
      members: plants.slice(0, 3).map((entry) => ({ plant_id: entry.id, at: entry.position })),
    }],
    consortiums: [], groups: [], timeline: [], budget: [], budget_currency: 'EUR',
    created_at: '2026-10-12T00:00:00.000Z', updated_at: '2026-10-12T00:00:00.000Z', extra: {},
  }
}

describe('the selected planted row', () => {
  it('names the row some plants belong to; Select row selects all of them with no Design edit, and its spacing re-spaces it in one', () => {
    const runtime = new SceneCanvasRuntime({ appAdapter: createDetachedCanvasRuntimeAppAdapter() })
    try {
      runtime.documentSurface.loadDocument(rowFile())
      const queries = runtime.querySurface
      const edits = runtime.commandSurface.sceneEdits
      // A click's selection, which is session state too.
      const select = (ids: readonly string[]) => (runtime as unknown as { _setSelection(targets: unknown): void })
        ._setSelection(ids.map((id) => ({ kind: 'plant', id })))

      select(['h2'])
      expect(queries.getSelectedPlantRow?.()).toEqual({
        id: 'hedge', whole: false, plants: 3, spacing: { kind: 'interval', metres: 2 }, gapM: 2, locked: false,
      })
      edits.selectPlantRow?.()
      expect(queries.getSelection().map((target) => target.id)).toEqual(['h1', 'h2', 'h3'])
      expect([...currentCanvasSelection.value]).toEqual(['h1', 'h2', 'h3'])
      expect(queries.getSelectedPlantRow?.()?.whole, 'the row is selected').toBe(true)
      expect(runtime.commandSurface.history.canUndo.value, 'Select row edits nothing').toBe(false)

      // The chip's spacing: one Scene Edit that keeps the row selected, never the device interval.
      expect(edits.setPlantRowSpacing?.('hedge', { kind: 'interval', metres: 2 }), 'the same spacing edits nothing').toBe(false)
      expect(edits.setPlantRowSpacing?.('hedge', { kind: 'count', count: 5 })).toBe(true)
      expect(queries.getSelectedPlantRow?.()).toMatchObject({ whole: true, plants: 5, spacing: { kind: 'count', count: 5 } })
      expect(queries.getSelectedPlantRow?.()?.gapM).toBeCloseTo(1, 6)
      expect(queries.getSelection().slice(0, 3).map((target) => target.id), 'the members keep their ids').toEqual(['h1', 'h2', 'h3'])
      runtime.commandSurface.history.undo()
      expect(queries.getSelection().map((target) => target.id), 'Undo selects the restored row').toEqual(['h1', 'h2', 'h3'])
      expect(queries.getSceneSnapshot().plants).toHaveLength(4)

      // A locked member locks the row: the chip shows it disabled, and its spacing changes nothing.
      edits.lockSelected()
      select(['h1', 'h2', 'h3'])
      expect(queries.getSelectedPlantRow?.()?.locked).toBe(true)
      expect(edits.setPlantRowSpacing?.('hedge', { kind: 'count', count: 4 })).toBe(false)
      expect(queries.getSceneSnapshot().plants).toHaveLength(4)

      select(['h1', 'lone'])
      expect(queries.getSelectedPlantRow?.(), 'a selection reaching outside the row').toBeNull()
      edits.selectPlantRow?.()
      expect(queries.getSelection().map((target) => target.id)).toEqual(['h1', 'lone'])
    } finally {
      runtime.destroy()
    }
  })

  it('a row whose last plant started another row (an L-shaped hedge) re-spaces without planting on that plant', () => {
    const file = rowFile()
    const [hedge] = file.plant_rows!
    const corner = { ...file.plants[3]!, id: 'up', position: geoAt(4, 2) }
    file.plants = [...file.plants, corner]
    file.plant_rows = [
      { ...hedge!, members: hedge!.members.slice(0, 2) },
      {
        id: 'side', closed: false, spacing: { kind: 'interval', interval_m: 2 },
        anchors: [{ position: geoAt(4, 0), sharp: false }, { position: geoAt(4, 2), sharp: false }],
        members: [{ plant_id: 'h3', at: geoAt(4, 0) }, { plant_id: 'up', at: geoAt(4, 2) }],
      },
    ]
    const runtime = new SceneCanvasRuntime({ appAdapter: createDetachedCanvasRuntimeAppAdapter() })
    try {
      runtime.documentSurface.loadDocument(file)
      const edits = runtime.commandSurface.sceneEdits
      // Three plants end to end along the hedge's 4 m: the third spot is h3's, now the side row's first plant.
      expect(edits.setPlantRowSpacing?.('hedge', { kind: 'count', count: 3 })).toBe(true)
      const plants = runtime.querySurface.getSceneSnapshot().plants
      // The session plane's origin is the Design's: read the spots from the untouched plant 10 m along.
      const lone = plants.find((entry) => entry.id === 'lone')!.position
      const near = (x: number, y: number) => plants.filter((entry) =>
        Math.hypot(entry.position.x - (lone.x - 10 + x), entry.position.y - (lone.y + y)) < 0.01)
      expect(near(4, 0).map((entry) => entry.id), 'one plant stands at the corner, the side row\'s').toEqual(['h3'])
      expect(plants, 'the hedge planted no copy').toHaveLength(5)
    } finally {
      runtime.destroy()
    }
  })
})
