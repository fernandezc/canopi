import { getCanvasDetailLayout } from '../automatic-detail'
import type { PointerKind } from '../interaction-types'
import { rectsIntersect, type SimpleRect } from '../../operations'
import { getAnnotationVisualWorldCorners, getRevealedAnnotationId, isPointInAnnotationPresentation } from '../annotation-layout'
import {
  getPlantWorldBounds,
  hitTestPlant,
  type PlantPresentationContext,
} from '../plant-presentation'
import type {
  SceneAnnotationEntity,
  SceneDesignObjectSelection,
  SceneMeasurementGuideEntity,
  ScenePersistedState,
  ScenePlantEntity,
  ScenePoint,
  SceneZoneEntity,
} from '../scene'
import {
  getSceneGroupedMemberKeys,
  isSceneLayerEditable,
  resolveSceneObjectGroupMembers,
  sceneObjectGroupMemberLayerName,
  sceneTargetKey,
  type SceneConcreteDesignObjectTarget,
  type SceneDesignObjectTarget,
} from '../scene'
import type { SpeciesCacheEntry } from '../species-cache'
import {
  getEllipticalZonePolygon,
  getRectangularZoneCorners,
  pointsBounds,
} from '../zone-geometry'

/**
 * The pick rule's one owner (canopi-qd2k, the user's decision of 2026-10-14; contract: hit-testing.pick.test.ts), reached
 * through ToolScene.hitAt. A point picks the one topmost drawn object, in draw order: notes, plants, guides, zones; a
 * grouped member answers as its group in its own kind's pass. A closed zone (polygon, rectangle, ellipse) is picked by its
 * outline only, within PICK_TOLERANCE_PX[pointer] screen pixels, so a point inside one picks what lies beneath or nothing.
 * Line zones and guides keep LINE_HIT_TOLERANCE_PX; plants keep their drawn footprint.
 */
export const PICK_TOLERANCE_PX: Readonly<Record<PointerKind, number>> = Object.freeze({ mouse: 6, pen: 6, touch: 16 })

/** The pick on interactive (editable) layers: a click's, a tap's and the menu's. Object locks count (the caller rejects them). */
export function hitTestTopLevel(
  scene: ScenePersistedState,
  point: ScenePoint,
  viewportScale: number,
  pointer: PointerKind,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
  getPlantContext: (viewportScale: number) => PlantPresentationContext,
  selection: SceneDesignObjectSelection = [],
  hoverTarget: SceneDesignObjectTarget | null = null,
): SceneDesignObjectTarget | null {
  return hitTestTopLevelWithLayerFilter(
    scene,
    point,
    viewportScale,
    pointer,
    speciesCache,
    getPlantContext,
    isSceneLayerEditable,
    getRevealedAnnotationId(selection),
    hoverTarget?.kind === 'annotation' ? hoverTarget.id : null,
  )
}

/** The same pick on visible layers, locked ones included: the passive hover's. */
export function hitTestVisibleTopLevel(
  scene: ScenePersistedState,
  point: ScenePoint,
  viewportScale: number,
  pointer: PointerKind,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
  getPlantContext: (viewportScale: number) => PlantPresentationContext,
  selection: SceneDesignObjectSelection = [],
  hoverTarget: SceneDesignObjectTarget | null = null,
): SceneDesignObjectTarget | null {
  return hitTestTopLevelWithLayerFilter(
    scene,
    point,
    viewportScale,
    pointer,
    speciesCache,
    getPlantContext,
    isLayerVisible,
    getRevealedAnnotationId(selection),
    hoverTarget?.kind === 'annotation' ? hoverTarget.id : null,
  )
}

