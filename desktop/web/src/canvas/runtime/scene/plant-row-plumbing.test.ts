import { describe, expect, it } from 'vitest'

import { createScenePatchCommand, applySceneCommandPersistedPatch } from '../scene-commands'
import { cloneScenePersistedState, createDefaultScenePersistedState, ScenePlaneReprojector, type ScenePlantRowEntity } from '.'
import { createSessionPlane } from '../../session-plane'

const ROW: ScenePlantRowEntity = {
  kind: 'plant-row',
  id: 'row-1',
  anchors: [
    { position: { x: 0, y: 0 }, sharp: false },
    { position: { x: 4, y: 3 }, sharp: true },
    { position: { x: 8, y: 0 }, sharp: false },
  ],
  closed: false,
  spacing: { kind: 'interval', metres: 2 },
  members: [{ plantId: 'p1', at: { x: 0, y: 0 } }, { plantId: 'p2', at: { x: 2, y: 1 } }],
}

describe('plant rows in the scene plumbing (A6)', () => {
  it('an edit that changes the rows carries them in its undo and redo patches', () => {
    const before = createDefaultScenePersistedState()
    const after = { ...before, plantRows: [ROW] }
    const command = createScenePatchCommand('add-row', { persisted: before, selectedTargets: [] }, { persisted: after, selectedTargets: [] })
    expect(command?.before.persisted?.plantRows).toEqual([])
    expect(command?.after.persisted?.plantRows).toEqual([ROW])
    const draft = createDefaultScenePersistedState()
    applySceneCommandPersistedPatch(draft, command!.after)
    expect(draft.plantRows).toEqual([ROW])
  })

  it('a clone shares no row, anchor, spacing or member object with the original', () => {
    const state = { ...createDefaultScenePersistedState(), plantRows: [ROW] }
    const clone = cloneScenePersistedState(state)
    expect(clone.plantRows).toEqual([ROW])
    expect(clone.plantRows[0]).not.toBe(ROW)
    expect(clone.plantRows[0]!.anchors[0]!.position).not.toBe(ROW.anchors[0]!.position)
    expect(clone.plantRows[0]!.spacing).not.toBe(ROW.spacing)
    expect(clone.plantRows[0]!.members[1]!.at).not.toBe(ROW.members[1]!.at)
  })

  it('a re-origin moves the rows anchors and members at exactly as it moves a plant there', () => {
    const previous = createSessionPlane({ lon: 6, lat: 45 })
    const reprojector = new ScenePlaneReprojector(previous, { lon: 6.003, lat: 45.002 })
    const plant = { ...createDefaultScenePersistedState(), plants: [] }
    const moved = reprojector.persisted({ ...plant, plantRows: [ROW] })
    const row = moved.plantRows[0]!
    expect(row.anchors.map((anchor) => anchor.position)).toEqual(ROW.anchors.map((anchor) => reprojector.point(anchor.position)))
    expect(row.anchors.map((anchor) => anchor.sharp)).toEqual([false, true, false])
    expect(row.members.map((member) => member.at)).toEqual(ROW.members.map((member) => reprojector.point(member.at)))
    expect(row.members[1]!.at.x).not.toBeCloseTo(2, 3)
    expect(reprojector.persisted({ plantRows: [ROW] })).toEqual({ plantRows: [row] })
    expect(reprojector.persisted({ plants: [] })).toEqual({ plants: [] })
  })
})
