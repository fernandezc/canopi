// canvas/runtime/tools/select/row-points.ts
//
// Owns editing a planted row under Select (plan §4 "2.0 plant along a path", A7; spec §1.11, §3.2). A row is selected
// when the selection is exactly its attached members (scene/plant-rows.ts rowOfSelection). Select then draws the row's
// curve as its draft and shows its points and midpoint dots through the shared point editor (point-editor/layout.ts,
// ids `point:<row id>:<i>` and `dot:<row id>:<i>`). Its presses follow the one point contract (point-editor/rules.ts,
// anchors.ts): a point drags, a dot's drag inserts a point where it is released, its double-click inserts one in place,
// Alt+click deletes one. A drag changes nothing in the Scene before its release: the moved curve and the re-spaced
// plants follow it as the draft. Each edit is one Scene Edit ('interaction-plant-row-edit', respacePlantRow): the
// engine (canvas/plant-path/) places every plant along the new path and the row writer (applyPlantRowPositions) keeps
// the member ids in path order, adds copies of the first member, deletes the surplus, rewrites the row and selects its
// members. Every point of a row may move or go, the first included (the first member follows it).

import { createUuid } from '../../../../utils/ids'
import { flattenPath, type PathPoints } from '../../../plant-path/curve'
import { plantAlongPath, type PathSpacing } from '../../../plant-path/spacing'
import { createPlantSpacingGeneratedPlants } from '../../../plant-spacing-sequence'
import { insertAfter, movePoint } from '../../../point-editor/anchors'
import { dotHandles, pointHandles } from '../../../point-editor/layout'
import type { SceneEditTransaction } from '../../scene-runtime/transactions'
import type { SceneDesignObjectSelection } from '../../scene/design-object-targets'
import { applyPlantRowPositions, PLANT_ROW_MAX_ADDED_PLANTS, rowOfSelection } from '../../scene/plant-rows'
import type { ScenePersistedState, ScenePlantEntity, ScenePlantRowEntity } from '../../scene/types'
import type { WorldPoint } from '../../view/types'
import type { DraftPresentation, DraftShape, DraftStroke, ToolHandle } from '../draft'
import type { ToolContext } from '../tool'
import type { HandleSize } from './handle-size'

/** The Scene Edit of every change to a planted row's path or spacing. */
export const PLANT_ROW_EDIT = 'interaction-plant-row-edit'
/** The row tool's dashed guide and its plant discs (plant-row.ts), so a row looks the same drawn and edited. */
const ROW_CURVE_STROKE: DraftStroke = Object.freeze({ token: 'selection', widthPx: 2, dash: Object.freeze([6, 6]) })
const ROW_GHOST_OPACITY = 0.35

/** The row the selection is: all of its attached members, and the first one's plant. */
export interface SelectedPlantRow {
  readonly row: ScenePlantRowEntity
  readonly path: PathPoints
  readonly first: ScenePlantEntity
}

/** A live press on a row point or dot, and where the pointer has taken it (null until it drags). */
export type RowPointDrag =
  | { readonly kind: 'move'; readonly index: number; at: WorldPoint | null }
  | { readonly kind: 'insert'; readonly after: number; at: WorldPoint | null }

/** The selected row, when the selection is exactly a row's attached members (A7); null otherwise. */
export function selectedPlantRow(
  scene: Readonly<ScenePersistedState>,
  selection: SceneDesignObjectSelection,
): SelectedPlantRow | null {
  const selected = rowOfSelection(scene, selection)
  if (!selected?.whole) return null
  const first = scene.plants.find((plant) => plant.id === selected.members[0])
  if (!first) return null
  return { row: selected.row, path: { points: selected.row.anchors, closed: selected.row.closed }, first }
}

/** The path with the live drag applied. */
export function draggedRowPath(path: PathPoints, drag: RowPointDrag | null): PathPoints {
  if (!drag?.at) return path
  return drag.kind === 'move' ? movePoint(path, drag.index, drag.at) : insertAfter(path, drag.after, drag.at)
}

/** The row's point handles and, outside a drag, its dots. */
export function rowHandles(
  ctx: ToolContext,
  selected: SelectedPlantRow,
  path: PathPoints,
  size: HandleSize,
  dragging: boolean,
): ToolHandle[] {
  const { id } = selected.row
  const points = pointHandles(id, path, size, (index) => ctx.translate('canvas.plantRow.point', { index: index + 1 }))
  if (dragging) return points
  const dots = dotHandles(id, path, (a, b) => ctx.view.screenDistance(a, b), size,
    (index) => ctx.translate('canvas.plantRow.dot', { index: index + 1 }))
  return [...points, ...dots]
}

/** The row's curve; while a point drags, also a disc where each plant of the re-spaced row would stand. */
export function rowDraft(selected: SelectedPlantRow, path: PathPoints, dragging: boolean): DraftPresentation {
  const shapes: DraftShape[] = [{ kind: 'polyline', points: flattenPath(path).vertices, style: ROW_CURVE_STROKE }]
  const positions = dragging ? rowPlantPositions(path, selected.row.spacing) : null
  const ghosts = positions
    ? createPlantSpacingGeneratedPlants(selected.first, positions, (index) => `plant-row-ghost-${index}`)
    : []
  for (const plant of ghosts) {
    shapes.push({
      kind: 'ghost',
      entity: { kind: 'plant', plant, mark: 'dot', sizeFrom: selected.first.position },
      opacity: ROW_GHOST_OPACITY,
    })
  }
  return { shapes }
}

/**
 * Every plant of a row along `path`, in path order, the first on the first point; null when the row would add none or
 * more than the limit (the edit is refused, and the row keeps its plants).
 */
function rowPlantPositions(path: PathPoints, spacing: PathSpacing): WorldPoint[] | null {
  const first = path.points[0]
  if (!first) return null
  const planting = plantAlongPath(path, spacing)
  if (planting.count === 0 || planting.count > PLANT_ROW_MAX_ADDED_PLANTS) return null
  return [first.position, ...planting.positions()]
}

/**
 * Inside the open Scene Edit `tx`: re-spaces `row` along `path` with `spacing` and selects its members. False, with
 * nothing written, when the row would add no plant or more than the limit.
 */
export function respacePlantRow(
  tx: Pick<SceneEditTransaction, 'mutate' | 'setSelection'>,
  row: ScenePlantRowEntity,
  path: PathPoints,
  spacing: PathSpacing,
): boolean {
  const positions = rowPlantPositions(path, spacing)
  if (!positions) return false
  const written: { members: readonly string[] | null } = { members: null }
  tx.mutate((draft) => {
    written.members = applyPlantRowPositions(draft, {
      id: row.id,
      anchors: path.points.map((point) => ({ position: { ...point.position }, sharp: point.sharp })),
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

/** Re-spaces the selected row along `path` in one Scene Edit that selects its members; false when refused. */
export function editPlantRow(ctx: ToolContext, selected: SelectedPlantRow, path: PathPoints): boolean {
  return ctx.effects.edits.run(PLANT_ROW_EDIT, (tx) => {
    respacePlantRow(tx, selected.row, path, selected.row.spacing)
  })
}
