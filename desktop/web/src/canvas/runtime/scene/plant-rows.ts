/**
 * Planted rows (plan §4, "2.0 plant along a path"; A5). Which plants a row holds is derived on read: a member is
 * attached while its plant exists and lies within 1 mm of its `at`. Only the row writer sets `at`, so any other move,
 * nudge, alignment, cut or delete detaches a plant with no hook in its writer, and a plant moved back exactly
 * re-attaches. This module never imports the path engine (callers pass positions), and the scene transactions never
 * import it (P55).
 */
import type { ScenePersistedState, ScenePlantEntity, ScenePlantRowEntity } from './types'

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
      && Math.hypot(plant.position.x - member.at.x, plant.position.y - member.at.y) <= ATTACHED_WITHIN_M
  })
}
