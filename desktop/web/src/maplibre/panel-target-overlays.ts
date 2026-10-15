import {
  getCanvasInteractionStrokeVisual,
  type CanvasInteractionStrokeVisual,
} from '../canvas/runtime/scene-visuals'
import type { TargetMapFeature } from '../target'

export type PanelTargetMapOverlayVariant = 'hover' | 'selection'

export interface PanelTargetMapOverlayFeatureCollection {
  readonly type: 'FeatureCollection'
  readonly features: readonly TargetMapFeature[]
}

interface PanelTargetMapOverlaySourceSpec {
  readonly id: string
  readonly type: 'geojson'
  readonly data: PanelTargetMapOverlayFeatureCollection
}

type PanelTargetMapOverlayKindFilter =
  readonly ['==', readonly ['get', 'kind'], 'zone']

type PanelTargetMapOverlayGeometryFilter =
  readonly ['==', readonly ['geometry-type'], 'Polygon' | 'LineString' | 'Point']

type PanelTargetMapOverlayLayerFilter =
  | PanelTargetMapOverlayKindFilter
  | readonly ['all', PanelTargetMapOverlayKindFilter, PanelTargetMapOverlayGeometryFilter]

interface PanelTargetMapOverlayLayerSpec {
  readonly id: string
  readonly source: string
  readonly type: 'circle' | 'fill' | 'line'
  readonly filter: PanelTargetMapOverlayLayerFilter
  readonly paint: Readonly<Record<string, string | number>>
}

export interface PanelTargetMapOverlayContract {
  readonly variant: PanelTargetMapOverlayVariant
  readonly source: PanelTargetMapOverlaySourceSpec
  readonly layers: readonly PanelTargetMapOverlayLayerSpec[]
  readonly hasRenderableFeatures: boolean
}

/**
 * Zone highlights speak the scene's ring language: a selection is the accent
 * highlight stroke over its casing, a panel hover the hover stroke; both read the
 * canvas colour tokens. Plants are ringed by the canvas at their drawn size.
 */
function overlayVisual(variant: PanelTargetMapOverlayVariant): CanvasInteractionStrokeVisual {
  return getCanvasInteractionStrokeVisual(variant === 'selection' ? 'highlight' : 'hover')
}

const ZONE_FILL_OPACITY: Readonly<Record<PanelTargetMapOverlayVariant, number>> = {
  hover: 0.08,
  selection: 0.12,
}

function createLayerSpecs(
  variant: PanelTargetMapOverlayVariant,
  sourceId: string,
): readonly PanelTargetMapOverlayLayerSpec[] {
  const prefix = `panel-target-${variant}`
  const visual = overlayVisual(variant)
  const zoneFilter = ['==', ['get', 'kind'], 'zone'] as const

  return [
    {
      id: `${prefix}-zones-fill`,
      source: sourceId,
      type: 'fill',
      filter: ['all', zoneFilter, ['==', ['geometry-type'], 'Polygon']],
      paint: {
        'fill-color': visual.color,
        'fill-opacity': ZONE_FILL_OPACITY[variant],
      },
    },
    {
      id: `${prefix}-zones-casing`,
      source: sourceId,
      type: 'line',
      filter: zoneFilter,
      paint: {
        'line-color': visual.casingColor,
        'line-width': visual.casingWidthPx,
      },
    },
    {
      id: `${prefix}-zones-line`,
      source: sourceId,
      type: 'line',
      filter: zoneFilter,
      paint: {
        'line-color': visual.color,
        'line-opacity': visual.alpha,
        'line-width': visual.widthPx,
      },
    },
  ]
}

export function createPanelTargetMapOverlayContract(
  variant: PanelTargetMapOverlayVariant,
  features: readonly TargetMapFeature[],
): PanelTargetMapOverlayContract {
  const sourceId = `panel-target-${variant}-source`
  const zones = features.filter((feature) => feature.properties.kind === 'zone')
  return {
    variant,
    source: {
      id: sourceId,
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: zones,
      },
    },
    layers: createLayerSpecs(variant, sourceId),
    hasRenderableFeatures: zones.length > 0,
  }
}