function hitTestTopLevelWithLayerFilter(
  scene: ScenePersistedState,
  point: ScenePoint,
  viewportScale: number,
  pointer: PointerKind,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
  getPlantContext: (viewportScale: number) => PlantPresentationContext,
  isLayerHitEligible: (scene: ScenePersistedState, layerName: string) => boolean,
  revealedAnnotationId: string | null,
  hoveredAnnotationId: string | null,
): SceneDesignObjectTarget | null {
  const groupOf = memberGroups(scene, isLayerHitEligible)
  const detail = getCanvasDetailLayout(scene, viewportScale)
  const plantContext = { ...plantPresentationContext(getPlantContext, viewportScale, speciesCache), plants: scene.plants }
  /** The top-level target of a member: itself, its group, or undefined when it cannot be picked (its group or layer). */
  const topLevel = (target: SceneConcreteDesignObjectTarget, layerName: string): SceneDesignObjectTarget | undefined => {
    const key = sceneTargetKey(target)
    if (groupOf.has(key)) return groupOf.get(key) ?? undefined
    return isLayerHitEligible(scene, layerName) ? target : undefined
  }

  for (let i = scene.annotations.length - 1; i >= 0; i -= 1) {
    const annotation = scene.annotations[i]!
    const target = topLevel({ kind: 'annotation', id: annotation.id }, 'annotations')
    if (!target) continue
    // A grouped note shows its text only when the text is allowed, never revealed by selection or hover.
    const revealed = target.kind === 'annotation'
      && (annotation.id === revealedAnnotationId || annotation.id === hoveredAnnotationId)
    if (isPointInAnnotationPresentation(annotation, point, viewportScale, revealed, detail.annotationIds.has(annotation.id))) return target
  }

  let closestPlant: SceneDesignObjectTarget | null = null
  let closestDistance = Infinity
  for (let i = scene.plants.length - 1; i >= 0; i -= 1) {
    const plant = scene.plants[i]!
    const target = topLevel({ kind: 'plant', id: plant.id }, 'plants')
    if (!target) continue
    const distance = (plant.position.x - point.x) ** 2 + (plant.position.y - point.y) ** 2
    if (distance < closestDistance && hitTestPlant(plant, point, plantContext)) {
      closestPlant = target
      closestDistance = distance
    }
  }
  if (closestPlant) return closestPlant

  for (let i = scene.measurementGuides.length - 1; i >= 0; i -= 1) {
    const guide = scene.measurementGuides[i]!
    if (!isLayerHitEligible(scene, 'measurement-guides')) continue
    if (hitMeasurementGuide(guide, point, viewportScale)) {
      return { kind: 'measurement-guide', id: guide.id }
    }
  }

  for (let i = scene.zones.length - 1; i >= 0; i -= 1) {
    const zone = scene.zones[i]!
    const target = topLevel({ kind: 'zone', id: zone.id }, 'zones')
    if (target && hitZone(zone, point, viewportScale, pointer)) return target
  }

  return null
}

/** Each grouped member's key to its group's target, or to null when the group cannot be picked (a member's layer). */
function memberGroups(
  scene: ScenePersistedState,
  isLayerHitEligible: (scene: ScenePersistedState, layerName: string) => boolean,
): Map<string, SceneDesignObjectTarget | null> {
  const eligible = new Map<string, boolean>()
  const groups = new Map<string, SceneDesignObjectTarget | null>()
  for (const [key, groupId] of getSceneGroupedMemberKeys(scene)) {
    if (!eligible.has(groupId)) {
      const group = scene.groups.find((entry) => entry.id === groupId)
      eligible.set(groupId, !!group
        && isGroupLayerHitEligible(scene, isLayerHitEligible, resolveSceneObjectGroupMembers(scene, group)))
    }
    groups.set(key, eligible.get(groupId) ? { kind: 'group', id: groupId } : null)
  }
  return groups
}

function isGroupLayerHitEligible(
  scene: ScenePersistedState,
  isLayerHitEligible: (scene: ScenePersistedState, layerName: string) => boolean,
  members: readonly SceneConcreteDesignObjectTarget[],
): boolean {
  if (members.length === 0) return false
  return members.every((member) =>
    isLayerHitEligible(scene, sceneObjectGroupMemberLayerName(member)),
  )
}

/**
 * Band select: every top-level target the world polygon `quad` touches (spec §4.9), on interactive layers only. Shapes
 * are tested as polygons and segments, plants as circles of their drawn radius, notes as their turned text box; a turned
 * band is never widened to its world box.
 */
