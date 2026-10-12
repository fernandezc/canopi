import { describe, expect, it } from 'vitest'

import { createDefaultScenePersistedState } from './defaults'
import { applyPlantRowPositions, attachedPlantRowMembers, isPlantRowLocked, plantsById, rowOfSelection } from './plant-rows'
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

function ids(): () => string {
  let next = 0
  return () => `new-${++next}`
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

describe('applyPlantRowPositions, the row writer (A5, A7)', () => {
  it('starts a row from the picked plant: copies of it fill the other positions, each member at its plant', () => {
    const scene = sceneWithRow()
    const positions = [{ x: 20, y: 20 }, { x: 22, y: 20 }, { x: 24, y: 21 }]
    const members = applyPlantRowPositions(scene, {
      id: 'row-2', firstPlantId: 'loose', anchors: ANCHORS, closed: false, spacing: { kind: 'count', count: 3 },
      positions, createId: ids(),
    })
    expect(members).toEqual(['loose', 'new-1', 'new-2'])
    const row = scene.plantRows.find((entry) => entry.id === 'row-2')!
    expect(row).toEqual({
      kind: 'plant-row', id: 'row-2', anchors: ANCHORS, closed: false, spacing: { kind: 'count', count: 3 },
      members: members!.map((plantId, index) => ({ plantId, at: positions[index] })),
    })
    const byId = plantsById(scene)
    expect(members!.map((id) => byId.get(id)!.position)).toEqual(positions)
    expect(byId.get('new-2')).toEqual(plant('new-2', { x: 24, y: 21 }, { pinnedName: false }))
    expect(attached(scene, 'row-2')).toEqual(members)
    expect(attached(scene)).toEqual(['a', 'b', 'c'])
  })

  it('re-spaces a row: member ids stay in path order, extra positions get copies of the first member', () => {
    const scene = sceneWithRow()
    const positions = [{ x: 1, y: 0 }, { x: 3, y: 0 }, { x: 5, y: 0 }, { x: 7, y: 0 }]
    const members = applyPlantRowPositions(scene, {
      id: 'row-1', anchors: ANCHORS.slice(0, 2), closed: false, spacing: { kind: 'interval', metres: 2 }, positions,
      createId: ids(),
    })
    expect(members).toEqual(['a', 'b', 'c', 'new-1'])
    const byId = plantsById(scene)
    expect(members!.map((id) => byId.get(id)!.position)).toEqual(positions)
    expect(byId.get('new-1')).toMatchObject({ canonicalName: 'Corylus avellana', color: '#aa6633', symbol: 'nut', rotationDeg: 15, notes: null })
    expect(scene.plantRows).toHaveLength(1)
    expect(scene.plantRows[0]!.anchors).toEqual(ANCHORS.slice(0, 2))
    expect(attached(scene)).toEqual(members)
  })

  it('deletes the surplus members, and takes them out of their groups', () => {
    const scene = sceneWithRow()
    scene.groups = [
      { kind: 'group', id: 'pair', locked: false, name: null, members: [{ kind: 'plant', id: 'c' }, { kind: 'plant', id: 'loose' }] },
      { kind: 'group', id: 'trio', locked: false, name: null, members: [{ kind: 'plant', id: 'a' }, { kind: 'plant', id: 'b' }, { kind: 'plant', id: 'c' }] },
    ]
    const members = applyPlantRowPositions(scene, {
      id: 'row-1', anchors: ANCHORS, closed: false, spacing: { kind: 'interval', metres: 4 },
      positions: [{ x: 0, y: 0 }, { x: 4, y: 3 }], createId: ids(),
    })
    expect(members).toEqual(['a', 'b'])
    expect(scene.plants.map((entry) => entry.id)).toEqual(['a', 'b', 'loose'])
    expect(scene.groups).toEqual([
      { kind: 'group', id: 'trio', locked: false, name: null, members: [{ kind: 'plant', id: 'a' }, { kind: 'plant', id: 'b' }] },
    ])
    expect(attached(scene)).toEqual(['a', 'b'])
  })

  it('reuses only attached members: a plant moved off the row stays where it is', () => {
    const scene = sceneWithRow()
    scene.plants[1] = { ...scene.plants[1]!, position: { x: 9, y: 9 } }
    const members = applyPlantRowPositions(scene, {
      id: 'row-1', anchors: ANCHORS, closed: false, spacing: { kind: 'interval', metres: 2 },
      positions: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }], createId: ids(),
    })
    expect(members).toEqual(['a', 'c', 'new-1'])
    expect(plantsById(scene).get('b')!.position).toEqual({ x: 9, y: 9 })
    expect(scene.plantRows[0]!.members.map((member) => member.plantId)).toEqual(['a', 'c', 'new-1'])
  })

  it('a plant belongs to one row: a row started from a member takes it, and a row left with none is removed', () => {
    const scene = sceneWithRow()
    const first = applyPlantRowPositions(scene, {
      id: 'row-2', firstPlantId: 'b', anchors: ANCHORS, closed: false, spacing: { kind: 'interval', metres: 2 },
      positions: [{ x: 2, y: 1 }, { x: 2, y: 3 }], createId: ids(),
    })
    expect(first).toEqual(['b', 'new-1'])
    expect(scene.plantRows.find((row) => row.id === 'row-1')!.members.map((member) => member.plantId)).toEqual(['a', 'c'])

    const rowOne = scene.plantRows.findIndex((row) => row.id === 'row-1')
    scene.plantRows[rowOne] = { ...scene.plantRows[rowOne]!, members: scene.plantRows[rowOne]!.members.slice(0, 1) }
    applyPlantRowPositions(scene, {
      id: 'row-3', firstPlantId: 'a', anchors: ANCHORS, closed: false, spacing: { kind: 'interval', metres: 2 },
      positions: [{ x: 0, y: 0 }], createId: ids(),
    })
    expect(scene.plantRows.map((row) => row.id)).toEqual(['row-2', 'row-3'])
    expect(scene.plants.map((entry) => entry.id)).toContain('c')
  })

  it('a re-space leaves the spot of a member another row took to that row: no plant is planted on it', () => {
    // Row 1 runs a, b, c at x = 0, 2, 4; each case starts a second row from one of them and re-spaces row 1 in place.
    const straight = (): ScenePersistedState => {
      const scene = sceneWithRow()
      scene.plants = scene.plants.map((entry, index) => index < 3 ? { ...entry, position: { x: index * 2, y: 0 } } : entry)
      scene.plantRows[0] = {
        ...scene.plantRows[0]!,
        members: scene.plantRows[0]!.members.map((member, index) => ({ ...member, at: { x: index * 2, y: 0 } })),
      }
      return scene
    }
    const slots = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }]
    for (const [picked, left] of [['c', ['a', 'b']], ['b', ['a', 'c']], ['a', ['b', 'c']]] as const) {
      const scene = straight()
      const corner = plantsById(scene).get(picked)!.position
      applyPlantRowPositions(scene, {
        id: 'row-2', firstPlantId: picked, anchors: ANCHORS, closed: false, spacing: { kind: 'interval', metres: 2 },
        positions: [corner, { x: corner.x, y: 2 }], createId: ids(),
      })
      const members = applyPlantRowPositions(scene, {
        id: 'row-1', anchors: ANCHORS, closed: false, spacing: { kind: 'interval', metres: 2 }, positions: slots,
        createId: ids(),
      })
      expect(members, `row 1 keeps its other plants when ${picked} leaves`).toEqual(left)
      for (const slot of slots) {
        const standing = scene.plants.filter((entry) => entry.position.x === slot.x && entry.position.y === slot.y)
        expect(standing, `one plant at x = ${slot.x} after ${picked} left`).toHaveLength(1)
      }
      expect(plantsById(scene).get(picked)!.position, `${picked} stays row 2's first plant`).toEqual(corner)
      expect(attached(scene, 'row-2')[0]).toBe(picked)
    }
  })

  it('writes nothing without positions or a first plant', () => {
    const scene = sceneWithRow()
    const before = structuredClone(scene)
    const request = { anchors: ANCHORS, closed: false, spacing: { kind: 'interval', metres: 2 } as const, createId: ids() }
    expect(applyPlantRowPositions(scene, { ...request, id: 'row-1', positions: [] })).toBeNull()
    expect(applyPlantRowPositions(scene, { ...request, id: 'row-9', positions: [{ x: 0, y: 0 }] })).toBeNull()
    expect(applyPlantRowPositions(scene, { ...request, id: 'row-9', firstPlantId: 'gone', positions: [{ x: 0, y: 0 }] })).toBeNull()
    expect(scene).toEqual(before)
  })
})

