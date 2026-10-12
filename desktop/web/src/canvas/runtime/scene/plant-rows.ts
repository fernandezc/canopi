/**
 * Planted rows (plan §4, "2.0 plant along a path"; A5). Which plants a row holds is derived on read: a member is
 * attached while its plant exists and lies within 1 mm of its `at`. No edit writes a row since Plant a row stopped
 * storing one (answer 27): a move, nudge, cut or delete detaches a plant, and a whole-row move carries the row. The
 * scene transactions never import this module (P55).
 */
import type { ScenePersistedState, ScenePlantEntity, ScenePlantRowEntity, ScenePoint } from './types'

type PlantRowMember = ScenePlantRowEntity['members'][number]

/** A member is attached while its plant lies within this distance of its `at`, in plane metres. */
const ATTACHED_WITHIN_M = 0.001

/** The scene's plants by id, for the attachment reads below. */
export function plantsById(scene: Pick<ScenePersistedState, 'plants'>): ReadonlyMap<string, ScenePlantEntity> {
  return new Map(scene.plants.map((plant) => [plant.id, plant]))
}

/** The row's attached members, in path order. */
export function attachedPlantRowMembers(
  row: ScenePlantRowEntity,
  plants: ReadonlyMap<string, ScenePlantEntity>,
): PlantRowMember[] {
  return row.members.filter((member) => {
    const plant = plants.get(member.plantId)
    return plant !== undefined
      && distance(plant.position, member.at) <= ATTACHED_WITHIN_M
  })
}

function distance(a: ScenePoint, b: ScenePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** The rows a move carries, as they were when it started: each one with only its attached members (A11). */
export type PlantRowStarts = ReadonlyMap<string, ScenePlantRowEntity>

/**
 * The rows that move whole with a set of moving plants: each row with an attached member whose attached members all
 * move. Move-drag, the keyboard nudge and rotation capture them with their plants, and carry them through
 * `transformPlantRows`; a mover that does not leaves the plants and the row dissolves into plain plants.
 */
export function plantRowsMovingWith(
  scene: Pick<ScenePersistedState, 'plants' | 'plantRows'>,
  moving: { has(plantId: string): boolean },
): PlantRowStarts {
  const plants = plantsById(scene)
  const starts = new Map<string, ScenePlantRowEntity>()
  for (const row of scene.plantRows) {
    const members = attachedPlantRowMembers(row, plants)
    if (members.length === 0 || !members.every((member) => moving.has(member.plantId))) continue
    starts.set(row.id, { ...row, members })
  }
  return starts
}

/** Applies the move's transform to each carried row's points and members' `at`, from where they started. */
export function transformPlantRows(
  draft: ScenePersistedState,
  starts: PlantRowStarts,
  transform: (point: ScenePoint) => ScenePoint,
): void {
  if (starts.size === 0) return
  draft.plantRows = draft.plantRows.map((row) => {
    const start = starts.get(row.id)
    if (!start) return row
    return {
      ...start,
      anchors: start.anchors.map((anchor) => ({ position: transform(anchor.position), sharp: anchor.sharp })),
      members: start.members.map((member) => ({ plantId: member.plantId, at: transform(member.at) })),
    }
  })
}
