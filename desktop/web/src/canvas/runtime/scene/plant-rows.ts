/**
 * Planted rows (plan §4, "2.0 plant along a path"; A5). Which plants a row holds is derived on read: a member is
 * attached while its plant exists and lies within 1 mm of its `at`. No edit writes a row since Plant a row stopped
 * storing one (answer 27), so any move, nudge, rotation, cut or delete detaches a plant. The scene transactions never
 * import this module (P55).
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
