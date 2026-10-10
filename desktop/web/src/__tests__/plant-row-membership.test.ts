// A planted row through the real runtime (plan §4, "2.0 plant along a path"; A5, A7, A11): the row writer's Scene
// Edit and its Undo, and membership derived on read after every other edit, each with undo and redo.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/species', () => ({
  getSpeciesBatch: vi.fn(async () => []),
  getFlowerColorBatch: vi.fn(async () => []),
  getCommonNames: vi.fn(async () => ({})),
}))

import { createDetachedCanvasRuntimeAppAdapter } from '../canvas/runtime/app-adapter'
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
