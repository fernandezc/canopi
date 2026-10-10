// A planted row through the real runtime (plan §4, "2.0 plant along a path"; A5, A7, A11): the row writer's Scene
// Edit and its Undo, and membership derived on read after every other edit, each with undo and redo.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/species', () => ({
  getSpeciesBatch: vi.fn(async () => []),
  getFlowerColorBatch: vi.fn(async () => []),
  getCommonNames: vi.fn(async () => ({})),
}))

import { createDetachedCanvasRuntimeAppAdapter } from '../canvas/runtime/app-adapter'
import { createSceneInteractionEventHarness } from './support/canvas-interaction-events'
import { placeOnHost } from './support/test-view'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'
import { applyPlantRowPositions, attachedPlantRowMembers, plantsById } from '../canvas/runtime/scene/plant-rows'
import type { SceneEditCoordinator } from '../canvas/runtime/scene-runtime/transactions'
import { CURRENT_CANOPI_FILE_VERSION } from '../generated/canopi-design-format'
import type { CanopiFile } from '../types/design'
import { geoAt } from './support/geo-design'

const ROW_PLANTS = ['h1', 'h2', 'h3', 'h4'] as const

/** Four hazels 2 m apart on a row `hedge`, each at its `at`, and an apple beside it. */
function rowFile(): CanopiFile {
  const plant = (id: string, x: number, y: number, canonical = 'Corylus avellana') => ({
    id, canonical_name: canonical, common_name: null, color: null, position: geoAt(x, y), rotation: null, scale: 3,
    notes: null, planted_date: null, quantity: 1, locked: false,
  })
  const plants = [...ROW_PLANTS.map((id, index) => plant(id, index * 2, 0)), plant('apple', 4, 10, 'Malus domestica')]
  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name: 'Row membership',
    description: null,
    plant_species_colors: {},
    layers: [{ name: 'plants', visible: true, locked: false, opacity: 1 }],
    plants,
    zones: [],
    annotations: [],
    measurement_guides: [],
    plant_rows: [{
      id: 'hedge',
      anchors: [{ position: geoAt(0, 0), sharp: false }, { position: geoAt(6, 0), sharp: false }],
      closed: false,
      spacing: { kind: 'interval', interval_m: 2 },
      members: plants.slice(0, 4).map((entry) => ({ plant_id: entry.id, at: entry.position })),
    }],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-10-11T00:00:00.000Z',
    updated_at: '2026-10-11T00:00:00.000Z',
    extra: {},
  }
}

function createRuntime() {
  const runtime = new SceneCanvasRuntime({ appAdapter: createDetachedCanvasRuntimeAppAdapter() })
  runtime.documentSurface.loadDocument(rowFile())
  runtime.documentSurface.resize(400, 300)
  return runtime
}

function sceneEdits(runtime: SceneCanvasRuntime): SceneEditCoordinator {
  return (runtime as unknown as { _sceneCommands: SceneEditCoordinator })._sceneCommands
}

function scene(runtime: SceneCanvasRuntime) {
  return runtime.querySurface.getSceneSnapshot()
}

/** Each row's attached members, by row id. */
function rows(runtime: SceneCanvasRuntime): Record<string, string[]> {
  const snapshot = scene(runtime)
  const plants = plantsById(snapshot)
  return Object.fromEntries(snapshot.plantRows.map((row) => [row.id, attachedPlantRowMembers(row, plants).map((member) => member.plantId)]))
}

function withRuntime(test: (runtime: SceneCanvasRuntime) => void): void {
  const runtime = createRuntime()
  try {
    test(runtime)
  } finally {
    runtime.destroy()
  }
}

