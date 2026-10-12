import { describe, expect, it } from 'vitest'

import { createDefaultScenePersistedState } from './defaults'
import { applyPlantRowPositions, attachedPlantRowMembers, plantsById } from './plant-rows'
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

  it('a new row plants every position it is given, even where another row\'s plant stands', () => {
    // Drawn from a every metre over the first plant of row 3: the count the tool shows is the count planted.
    const scene = sceneWithRow()
    const positions = [0, 1, 2, 3, 4].map((step) => ({ x: step * 0.8, y: step * 0.6 }))
    scene.plants = scene.plants.map((entry) => entry.id === 'loose' ? { ...entry, position: positions[2]! } : entry)
    applyPlantRowPositions(scene, {
      id: 'row-3', firstPlantId: 'loose', anchors: ANCHORS, closed: false, spacing: { kind: 'interval', metres: 5 },
      positions: [positions[2]!, { x: 6.6, y: 1.2 }], createId: () => 'row-3-copy',
    })
    const members = applyPlantRowPositions(scene, {
      id: 'row-2', firstPlantId: 'a', anchors: ANCHORS, closed: false, spacing: { kind: 'interval', metres: 1 }, positions,
      createId: ids(),
    })
    expect(members).toEqual(['a', 'new-1', 'new-2', 'new-3', 'new-4'])
  })

  describe('the spot a row left to another row', () => {
    const at = (x: number, y = 0): ScenePoint => ({ x, y })
    const straight = (length: number): ScenePlantRowEntity['anchors'] =>
      [{ position: at(0), sharp: false }, { position: at(length), sharp: false }]
    /** Hedge `hedge` (h0…h10 every 1 m along 10 m) whose h5 started side row `side`, which runs 2 m off the hedge. */
    function hedgeWithSideRow(): ScenePersistedState {
      const scene = createDefaultScenePersistedState()
      scene.plants = Array.from({ length: 11 }, (_, index) => plant(`h${index}`, at(index)))
      scene.plantRows = [{
        kind: 'plant-row', id: 'hedge', anchors: straight(10), closed: false, spacing: { kind: 'interval', metres: 1 },
        members: scene.plants.map((entry) => ({ plantId: entry.id, at: { ...entry.position } })),
      }]
      applyPlantRowPositions(scene, {
        id: 'side', firstPlantId: 'h5', anchors: [{ position: at(5), sharp: false }, { position: at(5, 2), sharp: false }],
        closed: false, spacing: { kind: 'interval', metres: 2 }, positions: [at(5), at(5, 2)], createId: ids(),
      })
      return scene
    }
    const respace = (scene: ScenePersistedState, length: number, positions: readonly ScenePoint[]) =>
      applyPlantRowPositions(scene, {
        id: 'hedge', anchors: straight(length), closed: false, spacing: { kind: 'interval', metres: 1 }, positions,
        createId: ids(),
      })
    /** The plants within half a metre of h5, which must be h5 alone. */
    const besideH5 = (scene: ScenePersistedState) => {
      const h5 = plantsById(scene).get('h5')!.position
      return scene.plants.filter((entry) => Math.hypot(entry.position.x - h5.x, entry.position.y - h5.y) < 0.5)
        .map((entry) => entry.id)
    }

    it('stays the other row\'s when the hedge\'s points move a little', () => {
      const scene = hedgeWithSideRow()
      const members = respace(scene, 10.002, Array.from({ length: 11 }, (_, index) => at(index + 0.002)))
      expect(members, 'the hedge keeps its ten plants').toHaveLength(10)
      expect(besideH5(scene), 'no plant 2 mm from h5').toEqual(['h5'])
    })

    it('stays the other row\'s when the hedge\'s spots change (Plants: 11 spots over 10.5 m)', () => {
      const scene = hedgeWithSideRow()
      const members = respace(scene, 10.5, Array.from({ length: 11 }, (_, index) => at(index * 1.05)))
      expect(members, 'ten plants and the spot nearest h5 left to it').toHaveLength(10)
      expect(besideH5(scene), 'no plant 25 cm from h5').toEqual(['h5'])
    })

    it('stays the other row\'s when the hedge\'s gap grows past twice its old gap', () => {
      // Its old neighbours h4 and h6 lie 1 m from h5, inside half a 2.5 m or 5 m gap: they are not a plant there.
      for (const [gap, count] of [[2.5, 4], [5, 2]] as const) {
        const scene = hedgeWithSideRow()
        const members = respace(scene, 10, Array.from({ length: 10 / gap + 1 }, (_, index) => at(index * gap)))
        expect(members, `a ${gap} m gap keeps every spot but h5's`).toHaveLength(count)
        expect(besideH5(scene), `no plant on h5 at a ${gap} m gap`).toEqual(['h5'])
      }
    })

    it('stays the other row\'s when the hedge goes back to its old gap after a wider one', () => {
      const scene = hedgeWithSideRow()
      respace(scene, 10, Array.from({ length: 5 }, (_, index) => at(index * 2.5)))
      expect(respace(scene, 10, Array.from({ length: 11 }, (_, index) => at(index))), 'all but h5\'s spot').toHaveLength(10)
      expect(besideH5(scene), 'no plant on h5').toEqual(['h5'])
    })

    it('stays the other row\'s when that row moves its plant a little', () => {
      const scene = hedgeWithSideRow()
      applyPlantRowPositions(scene, {
        id: 'side', anchors: [{ position: at(5.002), sharp: false }, { position: at(5.002, 2), sharp: false }],
        closed: false, spacing: { kind: 'interval', metres: 2 }, positions: [at(5.002), at(5.002, 2)], createId: ids(),
      })
      respace(scene, 10, Array.from({ length: 11 }, (_, index) => at(index)))
      expect(besideH5(scene), 'no plant 2 mm from h5').toEqual(['h5'])
    })

    it('fills again once that plant has moved off', () => {
      const scene = hedgeWithSideRow()
      applyPlantRowPositions(scene, {
        id: 'side', anchors: [{ position: at(5, 3), sharp: false }, { position: at(5, 5), sharp: false }],
        closed: false, spacing: { kind: 'interval', metres: 2 }, positions: [at(5, 3), at(5, 5)], createId: ids(),
      })
      expect(respace(scene, 10, Array.from({ length: 11 }, (_, index) => at(index)))).toHaveLength(11)
    })

    it('is only a spot the row has no plant on: a row planted beside another row\'s first plant keeps its plants', () => {
      // A second hedge 30 cm beside the first, starting at its 3 m plant: each hedge keeps every plant.
      const scene = hedgeWithSideRow()
      scene.plants.push(plant('twin', at(3, 0.3)))
      applyPlantRowPositions(scene, {
        id: 'twin-row', firstPlantId: 'twin', anchors: [{ position: at(3, 0.3), sharp: false }, { position: at(6, 0.3), sharp: false }],
        closed: false, spacing: { kind: 'interval', metres: 1 }, positions: [0, 1, 2, 3].map((step) => at(3 + step, 0.3)),
        createId: ids(),
      })
      expect(respace(scene, 10, Array.from({ length: 11 }, (_, index) => at(index))), 'all but h5\'s spot').toHaveLength(10)
    })

    it('costs the write next to nothing however many plants other rows hold', () => {
      // 40 rows of 500 plants beside a 5,001-plant re-space: a check per held plant and position took seconds.
      const scene = hedgeWithSideRow()
      for (let row = 0; row < 40; row++) {
        const plants = Array.from({ length: 500 }, (_, index) => plant(`r${row}-${index}`, at(index * 0.5, 10 + row)))
        scene.plants.push(...plants)
        scene.plantRows.push({
          kind: 'plant-row', id: `r${row}`, anchors: straight(250), closed: false, spacing: { kind: 'interval', metres: 0.5 },
          members: plants.map((entry) => ({ plantId: entry.id, at: { ...entry.position } })),
        })
      }
      const started = performance.now()
      expect(respace(scene, 1000, Array.from({ length: 5001 }, (_, index) => at(index * 0.2, 0.001)))).toHaveLength(5000)
      expect(performance.now() - started).toBeLessThan(1000)
    })
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