export function queryQuadTopLevel(
  scene: ScenePersistedState,
  quad: readonly ScenePoint[],
  viewportScale: number,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
  getPlantContext: (viewportScale: number) => PlantPresentationContext,
  selection: SceneDesignObjectSelection = [],
): SceneDesignObjectTarget[] {
  const targets: SceneDesignObjectTarget[] = []
  const baseContext = getPlantContext
  getPlantContext = (scale) => ({ ...baseContext(scale), plants: scene.plants })
  const groupedMemberKeys = getSceneGroupedMemberKeys(scene)
  const detail = getCanvasDetailLayout(scene, viewportScale)
  const area: QueryPolygon = { points: quad, bounds: pointsBounds(quad) }

  for (const group of scene.groups) {
    const members = resolveSceneObjectGroupMembers(scene, group)
    if (!isGroupLayerHitEligible(scene, isSceneLayerEditable, members)) continue
    const hit = members.some((member) => {
      const plant = member.kind === 'plant' ? scene.plants.find((entry) => entry.id === member.id) : null
      if (plant && plantIntersectsPolygon(plant, area, viewportScale, speciesCache, getPlantContext)) return true
      const zone = member.kind === 'zone' ? scene.zones.find((entry) => entry.id === member.id) : null
      if (zone && zoneIntersectsPolygon(zone, area)) return true
      const annotation = member.kind === 'annotation'
        ? scene.annotations.find((entry) => entry.id === member.id)
        : null
      return annotation ? annotationIntersectsPolygon(annotation, area, viewportScale, false, detail.annotationIds.has(annotation.id)) : false
    })
    if (hit) targets.push({ kind: 'group', id: group.id })
  }

  for (const plant of scene.plants) {
    if (groupedMemberKeys.has(sceneTargetKey({ kind: 'plant', id: plant.id }))) continue
    if (!isSceneLayerEditable(scene, 'plants')) continue
    if (plantIntersectsPolygon(plant, area, viewportScale, speciesCache, getPlantContext)) {
      targets.push({ kind: 'plant', id: plant.id })
    }
  }

  for (const guide of scene.measurementGuides) {
    if (!isSceneLayerEditable(scene, 'measurement-guides')) continue
    if (segmentIntersectsPolygon(guide.start, guide.end, area)) {
      targets.push({ kind: 'measurement-guide', id: guide.id })
    }
  }

  for (const zone of scene.zones) {
    if (groupedMemberKeys.has(sceneTargetKey({ kind: 'zone', id: zone.id }))) continue
    if (!isSceneLayerEditable(scene, 'zones')) continue
    if (zoneIntersectsPolygon(zone, area)) targets.push({ kind: 'zone', id: zone.id })
  }

  for (const annotation of scene.annotations) {
    if (groupedMemberKeys.has(sceneTargetKey({ kind: 'annotation', id: annotation.id }))) continue
    if (!isSceneLayerEditable(scene, 'annotations')) continue
    if (annotationIntersectsPolygon(annotation, area, viewportScale, annotation.id === getRevealedAnnotationId(selection), detail.annotationIds.has(annotation.id))) {
      targets.push({ kind: 'annotation', id: annotation.id })
    }
  }

  return targets
}

/** A band's polygon with its world bounds, the quick reject before the exact test. */
interface QueryPolygon {
  readonly points: readonly ScenePoint[]
  readonly bounds: SimpleRect
}

/** The zone edge nearest a point, within the pointer's PICK_TOLERANCE_PX ("Turn view to this edge", spec §4.16; Select's
 *  double-click that adds a corner). */
interface ZoneEdgeHit {
  readonly zoneId: string
  readonly edgeIndex: number
  readonly distancePx: number
}

/**
 * The polygon, rectangle (its turned corners) or line zone edge nearest `point` within PICK_TOLERANCE_PX[pointer] at
 * `viewportScale` px/m, or null. Zones on hidden layers are left out; locked zones, locked layers and grouped zones count, since the
 * entry only turns the view. Ellipses have no edges.
 */
