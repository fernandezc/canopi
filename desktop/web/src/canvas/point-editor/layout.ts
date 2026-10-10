// canvas/point-editor/layout.ts
//
// A path's point and midpoint-dot handles (plan §4 "2.0 plant along a path", A15; spec §1.11, §3.2): a point is a
// `vertex` handle (`corner` when sharp) with id `point:<owner>:<index>`; the dot of the segment from point i to the next
// (the closing segment last on a loop) sits halfway along it on the curve, a faint `midpoint` handle with id
// `dot:<owner>:<i>`, shown only where the segment spans `size.minMidpointEdgePx` on screen, so a dot never covers a
// point and keeps room on the curve between them (select/handle-size.ts). Handle sizes follow the pointer that last
// pressed or hovered (44 px targets after a finger). Pure: types and the curve only (P54).

import { segmentMidpoints, type PathPoints } from '../plant-path/curve'
import type { ToolHandleId } from '../runtime/interaction-types'
import type { ToolHandle } from '../runtime/tools/draft'
import type { HandleSize } from '../runtime/tools/select/handle-size'
import type { WorldPoint } from '../runtime/view/types'

/** The aria-label of the handle of point or segment `index`, translated by the caller. */
type HandleLabel = (index: number) => string

export function pointHandleId(ownerId: string, index: number): ToolHandleId {
  return `point:${ownerId}:${index}` as ToolHandleId
}

export function dotHandleId(ownerId: string, index: number): ToolHandleId {
  return `dot:${ownerId}:${index}` as ToolHandleId
}

/** Every point's handle. */
export function pointHandles(ownerId: string, path: PathPoints, size: HandleSize, label: HandleLabel): ToolHandle[] {
  return path.points.map((point, index) => ({
    id: pointHandleId(ownerId, index),
    anchor: point.position,
    hitRadiusPx: size.pointRadiusPx,
    glyph: point.sharp ? 'corner' : 'vertex',
    label: label(index),
  }))
}

/** The dot of every segment long enough on screen to show one. */
export function dotHandles(
  ownerId: string,
  path: PathPoints,
  screenDistance: (a: WorldPoint, b: WorldPoint) => number,
  size: HandleSize,
  label: HandleLabel,
): ToolHandle[] {
  const { points } = path
  if (points.length < 2) return []
  const handles: ToolHandle[] = []
  segmentMidpoints(path).forEach((anchor, index) => {
    const from = points[index]!.position
    const to = points[(index + 1) % points.length]!.position
    if (screenDistance(from, to) < size.minMidpointEdgePx) return
    handles.push({ id: dotHandleId(ownerId, index), anchor, hitRadiusPx: size.midpointRadiusPx, glyph: 'midpoint', label: label(index) })
  })
  return handles
}

/** A point or dot handle's owner, role and index; null for any other handle. */
export function parsePointHandle(id: string): { readonly ownerId: string; readonly role: 'point' | 'dot'; readonly index: number } | null {
  const role = id.startsWith('point:') ? 'point' : id.startsWith('dot:') ? 'dot' : null
  if (!role) return null
  const rest = id.slice(role.length + 1)
  const split = rest.lastIndexOf(':')
  if (split <= 0) return null
  const index = Number(rest.slice(split + 1))
  if (!Number.isInteger(index) || index < 0 || rest.slice(split + 1) === '') return null
  return { ownerId: rest.slice(0, split), role, index }
}
