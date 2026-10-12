/**
 * Planted rows (plan §4, "2.0 plant along a path"; A5). Which plants a row holds is derived on read: a member is
 * attached while its plant exists and lies within 1 mm of its `at`. Only the row writer sets `at`, so any other move,
 * nudge, alignment, cut or delete detaches a plant with no hook in its writer, and a plant moved back exactly
 * re-attaches. This module never imports the path engine (callers pass positions), and the scene transactions never
 * import it (P55).
 */
import { createPlantSpacingGeneratedPlants } from '../../plant-spacing-sequence'
import type { ScenePersistedState, ScenePlantEntity, ScenePlantRowEntity, ScenePoint } from './types'

type PlantRowMember = ScenePlantRowEntity['members'][number]

/** A row adds at most this many plants beside its first: Plant a row's commit limit, and the most one edit re-spaces. */
export const PLANT_ROW_MAX_ADDED_PLANTS = 5_000

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

/** A row write: the path the plants follow and every plant position along it, in path order, the first included. */
interface PlantRowWrite {
  /** The row to rewrite, or a new row's id. */
  readonly id: string
  /** A new row's first plant (the picked plant); a row that exists keeps its own. */
  readonly firstPlantId?: string
  readonly anchors: ScenePlantRowEntity['anchors']
  readonly closed: boolean
  readonly spacing: ScenePlantRowEntity['spacing']
  readonly positions: readonly ScenePoint[]
  /** The id of each plant the write adds. */
  readonly createId: () => string
}

/**
 * The row writer, the only code that sets a member's `at` (A5, A7). It keeps the row's attached member ids in path
 * order and moves them onto `positions`, adds copies of the first member for extra positions, deletes the surplus
 * plants (and takes them out of their groups), rewrites the anchors, spacing and every `at`, and takes the members
 * out of any other row, which goes when it has no member left. A new row plants every position; a re-space plants
 * those `respacedPlantRowPositions` keeps. Returns the members' ids in path
 * order for the caller to select, or null (nothing written) without a position or a first plant. The caller runs it
 * in one Scene Edit.
 */
export function applyPlantRowPositions(draft: ScenePersistedState, write: PlantRowWrite): string[] | null {
  const existing = draft.plantRows.find((row) => row.id === write.id)
  const plants = plantsById(draft)
  const kept = existing ? attachedPlantRowMembers(existing, plants).map((member) => member.plantId) : []
  const memberIds = kept.length > 0 ? kept : write.firstPlantId !== undefined ? [write.firstPlantId] : []
  const first = memberIds.length > 0 ? plants.get(memberIds[0]!) : undefined
  const positions = existing ? respacedPlantRowPositions(draft, plants, existing, write.positions) : write.positions
  if (!first || positions.length === 0) return null

  const reused = memberIds.slice(0, positions.length)
  const surplus = new Set(memberIds.slice(positions.length))
  const copies = createPlantSpacingGeneratedPlants(first, positions.slice(reused.length), write.createId)
  const ids = [...reused, ...copies.map((copy) => copy.id)]
  const moved = new Map(reused.map((id, index) => [id, positions[index]!]))

  draft.plants = [
    ...draft.plants.flatMap((plant) => {
      if (surplus.has(plant.id)) return []
      const position = moved.get(plant.id)
      return [position ? { ...plant, position: { ...position } } : plant]
    }),
    ...copies,
  ]
  if (surplus.size > 0) {
    draft.groups = draft.groups
      .map((group) => ({
        ...group,
        members: group.members.filter((member) => !(member.kind === 'plant' && surplus.has(member.id))),
      }))
      .filter((group) => group.members.length >= 2)
  }

  const row: ScenePlantRowEntity = {
    kind: 'plant-row',
    id: write.id,
    anchors: write.anchors.map((anchor) => ({ position: { ...anchor.position }, sharp: anchor.sharp })),
    closed: write.closed,
    spacing: { ...write.spacing },
    members: ids.map((plantId, index) => ({ plantId, at: { ...positions[index]! } })),
  }
  const members = new Set(ids)
  const rows = draft.plantRows.flatMap((other) => {
    if (other.id === write.id) return [row]
    const left = other.members.filter((member) => !members.has(member.plantId))
    if (left.length === 0) return []
    return [left.length === other.members.length ? other : { ...other, members: left }]
  })
  draft.plantRows = existing ? rows : [...rows, row]
  return ids
}