export function hitZoneEdge(
  scene: ScenePersistedState,
  point: ScenePoint,
  pointer: PointerKind,
  viewportScale: number,
): ZoneEdgeHit | null {
  if (!isLayerVisible(scene, 'zones')) return null
  const tolerancePx = PICK_TOLERANCE_PX[pointer]
  const scale = Math.max(viewportScale, 1e-6)
  let best: ZoneEdgeHit | null = null
  for (let i = scene.zones.length - 1; i >= 0; i -= 1) {
    const zone = scene.zones[i]!
    const edges = zoneEdges(zone)
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
      const [start, end] = edges[edgeIndex]!
      const distancePx = distanceToSegment(point, start, end) * scale
      if (distancePx <= tolerancePx + GEOMETRY_EPSILON && (!best || distancePx < best.distancePx)) {
        best = { zoneId: zone.id, edgeIndex, distancePx }
      }
    }
  }
  return best
}

/** Edge `edgeIndex` of a polygon, rectangle or line zone, from its first corner to its next; null for an ellipse. */
export function zoneEdgeSegment(zone: SceneZoneEntity, edgeIndex: number): readonly [ScenePoint, ScenePoint] | null {
  return zoneEdges(zone)[edgeIndex] ?? null
}

function zoneEdges(zone: SceneZoneEntity): ReadonlyArray<readonly [ScenePoint, ScenePoint]> {
  if (zone.zoneType === 'line' && zone.points.length >= 2) return [[zone.points[0]!, zone.points[1]!]]
  if (zone.zoneType === 'polygon' && zone.points.length >= 3) return edgesOf(zone.points)
  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    const corners = getRectangularZoneCorners(zone)
    return corners ? edgesOf(corners) : []
  }
  return []
}

/** Line zones and guides, for every pointer: they keep their picking (canopi-qd2k). */
const LINE_HIT_TOLERANCE_PX = 6
const ELLIPSE_BOUNDARY_MAX_SAGITTA_PX = LINE_HIT_TOLERANCE_PX / 2
const MIN_ELLIPSE_BOUNDARY_SEGMENTS = 48

/** A closed zone near its outline (PICK_TOLERANCE_PX for the pointer), a line zone near its line; never by its inside. */
function hitZone(zone: SceneZoneEntity, point: ScenePoint, viewportScale: number, pointer: PointerKind): boolean {
  const scale = Math.max(viewportScale, 1e-6)
  const toleranceWorld = PICK_TOLERANCE_PX[pointer] / scale

  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    const corners = getRectangularZoneCorners(zone)
    return corners ? pointNearPolygonBoundary(point, corners, toleranceWorld) : false
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const polygon = getEllipticalZonePolygon(zone, ellipseBoundarySegmentCount(zone, viewportScale))
    return polygon ? pointNearPolygonBoundary(point, polygon, toleranceWorld) : false
  }

  if (zone.zoneType === 'polygon' && zone.points.length >= 3) {
    return pointNearPolygonBoundary(point, zone.points, toleranceWorld)
  }

  if (zone.zoneType === 'line' && zone.points.length >= 2) {
    return pointNearSegment(point, zone.points[0]!, zone.points[1]!, LINE_HIT_TOLERANCE_PX / scale)
  }

  // A shape too short of points for its kind: the outline of its bounds.
  return pointNearPolygonBoundary(point, rectCorners(zoneBounds(zone)), toleranceWorld)
}

/** A band selects a zone when it crosses one of its lines or holds it whole: by its outline, never by its inside, so a
 *  band wholly inside a zone leaves the zone out (canopi-qd2k). */
function zoneIntersectsPolygon(zone: SceneZoneEntity, area: QueryPolygon): boolean {
  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    const corners = getRectangularZoneCorners(zone)
    return corners ? outlineIntersectsPolygon(corners, area) : false
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const polygon = getEllipticalZonePolygon(zone)
    return polygon ? outlineIntersectsPolygon(polygon, area) : false
  }

  if (zone.zoneType === 'line' && zone.points.length >= 2) {
    return segmentIntersectsPolygon(zone.points[0]!, zone.points[1]!, area)
  }

  if (zone.zoneType === 'polygon' && zone.points.length >= 3) {
    return outlineIntersectsPolygon(zone.points, area)
  }

  return outlineIntersectsPolygon(rectCorners(zoneBounds(zone)), area)
}

