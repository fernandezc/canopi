import { describe, expect, it } from 'vitest'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import { targets, speciesTarget } from '../target'
import { createPanelTargetMapOverlayContract } from '../maplibre/panel-target-overlays'
import { projectTargetResolutionToMapFeatures } from '../target/map-projection'
import { getCanvasInteractionStrokeVisual } from '../canvas/runtime/scene-visuals'

const LOCATION = { lat: 48.8566, lon: 2.3522 }

function createScene() {
  const scene = createDefaultScenePersistedState()
  scene.plants = [
    {
      kind: 'plant',
      locked: false,
      id: 'plant-1',
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: null,
      canopySpreadM: null,
      position: { x: 0, y: 0 },
      rotationDeg: null,
      notes: null,
      plantedDate: null,
      quantity: null,
    },
  ]
  scene.zones = [
    {
      kind: 'zone',
      locked: false,
      id: 'orchard', name: 'orchard',
      zoneType: 'polygon',
      rotationDeg: 0,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      fillColor: null,
      notes: null,
    },
    {
      kind: 'zone',
      locked: false,
      id: 'hedgerow', name: 'hedgerow',
      zoneType: 'line',
      rotationDeg: 0,
      points: [
        { x: 0, y: 0 },
        { x: 12, y: -6 },
      ],
      fillColor: null,
      notes: null,
    },
  ]
  return scene
}

describe('panel-target map overlays', () => {
  it('canopi-rg4q: builds a zone-only MapLibre contract; the canvas rings plants at their drawn size', () => {
    const index = targets.indexScene(createScene())
    const projection = targets.resolve(
      [speciesTarget('Malus domestica'), { kind: 'zone', zone_id: 'orchard' }],
      index,
    )

    const overlay = createPanelTargetMapOverlayContract(
      'selection',
      projectTargetResolutionToMapFeatures(projection, LOCATION),
    )

    expect(overlay.source.id).toBe('panel-target-selection-source')
    expect(overlay.layers.map((layer) => layer.id)).toEqual([
      'panel-target-selection-zones-fill',
      'panel-target-selection-zones-casing',
      'panel-target-selection-zones-line',
    ])
    expect(overlay.layers.map((layer) => layer.type)).toEqual(['fill', 'line', 'line'])
    expect(overlay.source.data.features.map((feature) => feature.properties.kind)).toEqual(['zone'])
    expect(overlay.hasRenderableFeatures).toBe(true)
    const plantsOnly = createPanelTargetMapOverlayContract('selection', projectTargetResolutionToMapFeatures(
      targets.resolve([speciesTarget('Malus domestica')], index), LOCATION))
    expect(plantsOnly.hasRenderableFeatures).toBe(false)
  })

  it('renders Linear Zone targets through line overlays without fill', () => {
    const projection = targets.resolve(
      [{ kind: 'zone', zone_id: 'hedgerow' }],
      targets.indexScene(createScene()),
    )

    const overlay = createPanelTargetMapOverlayContract(
      'selection',
      projectTargetResolutionToMapFeatures(projection, LOCATION),
    )

    expect(overlay.source.data.features).toHaveLength(1)
    expect(overlay.source.data.features[0]?.geometry.type).toBe('LineString')

    const fillLayer = overlay.layers.find(
      (layer) => layer.id === 'panel-target-selection-zones-fill',
    )
    const lineLayer = overlay.layers.find(
      (layer) => layer.id === 'panel-target-selection-zones-line',
    )
    expect(fillLayer?.filter).toEqual([
      'all',
      ['==', ['get', 'kind'], 'zone'],
      ['==', ['geometry-type'], 'Polygon'],
    ])
    expect(lineLayer?.filter).toEqual(['==', ['get', 'kind'], 'zone'])
  })

  it('preserves empty overlays without inventing renderable features', () => {
    const projection = targets.resolve(
      [],
      targets.indexScene(createScene()),
    )

    const overlay = createPanelTargetMapOverlayContract(
      'hover',
      projectTargetResolutionToMapFeatures(projection, LOCATION),
    )

    expect(overlay.source.data.features).toEqual([])
    expect(overlay.hasRenderableFeatures).toBe(false)
  })

  it('renders nothing for a Target the Scene does not hold', () => {
    const missingTarget = speciesTarget('Pyrus communis')
    const projection = targets.resolve(
      [missingTarget],
      targets.indexScene(createScene()),
    )

    const overlay = createPanelTargetMapOverlayContract(
      'selection',
      projectTargetResolutionToMapFeatures(projection, LOCATION),
    )

    expect(overlay.hasRenderableFeatures).toBe(false)
  })

  it('outlines selected zones in the accent highlight over its casing', () => {
    const scene = createScene()
    const projection = targets.resolve([{ kind: 'zone', zone_id: 'orchard' }], targets.indexScene(scene))
    const overlay = createPanelTargetMapOverlayContract('selection', projectTargetResolutionToMapFeatures(projection, LOCATION))
    const highlight = getCanvasInteractionStrokeVisual('highlight')
    const layer = (id: string) => overlay.layers.find((candidate) => candidate.id === id)!.paint

    expect(layer('panel-target-selection-zones-line')['line-color']).toBe(highlight.color)
    expect(layer('panel-target-selection-zones-line')['line-width']).toBe(highlight.widthPx)
    expect(layer('panel-target-selection-zones-casing')['line-color']).toBe(highlight.casingColor)
    expect(layer('panel-target-selection-zones-casing')['line-width']).toBe(highlight.casingWidthPx)
    // No colour outside the design-system tokens.
    const colours = overlay.layers.flatMap((candidate) => Object.entries(candidate.paint)
      .filter(([key]) => key.endsWith('-color')).map(([, value]) => value))
    expect(colours.every((colour) => colour === highlight.color || colour === highlight.casingColor)).toBe(true)
    // The stored geometry is untouched: the overlay only draws projected shapes.
    expect(scene.zones[0]!.points[1]).toEqual({ x: 10, y: 0 })
  })

  it('draws panel hover with the hover stroke tokens', () => {
    const projection = targets.resolve([{ kind: 'zone', zone_id: 'orchard' }], targets.indexScene(createScene()))
    const overlay = createPanelTargetMapOverlayContract('hover', projectTargetResolutionToMapFeatures(projection, LOCATION))
    const hover = getCanvasInteractionStrokeVisual('hover')
    const line = overlay.layers.find((candidate) => candidate.id === 'panel-target-hover-zones-line')!.paint
    expect(line['line-color']).toBe(hover.color)
  })
})
