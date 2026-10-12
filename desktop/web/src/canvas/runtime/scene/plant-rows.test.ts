import { describe, expect, it } from 'vitest'

import { createDefaultScenePersistedState } from './defaults'
import { attachedPlantRowMembers, plantsById } from './plant-rows'
import type { ScenePersistedState, ScenePlantEntity, ScenePlantRowEntity, ScenePoint } from './types'

function plant(id: string, position: ScenePoint, overrides: Partial<ScenePlantEntity> = {}): ScenePlantEntity {
  return {
    kind: 'plant', id, locked: false, canonicalName: 'Corylus avellana', commonName: 'European hazelnut', color: null,
    canopySpreadM: 3, position: { ...position }, rotationDeg: null, notes: null, plantedDate: null, quantity: 1,
    ...overrides,
  }
}

const ANCHORS: ScenePlantRowEntity['anchors'] = [
  { position: { x: 0, y: 0 }, sharp: false },
  { position: { x: 4, y: 3 }, sharp: true },
  { position: { x: 8, y: 0 }, sharp: false },
]

/** A scene with a row `row-1` of plants a, b, c (each at its `at`) and a loose plant `loose`. */
function sceneWithRow(): ScenePersistedState {
  const scene = createDefaultScenePersistedState()
  scene.plants = [
    plant('a', { x: 0, y: 0 }, { color: '#aa6633', symbol: 'nut', rotationDeg: 15, notes: 'first' }),
    plant('b', { x: 2, y: 1 }),
    plant('c', { x: 4, y: 3 }),
    plant('loose', { x: 20, y: 20 }),
  ]
  scene.plantRows = [{
    kind: 'plant-row', id: 'row-1', anchors: ANCHORS, closed: false, spacing: { kind: 'interval', metres: 2 },
    members: [{ plantId: 'a', at: { x: 0, y: 0 } }, { plantId: 'b', at: { x: 2, y: 1 } }, { plantId: 'c', at: { x: 4, y: 3 } }],
  }]
  return scene
}

function attached(scene: ScenePersistedState, rowId = 'row-1'): string[] {
  const row = scene.plantRows.find((entry) => entry.id === rowId)
  return row ? attachedPlantRowMembers(row, plantsById(scene)).map((member) => member.plantId) : []
}

describe('plant row membership (A5)', () => {
  it('a member is attached while its plant lies within 1 mm of its at, and a plant moved back re-attaches', () => {
    const scene = sceneWithRow()
    expect(attached(scene)).toEqual(['a', 'b', 'c'])
    scene.plants[1] = { ...scene.plants[1]!, position: { x: 2.0007, y: 1.0007 } }
    expect(attached(scene)).toEqual(['a', 'b', 'c'])
    scene.plants[1] = { ...scene.plants[1]!, position: { x: 2.0011, y: 1 } }
    expect(attached(scene)).toEqual(['a', 'c'])
    scene.plants = scene.plants.filter((entry) => entry.id !== 'c')
    expect(attached(scene)).toEqual(['a'])
    scene.plants[1] = { ...scene.plants[1]!, position: { x: 2, y: 1 } }
    expect(attached(scene)).toEqual(['a', 'b'])
  })
})