/** A closed outline and the band's polygon: a corner of the outline inside the band, or crossing edges. */
function outlineIntersectsPolygon(outline: readonly ScenePoint[], area: QueryPolygon): boolean {
  if (outline.length === 0 || !rectsIntersect(area.bounds, pointsBounds(outline))) return false
  if (outline.some((point) => pointInOrOnPolygon(point, area.points))) return true
  return edgesCross(outline, area.points)
}

function hitMeasurementGuide(
  guide: SceneMeasurementGuideEntity,
  point: ScenePoint,
  viewportScale: number,
): boolean {
  const toleranceWorld = LINE_HIT_TOLERANCE_PX / Math.max(viewportScale, 1e-6)
  return pointNearSegment(point, guide.start, guide.end, toleranceWorld)
}

function ellipseBoundarySegmentCount(zone: SceneZoneEntity, viewportScale: number): number {
  const radii = zone.points[1]!
  const maxRadiusPx = Math.max(Math.abs(radii.x), Math.abs(radii.y)) * Math.max(viewportScale, 1e-6)
  if (maxRadiusPx <= ELLIPSE_BOUNDARY_MAX_SAGITTA_PX) return MIN_ELLIPSE_BOUNDARY_SEGMENTS
  const halfAngle = Math.acos(1 - (ELLIPSE_BOUNDARY_MAX_SAGITTA_PX / maxRadiusPx))
  if (!Number.isFinite(halfAngle) || halfAngle <= 0) return MIN_ELLIPSE_BOUNDARY_SEGMENTS
  return Math.max(MIN_ELLIPSE_BOUNDARY_SEGMENTS, Math.ceil(Math.PI / halfAngle))
}

/** True when `polygon` and the band's polygon overlap or touch: a corner of either inside the other, or crossing edges. */
function polygonsIntersect(polygon: readonly ScenePoint[], area: QueryPolygon): boolean {
  if (polygon.length === 0 || !rectsIntersect(area.bounds, pointsBounds(polygon))) return false
  if (polygon.some((point) => pointInOrOnPolygon(point, area.points))) return true
  if (area.points.some((corner) => pointInOrOnPolygon(corner, polygon))) return true
  return edgesCross(polygon, area.points)
}

function edgesCross(a: readonly ScenePoint[], b: readonly ScenePoint[]): boolean {
  return edgesOf(a).some(([start, end]) => edgesOf(b)
    .some(([otherStart, otherEnd]) => segmentsIntersect(start, end, otherStart, otherEnd)))
}

function segmentIntersectsPolygon(start: ScenePoint, end: ScenePoint, area: QueryPolygon): boolean {
  if (!rectsIntersect(pointsBounds([start, end]), area.bounds)) return false
  if (pointInOrOnPolygon(start, area.points) || pointInOrOnPolygon(end, area.points)) return true
  return edgesOf(area.points).some(([areaStart, areaEnd]) => segmentsIntersect(start, end, areaStart, areaEnd))
}

/** A circle and the band's polygon: the centre inside it, or an edge within the radius. */
function circleIntersectsPolygon(center: ScenePoint, radius: number, area: QueryPolygon): boolean {
  const reach = { x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 }
  if (!rectsIntersect(reach, area.bounds)) return false
  if (pointInOrOnPolygon(center, area.points)) return true
  return edgesOf(area.points).some(([start, end]) => pointNearSegment(center, start, end, radius))
}

function edgesOf(polygon: readonly ScenePoint[]): Array<[ScenePoint, ScenePoint]> {
  return polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]!])
}

const GEOMETRY_EPSILON = 0.000001

function pointInOrOnPolygon(point: ScenePoint, polygon: readonly ScenePoint[]): boolean {
  return pointOnPolygonBoundary(point, polygon) || pointInPolygon(point, polygon)
}

function pointInPolygon(point: ScenePoint, polygon: readonly ScenePoint[]): boolean {
  let inside = false

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex]!
    const previous = polygon[previousIndex]!
    const crossesY = (current.y > point.y) !== (previous.y > point.y)
    if (!crossesY) continue

    const intersectionX = ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x
    if (point.x < intersectionX) inside = !inside
  }

  return inside
}

