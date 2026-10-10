// canvas/point-editor/rules.ts
//
// The one point contract (plan §4 "2.0 plant along a path", A2; spec §1.11 and §3.2) for row points, while drawing and
// under Select, and for polygon zone corners alike: what a press on a point or a midpoint dot does, which entries the
// point menu offers, and how close to the first point a press closes a loop. Pure and framework-free: the point editor
// imports only its own modules and types (frontend-architecture-policies, P54).

import type { PointerKind } from '../runtime/interaction-types'

/** A press this close to the first point, on screen, closes the shape: a finger's within half ADR 0010's 44 px target. */
export const CLOSE_DISTANCE_PX: Readonly<Record<PointerKind, number>> = Object.freeze({ mouse: 8, pen: 8, touch: 22 })

/** What the point menu and the tool card do to one point. */
export type PointAction = 'delete-point' | 'sharp-corner' | 'smooth-corner'

export interface PointMenuItem {
  readonly action: PointAction
  /** Delete point below the minimum (2 points on an open row, 3 on a loop or a polygon) is shown but refused. */
  readonly disabled: boolean
}

/** A handle press as the host reports it (`handle-drag` start). */
export interface PointPress {
  readonly role: 'point' | 'dot'
  readonly clickCount: number
  readonly alt: boolean
  /** The press is on the last point of a draft being drawn (a double-click there finishes). */
  readonly isLastDraftPoint: boolean
}

/**
 * The A2 table. 'move': the point follows a drag, and a still press only makes it the last-touched point; 'delete':
 * Alt+click (the caller refuses below the minimum); 'finish': a double-click on the last draft point; 'insert-drag': a
 * press on a dot inserts a point there once it drags, and a still press inserts nothing; 'insert': a double-click on a
 * dot inserts a point in place.
 */
export type PointPressIntent = 'delete' | 'finish' | 'move' | 'insert' | 'insert-drag'

export function pointPressIntent(press: PointPress): PointPressIntent {
  if (press.role === 'dot') return press.clickCount >= 2 ? 'insert' : 'insert-drag'
  if (press.alt) return 'delete'
  if (press.clickCount >= 2 && press.isLastDraftPoint) return 'finish'
  return 'move'
}

/** The point menu's entries: Delete point, then on a row point (sharpable) Sharp corner or Smooth corner. */
export function pointMenuItems(point: {
  readonly sharpable: boolean
  readonly sharp: boolean
  readonly canDelete: boolean
}): readonly PointMenuItem[] {
  const items: PointMenuItem[] = [{ action: 'delete-point', disabled: !point.canDelete }]
  if (point.sharpable) items.push({ action: point.sharp ? 'smooth-corner' : 'sharp-corner', disabled: false })
  return items
}