describe('the row writer through the scene runtime (A7)', () => {
  it('re-spaces a row in one Scene Edit, and one Undo restores the plants, their ids and the row', () => {
    withRuntime((runtime) => {
      const before = scene(runtime)
      const at = (index: number) => ({ x: before.plants[0]!.position.x + index * 1.5, y: before.plants[0]!.position.y })
      let created = 0
      let members: string[] | null = null
      expect(sceneEdits(runtime).run('interaction-plant-row-edit', (tx) => {
        tx.mutate((draft) => {
          members = applyPlantRowPositions(draft, {
            id: 'hedge', anchors: before.plantRows[0]!.anchors, closed: false, spacing: { kind: 'interval', metres: 1.5 },
            positions: [0, 1, 2, 3, 4, 5].map(at), createId: () => `copy-${++created}`,
          })
        })
        tx.setSelection((members ?? []).map((id) => ({ kind: 'plant', id })))
      })).toBe(true)
      expect(members).toEqual([...ROW_PLANTS, 'copy-1', 'copy-2'])
      expect(rows(runtime)).toEqual({ hedge: members })
      expect(runtime.querySurface.getSelection().map((target) => target.id)).toEqual(members)

      runtime.commandSurface.history.undo()
      expect(scene(runtime).plants).toEqual(before.plants)
      expect(scene(runtime).plantRows).toEqual(before.plantRows)
      runtime.commandSurface.history.redo()
      expect(rows(runtime)).toEqual({ hedge: members })
    })
  })
})

function select(runtime: SceneCanvasRuntime, ids: readonly string[]): void {
  expect(sceneEdits(runtime).run('select', (tx) => tx.setSelection(ids.map((id) => ({ kind: 'plant', id }))))).toBe(true)
}

/** The row's points and members' `at`, which follow a whole-row move. */
function rowGeometry(runtime: SceneCanvasRuntime) {
  const row = scene(runtime).plantRows.find((entry) => entry.id === 'hedge')!
  return { anchors: row.anchors.map((anchor) => anchor.position), at: row.members.map((member) => member.at) }
}

/** Runs `edit`, checks `after`, then that Undo restores the rows and Redo the edit's. */
function expectUndoable(runtime: SceneCanvasRuntime, edit: () => void, after: Record<string, string[]>): void {
  const before = rows(runtime)
  edit()
  expect(rows(runtime)).toEqual(after)
  runtime.commandSurface.history.undo()
  expect(rows(runtime)).toEqual(before)
  runtime.commandSurface.history.redo()
  expect(rows(runtime)).toEqual(after)
}