function pointOnPolygonBoundary(point: ScenePoint, polygon: readonly ScenePoint[]): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(point, polygon[index]!, polygon[(index + 1) % polygon.length]!)) return true
  }

  return false
}

function pointNearPolygonBoundary(
  point: ScenePoint,
  polygon: readonly ScenePoint[],
  tolerance: number,
): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointNearSegment(point, polygon[index]!, polygon[(index + 1) % polygon.length]!, tolerance)) {
      return true
    }
  }

  return false
}

function rectCorners(rect: SimpleRect): ScenePoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ]
}

function segmentsIntersect(a: ScenePoint, b: ScenePoint, c: ScenePoint, d: ScenePoint): boolean {
  if (
    pointOnSegment(a, c, d) ||
    pointOnSegment(b, c, d) ||
    pointOnSegment(c, a, b) ||
    pointOnSegment(d, a, b)
  ) {
    return true
  }

  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)

  const crossesAb = (abC > GEOMETRY_EPSILON && abD < -GEOMETRY_EPSILON)
    || (abC < -GEOMETRY_EPSILON && abD > GEOMETRY_EPSILON)
  const crossesCd = (cdA > GEOMETRY_EPSILON && cdB < -GEOMETRY_EPSILON)
    || (cdA < -GEOMETRY_EPSILON && cdB > GEOMETRY_EPSILON)
  return crossesAb && crossesCd
}

function pointOnSegment(point: ScenePoint, start: ScenePoint, end: ScenePoint): boolean {
  const cross = orientation(start, end, point)
  if (Math.abs(cross) > GEOMETRY_EPSILON) return false

  return (
    point.x >= Math.min(start.x, end.x) - GEOMETRY_EPSILON &&
    point.x <= Math.max(start.x, end.x) + GEOMETRY_EPSILON &&
    point.y >= Math.min(start.y, end.y) - GEOMETRY_EPSILON &&
    point.y <= Math.max(start.y, end.y) + GEOMETRY_EPSILON
  )
}

function pointNearSegment(point: ScenePoint, start: ScenePoint, end: ScenePoint, tolerance: number): boolean {
  return distanceToSegment(point, start, end) <= tolerance + GEOMETRY_EPSILON
}

function distanceToSegment(point: ScenePoint, start: ScenePoint, end: ScenePoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}

function orientation(a: ScenePoint, b: ScenePoint, c: ScenePoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/** A plant is the circle of its drawn footprint (the symbolic Placed Plant Visual Footprint). */
function plantIntersectsPolygon(
  plant: ScenePlantEntity,
  area: QueryPolygon,
  viewportScale: number,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
  getPlantContext: (viewportScale: number) => PlantPresentationContext,
): boolean {
  const footprint = getPlantWorldBounds(plant, plantPresentationContext(getPlantContext, viewportScale, speciesCache))
  return circleIntersectsPolygon(plant.position, footprint.width / 2, area)
}

function zoneBounds(zone: SceneZoneEntity): SimpleRect {
  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const center = zone.points[0]!
    const radii = zone.points[1]!
    return {
      x: center.x - radii.x,
      y: center.y - radii.y,
      width: radii.x * 2,
      height: radii.y * 2,
    }
  }

  return pointsBounds(zone.points)
}


function annotationIntersectsPolygon(
  annotation: SceneAnnotationEntity,
  area: QueryPolygon,
  viewportScale: number,
  revealText: boolean,
  textAllowed: boolean,
): boolean {
  return polygonsIntersect(getAnnotationVisualWorldCorners(annotation, viewportScale, revealText, textAllowed), area)
}

function isLayerVisible(scene: ScenePersistedState, layerName: string): boolean {
  const layer = scene.layers.find((entry) => entry.name === layerName)
  return layer?.visible !== false
}

function plantPresentationContext(
  getPlantContext: (viewportScale: number) => PlantPresentationContext,
  viewportScale: number,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
): PlantPresentationContext {
  const base = getPlantContext(viewportScale)
  return {
    ...base,
    pixelsPerMetre: viewportScale,
    speciesCache,
  }
}