describe('rowOfSelection (A7)', () => {
  const plants = (...names: string[]) => names.map((id) => ({ kind: 'plant' as const, id }))

  it('names the row whose attached plants hold the selection, whole when the selection is all of them', () => {
    const scene = sceneWithRow()
    expect(rowOfSelection(scene, plants('c', 'a', 'b'))).toEqual({ row: scene.plantRows[0], members: ['a', 'b', 'c'], whole: true })
    expect(rowOfSelection(scene, plants('b'))).toEqual({ row: scene.plantRows[0], members: ['a', 'b', 'c'], whole: false })
    scene.plants[2] = { ...scene.plants[2]!, position: { x: 30, y: 30 } }
    expect(rowOfSelection(scene, plants('a', 'b'))).toMatchObject({ members: ['a', 'b'], whole: true })
  })

  it('is null for an empty selection, a plant of no row, a detached plant, or anything but plants', () => {
    const scene = sceneWithRow()
    expect(rowOfSelection(scene, [])).toBeNull()
    expect(rowOfSelection(scene, plants('a', 'loose'))).toBeNull()
    expect(rowOfSelection(scene, [...plants('a'), { kind: 'zone', id: 'bed' }])).toBeNull()
    scene.plants[0] = { ...scene.plants[0]!, position: { x: 30, y: 30 } }
    expect(rowOfSelection(scene, plants('a'))).toBeNull()
  })
})

describe('isPlantRowLocked (A7: the one lock table)', () => {
  it('locks a row while one of its members or the Plants layer is locked, and never for a plant outside it', () => {
    const scene = sceneWithRow()
    expect(isPlantRowLocked(scene, ['a', 'b', 'c'])).toBe(false)
    scene.plants[3] = { ...scene.plants[3]!, locked: true }
    expect(isPlantRowLocked(scene, ['a', 'b', 'c']), 'a locked plant of no row').toBe(false)
    scene.plants[1] = { ...scene.plants[1]!, locked: true }
    expect(isPlantRowLocked(scene, ['a', 'b', 'c']), 'a locked member').toBe(true)
    scene.plants[1] = { ...scene.plants[1]!, locked: false }
    scene.layers = [{ kind: 'layer', name: 'plants', visible: true, locked: true, opacity: 1 }]
    expect(isPlantRowLocked(scene, ['a', 'b', 'c']), 'the Plants layer locked').toBe(true)
  })
})
