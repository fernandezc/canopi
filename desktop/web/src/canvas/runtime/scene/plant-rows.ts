/**
 * Planted rows (plan §4, "2.0 plant along a path"; A5). Which plants a row holds is derived on read: a member is
 * attached while its plant exists and lies within 1 mm of its `at`. Only the row writer sets `at`, so any other move,
 * nudge, alignment, cut or delete detaches a plant with no hook in its writer, and a plant moved back exactly
 * re-attaches. This module never imports the path engine (callers pass positions), and the scene transactions never
 * import it (P55).
 */
import { createUuid } from '../../../utils/ids'
import { createPlantSpacingGeneratedPlants } from '../../plant-spacing-sequence'
import type { SceneDesignObjectSelection } from './design-object-targets'
import { isSceneLayerEditable } from './locks'
import type { ScenePersistedState, ScenePlantEntity, ScenePlantRowEntity, ScenePoint } from './types'

type PlantRowMember = ScenePlantRowEntity['members'][number]

/** A row adds at most this many plants beside its first: Plant a row's commit limit, and the most one edit re-spaces. */
export const PLANT_ROW_MAX_ADDED_PLANTS = 5_000

/** The Scene Edit of every change to a planted row's points or spacing (A7). */
export const PLANT_ROW_EDIT = 'interaction-plant-row-edit'

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
 * out of any other row, which goes when it has no member left. Returns the members' ids in path order for the caller
 * to select, or null (nothing written) without a position or a first plant. The caller runs it in one Scene Edit.
 */
export function applyPlantRowPositions(draft: ScenePersistedState, write: PlantRowWrite): string[] | null {
  const existing = draft.plantRows.find((row) => row.id === write.id)
  const plants = plantsById(draft)
  const kept = existing ? attachedPlantRowMembers(existing, plants).map((member) => member.plantId) : []
  const memberIds = kept.length > 0 ? kept : write.firstPlantId !== undefined ? [write.firstPlantId] : []
  const first = memberIds.length > 0 ? plants.get(memberIds[0]!) : undefined
  if (!first || write.positions.length === 0) return null

  const reused = memberIds.slice(0, write.positions.length)
  const surplus = new Set(memberIds.slice(write.positions.length))
  const copies = createPlantSpacingGeneratedPlants(first, write.positions.slice(reused.length), write.createId)
  const ids = [...reused, ...copies.map((copy) => copy.id)]
  const moved = new Map(reused.map((id, index) => [id, write.positions[index]!]))

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
    members: ids.map((plantId, index) => ({ plantId, at: { ...write.positions[index]! } })),
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

/** The part of an open Scene Edit a row write uses. */
interface PlantRowEditTransaction {
  mutate(edit: (draft: ScenePersistedState) => void): void
  setSelection(targets: Iterable<SceneDesignObjectSelection[number]>): void
}

/** The plants a path takes beside its first point, as the engine places them (plant-path/spacing.ts plantAlongPath). */
interface PlantRowPlanting {
  readonly count: number
  positions(): readonly ScenePoint[]
}

/**
 * Inside the open Scene Edit `tx`: rewrites `row` along `path` with `spacing`, its plants where `planting` (the engine's
 * answer for that path and spacing) puts them, and selects its members (A7). False, with nothing written, when the row
 * would add no plant or more than the limit.
 */
export function respacePlantRow(
  tx: PlantRowEditTransaction,
  row: ScenePlantRowEntity,
  path: Pick<ScenePlantRowEntity, 'anchors' | 'closed'>,
  spacing: ScenePlantRowEntity['spacing'],
  planting: PlantRowPlanting,
): boolean {
  const first = path.anchors[0]
  if (!first || planting.count === 0 || planting.count > PLANT_ROW_MAX_ADDED_PLANTS) return false
  const positions = [first.position, ...planting.positions()]
  const written: { members: readonly string[] | null } = { members: null }
  tx.mutate((draft) => {
    written.members = applyPlantRowPositions(draft, {
      id: row.id,
      anchors: path.anchors,
      closed: path.closed,
      spacing,
      positions,
      createId: createUuid,
    })
  })
  if (!written.members) return false
  tx.setSelection(written.members.map((id) => ({ kind: 'plant' as const, id })))
  return true
}

/** The row a selection belongs to: its attached members in path order, and whether the selection is all of them. */
interface SelectedPlantRow {
  readonly row: ScenePlantRowEntity
  readonly members: readonly string[]
  readonly whole: boolean
}

/**
 * The row whose attached plants hold every selected target, or null when the selection is empty, holds anything but
 * plants, or a plant of no row or of two. A row is selected, and Select edits it, when `whole` (A7).
 */
export function rowOfSelection(
  scene: Pick<ScenePersistedState, 'plants' | 'plantRows'>,
  selection: SceneDesignObjectSelection,
): SelectedPlantRow | null {
  if (selection.length === 0 || selection.some((target) => target.kind !== 'plant')) return null
  const selected = new Set(selection.map((target) => target.id))
  const plants = plantsById(scene)
  for (const row of scene.plantRows) {
    const members = attachedPlantRowMembers(row, plants).map((member) => member.plantId)
    if (!members.some((id) => selected.has(id))) continue
    const inRow = new Set(members)
    if (![...selected].every((id) => inRow.has(id))) return null
    return { row, members, whole: members.length === selected.size }
  }
  return null
}

/**
 * A row takes no edit while one of its attached members (`members`), or the Plants layer, is locked (A7's lock table):
 * Select shows its curve without points, and the selection chip disables its spacing.
 */
export function isPlantRowLocked(scene: Readonly<ScenePersistedState>, members: readonly string[]): boolean {
  if (!isSceneLayerEditable(scene, 'plants')) return true
  const ids = new Set(members)
  return scene.plants.some((plant) => plant.locked && ids.has(plant.id))
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