describe('a whole row moves as a row (A11)', () => {
  it('a nudge of all its plants carries its points and every at, and keeps it a row', () => {
    withRuntime((runtime) => {
      const start = rowGeometry(runtime)
      select(runtime, ROW_PLANTS)
      expectUndoable(runtime, () => {
        expect(runtime.commandSurface.sceneEdits.nudgeSelected({ x: 0.25, y: -1 })).toBe(true)
        runtime.commandSurface.sceneEdits.endNudge()
      }, { hedge: [...ROW_PLANTS] })
      const moved = rowGeometry(runtime)
      const shifted = (points: readonly { x: number; y: number }[]) => points.map((point) => ({ x: point.x + 0.25, y: point.y - 1 }))
      expect(moved.anchors).toEqual(shifted(start.anchors))
      expect(moved.at).toEqual(scene(runtime).plants.slice(0, 4).map((plant) => plant.position))
    })
  })

  it('a rotation of all its plants turns its points and every at about the same pivot', () => {
    withRuntime((runtime) => {
      select(runtime, ROW_PLANTS)
      expectUndoable(runtime, () => runtime.commandSurface.sceneEdits.rotateSelected(90), { hedge: [...ROW_PLANTS] })
      const moved = rowGeometry(runtime)
      const plants = scene(runtime).plants.slice(0, 4).map((plant) => plant.position)
      expect(moved.at).toEqual(plants)
      // The row lay along x; turned a quarter, its first and last points now share an x.
      expect(moved.anchors[0]!.x).toBeCloseTo(moved.anchors[1]!.x, 9)
      expect(Math.abs(moved.anchors[1]!.y - moved.anchors[0]!.y)).toBeCloseTo(6, 4)
    })
  })

  it('a move of all its plants with another plant still carries the row', () => {
    withRuntime((runtime) => {
      select(runtime, [...ROW_PLANTS, 'apple'])
      expectUndoable(runtime, () => {
        runtime.commandSurface.sceneEdits.nudgeSelected({ x: 3, y: 0 })
        runtime.commandSurface.sceneEdits.endNudge()
      }, { hedge: [...ROW_PLANTS] })
    })
  })

  it('a move-drag of all its plants under Select keeps it a row', async () => {
    const renderer = { setSnapshot: vi.fn(), setDraft: vi.fn(), requestRender: vi.fn() }
    const runtime = new SceneCanvasRuntime({ appAdapter: createDetachedCanvasRuntimeAppAdapter() })
    runtime.connectRenderTarget(renderer)
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    await runtime.init(container)
    runtime.documentSurface.loadDocument(rowFile())
    runtime.documentSurface.resize(400, 300)
    const events = createSceneInteractionEventHarness(container)
    try {
      const first = scene(runtime).plants[0]!.position
      placeOnHost(runtime.cameraHost, runtime.querySurface.sessionPlane.peek()!, { x: 100 - first.x * 20, y: 150 - first.y * 20, scale: 20 })
      select(runtime, ROW_PLANTS)
      const start = rowGeometry(runtime)
      events.pointerDown({ x: 100, y: 150 })
      events.pointerMove({ x: 120, y: 150 })
      events.pointerMove({ x: 140, y: 170 })
      events.pointerUp({ x: 140, y: 170 })
      expect(rows(runtime)).toEqual({ hedge: [...ROW_PLANTS] })
      const moved = rowGeometry(runtime)
      expect(moved.anchors[0]!.x - start.anchors[0]!.x).toBeCloseTo(2, 6)
      expect(moved.anchors[0]!.y - start.anchors[0]!.y).toBeCloseTo(1, 6)
      runtime.commandSurface.history.undo()
      expect(rowGeometry(runtime)).toEqual(start)
    } finally {
      events.dispose()
      runtime.destroy()
    }
  })
})

describe('any other edit takes plants out of their row (A5)', () => {
  it('moving some of its plants leaves the rest a row without them', () => {
    withRuntime((runtime) => {
      select(runtime, ['h2', 'h3'])
      expectUndoable(runtime, () => {
        runtime.commandSurface.sceneEdits.nudgeSelected({ x: 0, y: 1 })
        runtime.commandSurface.sceneEdits.endNudge()
      }, { hedge: ['h1', 'h4'] })
    })
  })

  it('rotating some of its plants takes them out', () => {
    withRuntime((runtime) => {
      select(runtime, ['h1', 'h2', 'apple'])
      expectUndoable(runtime, () => runtime.commandSurface.sceneEdits.rotateSelected(45), { hedge: ['h3', 'h4'] })
    })
  })

  it('deleting or cutting a plant takes it out', () => {
    withRuntime((runtime) => {
      select(runtime, ['h4'])
      expectUndoable(runtime, () => runtime.commandSurface.sceneEdits.deleteSelected(), { hedge: ['h1', 'h2', 'h3'] })
      select(runtime, ['h1'])
      expectUndoable(runtime, () => {
        runtime.commandSurface.sceneEdits.copy()
        runtime.commandSurface.sceneEdits.deleteSelected()
      }, { hedge: ['h2', 'h3'] })
    })
  })

  it('copies are plain plants: Ctrl+D and paste leave the row as it was', () => {
    withRuntime((runtime) => {
      select(runtime, ROW_PLANTS)
      expectUndoable(runtime, () => runtime.commandSurface.sceneEdits.duplicateSelected(), { hedge: [...ROW_PLANTS] })
      expect(scene(runtime).plants).toHaveLength(9)
      runtime.commandSurface.sceneEdits.copy()
      expectUndoable(runtime, () => runtime.commandSurface.sceneEdits.paste(), { hedge: [...ROW_PLANTS] })
      expect(scene(runtime).plants).toHaveLength(13)
    })
  })
})