/**
 * The positions a re-space of `row` plants (A7): `positions` less each spot another row's first plant holds. Only a
 * row's first plant can have come from another row (a row started from a member takes it), so each other row's
 * attached first plant holds the position nearest it when it stands within half a gap of it (half the distance to the
 * nearer neighbouring position) and `row` has no plant of its own there: the spot it gave away. "No plant there" is
 * judged on the row's spacing before this re-space (no attached member within half its own old gap), not the new
 * one, since a gap more than twice the old would take in the old neighbours of the spot. That spot stays the other
 * row's however this row's points or spacing change, and fills again once that plant has moved off. Linear in the
 * positions and members for each first plant near them.
 */
function respacedPlantRowPositions<Point extends ScenePoint>(
  scene: Pick<ScenePersistedState, 'plantRows'>,
  plants: ReadonlyMap<string, ScenePlantEntity>,
  row: ScenePlantRowEntity,
  positions: readonly Point[],
): readonly Point[] {
  if (positions.length < 2) return positions
  const own = oldPlantRowCells(row, plants)
  const ownIds = new Set(own.map((cell) => cell.plantId))
  const halfGaps = positions.map((position, index) => 0.5 * Math.min(
    index > 0 ? distance(position, positions[index - 1]!) : Infinity,
    index < positions.length - 1 ? distance(position, positions[index + 1]!) : Infinity,
  ))
  const reach = Math.max(...halfGaps)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const { x, y } of positions) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  const left = new Set<number>()
  for (const other of scene.plantRows) {
    const first = other.members[0]
    if (other.id === row.id || !first || ownIds.has(first.plantId)) continue
    const plant = plants.get(first.plantId)
    if (!plant || distance(plant.position, first.at) > ATTACHED_WITHIN_M) continue
    const { x, y } = plant.position
    if (x < minX - reach || x > maxX + reach || y < minY - reach || y > maxY + reach) continue
    let nearest = 0
    for (let index = 1; index < positions.length; index++) {
      if (distance(positions[index]!, plant.position) < distance(positions[nearest]!, plant.position)) nearest = index
    }
    const halfGap = halfGaps[nearest]!
    if (distance(positions[nearest]!, plant.position) >= halfGap) continue
    if (own.some((cell) => distance(cell.at, plant.position) < (cell.halfGap ?? halfGap))) continue
    left.add(nearest)
  }
  return left.size === 0 ? positions : positions.filter((_, index) => !left.has(index))
}

/**
 * The row's attached members, each with half the gap to its nearer neighbour among the row's written spots (every
 * member's `at`, in path order): the spacing the row had before a re-space. A row of one spot has no old gap (null),
 * and the caller falls back to the new one.
 */
function oldPlantRowCells(
  row: ScenePlantRowEntity,
  plants: ReadonlyMap<string, ScenePlantEntity>,
): Array<PlantRowMember & { readonly halfGap: number | null }> {
  const attached = new Set(attachedPlantRowMembers(row, plants))
  const spots = row.members
  return spots.flatMap((member, index) => {
    if (!attached.has(member)) return []
    const gap = Math.min(
      index > 0 ? distance(member.at, spots[index - 1]!.at) : Infinity,
      index < spots.length - 1 ? distance(member.at, spots[index + 1]!.at) : Infinity,
    )
    return [{ ...member, halfGap: Number.isFinite(gap) ? 0.5 * gap : null }]
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
