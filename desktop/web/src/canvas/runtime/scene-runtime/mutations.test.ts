import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../ipc/species', () => ({
  getSpeciesBatch: vi.fn(async () => []),
  getFlowerColorBatch: vi.fn(async () => []),
  getCommonNames: vi.fn(async () => ({})),
}))

import type { CanopiFile } from '../../../types/design'
import { CURRENT_CANOPI_FILE_VERSION } from '../../../generated/canopi-design-format'
import { geoAt } from '../../../__tests__/support/geo-design'
import {
  resolvePlantSymbolForPlant,
  lockedSceneDesignObjectTargets,
  sceneHasLockedDesignObjects,
  SceneStore,
  type SceneDesignObjectTarget,
} from '../scene'
import { SceneHistory } from '../scene-history'
import { SceneRuntimeMutationController } from './mutations'
import { SceneRuntimeEditCoordinator, type SceneEditCoordinator } from './transactions'
import { createDetachedCanvasRuntimeAppAdapter } from '../app-adapter'
import { SceneCanvasRuntime } from '../scene-runtime'
import { applyPlantRowPositions, attachedPlantRowMembers, plantsById } from '../scene/plant-rows'
import { createSceneInteractionEventHarness } from '../../../__tests__/support/canvas-interaction-events'
import { placeOnHost } from '../../../__tests__/support/test-view'

function makeFile(): CanopiFile {
  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name: 'Mutation demo',
    description: null,
    plant_species_colors: {},
    layers: [
      { name: 'plants', visible: true, locked: false, opacity: 1 },
      { name: 'zones', visible: true, locked: false, opacity: 1 },
      { name: 'annotations', visible: true, locked: false, opacity: 1 },
    ],
    plants: [
      {
        id: 'plant-1',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        position: geoAt(10, 10),
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      },
      {
        id: 'plant-2',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        position: geoAt(20, 20),
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      },
    ],
    zones: [
      {
        id: 'zone-1', name: null,
        zone_type: 'rect',
        rotation: 0,
        points: [
          geoAt(0, 0),
          geoAt(5, 0),
          geoAt(5, 5),
          geoAt(0, 5),
        ],
        fill_color: null,
        notes: null,
        locked: false,
      },
    ],
    annotations: [
      {
        id: 'annotation-1',
        annotation_type: 'text',
        position: geoAt(50, 60),
        text: 'Note',
        font_size: 20,
        rotation: null,
        locked: false,
      },
    ],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-04-02T00:00:00.000Z',
    updated_at: '2026-04-02T00:00:00.000Z',
    extra: {},
  }
}

function createController(file = makeFile()) {
  const sceneStore = new SceneStore().hydrate(file)
  const state = {
    invalidations: 0,
    dirtyTypes: [] as string[],
    plantSpeciesColorSyncs: 0,
  }
  const setSelection = (targets: Iterable<SceneDesignObjectTarget>) => {
    sceneStore.setSelection(targets)
  }
  const history = new SceneHistory()
  const record = history.record.bind(history)
  vi.spyOn(history, 'record').mockImplementation((command, transaction) => {
    state.dirtyTypes.push(command.type)
    return record(command, transaction)
  })
  const sceneEdits = new SceneRuntimeEditCoordinator({
    sceneStore,
    history,
    setSelection,
    incrementSceneRevision: () => {},
    syncCanvasSignalsFromScene: () => {
      state.plantSpeciesColorSyncs += 1
    },
    invalidate: () => {
      state.invalidations += 1
    },
  })
  const controller = new SceneRuntimeMutationController({
    sceneStore,
    selection: {
      set: setSelection,
    },
    sceneEdits,
    commandAdmission: sceneEdits,
    settledReader: sceneEdits,
    presentation: {
      getViewportScale: () => 1,
      createPlantPresentationContext: (viewportScale = 1) => ({
        pixelsPerMetre: viewportScale,
        speciesCache: new Map(),
        localizedCommonNames: new Map(),
      }),
      getLocalizedCommonNames: () => new Map(),
      getSuggestedPlantColor: (canonicalName) => canonicalName === 'Malus domestica' ? '#C44230' : null,
    },
    invalidateScene: () => {
      state.invalidations += 1
    },
  })

  return { controller, sceneStore, state }
}

describe('scene runtime mutation controller', () => {
  it('copy, move the source, paste twice: each paste is the copy as it was, and the pastes share nothing', () => {
    const { controller, sceneStore } = createController()
    sceneStore.setSelection([{ kind: 'plant', id: 'plant-1' }, { kind: 'zone', id: 'zone-1' }])
    const source = sceneStore.persisted
    const plantAt = source.plants.find((plant) => plant.id === 'plant-1')!.position
    const zoneAt = source.zones.find((zone) => zone.id === 'zone-1')!.points

    controller.copy()
    sceneStore.updatePersisted((draft) => {
      const plant = draft.plants.find((entry) => entry.id === 'plant-1')!
      plant.position.x += 40
      const zone = draft.zones.find((entry) => entry.id === 'zone-1')!
      zone.points[0]!.y += 40
    })
    controller.paste()
    controller.paste()

    const scene = sceneStore.persisted
    const pastedPlants = scene.plants.filter((plant) => !['plant-1', 'plant-2'].includes(plant.id))
    const pastedZones = scene.zones.filter((zone) => zone.id !== 'zone-1')
    expect(pastedPlants.map((plant) => plant.position.x)).toEqual([plantAt.x + 1, plantAt.x + 2])
    expect(pastedPlants.map((plant) => plant.position.y)).toEqual([plantAt.y, plantAt.y])
    expect(pastedZones.map((zone) => zone.points[0]!.y)).toEqual([zoneAt[0]!.y, zoneAt[0]!.y])
    expect(pastedZones.map((zone) => zone.points[0]!.x)).toEqual([zoneAt[0]!.x + 1, zoneAt[0]!.x + 2])

    // Moving the first paste leaves the second where it was.
    sceneStore.updatePersisted((draft) => {
      draft.plants.find((entry) => entry.id === pastedPlants[0]!.id)!.position.y += 7
      draft.zones.find((entry) => entry.id === pastedZones[0]!.id)!.points[1]!.y += 7
    })
    const after = sceneStore.persisted
    expect(after.plants.find((entry) => entry.id === pastedPlants[1]!.id)!.position).toEqual(pastedPlants[1]!.position)
    expect(after.zones.find((entry) => entry.id === pastedZones[1]!.id)!.points).toEqual(pastedZones[1]!.points)
  })

  it('locks only the typed selected Design Object when raw ids collide', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant, index) =>
      index === 0 ? { ...plant, id: 'shared-id' } : plant,
    )
    file.zones = file.zones.map((zone, index) =>
      index === 0 ? { ...zone, id: 'shared-id' } : zone,
    )
    const { controller, sceneStore } = createController(file)
    sceneStore.setSelection([{ kind: 'zone', id: 'shared-id' }])

    controller.lockSelected()

    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'shared-id')?.locked).toBe(false)
    expect(sceneStore.persisted.zones.find((zone) => zone.id === 'shared-id')?.locked).toBe(true)
    expect(sceneStore.session.selectedTargets).toEqual([])
  })

  it('deletes only the typed selected Design Object when raw ids collide', () => {
    const file = makeFile()
    file.plants[0] = { ...file.plants[0]!, id: 'shared-id' }
    file.zones[0] = { ...file.zones[0]!, id: 'shared-id' }
    const { controller, sceneStore } = createController(file)
    sceneStore.setSelection([{ kind: 'zone', id: 'shared-id' }])

    controller.deleteSelected()

    expect(sceneStore.persisted.plants.some((plant) => plant.id === 'shared-id')).toBe(true)
    expect(sceneStore.persisted.zones.some((zone) => zone.id === 'shared-id')).toBe(false)
    expect(sceneStore.session.selectedTargets).toEqual([])
  })

  it('duplicates only the typed selected Design Object when raw ids collide', () => {
    const file = makeFile()
    file.plants[0] = { ...file.plants[0]!, id: 'shared-id' }
    file.zones[0] = { ...file.zones[0]!, id: 'shared-id' }
    const { controller, sceneStore } = createController(file)
    sceneStore.setSelection([{ kind: 'zone', id: 'shared-id' }])

    controller.duplicateSelected()

    expect(sceneStore.persisted.plants).toHaveLength(file.plants.length)
    expect(sceneStore.persisted.zones).toHaveLength(file.zones.length + 1)
    expect(sceneStore.session.selectedTargets).toEqual([
      expect.objectContaining({ kind: 'zone' }),
    ])
    expect(sceneStore.session.selectedTargets[0]?.id).not.toBe('shared-id')
  })

  it('does not delete selected groups that contain locked members', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-1' ? { ...plant, locked: true } : plant,
    )
    file.groups = [
      {
        id: 'group-1',
        name: null,
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'plant', id: 'plant-2' },
        ],
      },
    ]
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection([{ kind: 'group', id: 'group-1' }])

    controller.deleteSelected()

    expect(sceneStore.persisted.groups).toHaveLength(1)
    expect(sceneStore.persisted.plants).toHaveLength(2)
    expect(sceneStore.session.selectedTargets).toEqual([{ kind: 'group', id: 'group-1' }])
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(0)
  })

  it('does not ungroup or reorder selected groups that contain locked members', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-1' ? { ...plant, locked: true } : plant,
    )
    file.groups = [
      {
        id: 'group-1',
        name: null,
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'plant', id: 'plant-2' },
        ],
      },
      {
        id: 'group-2',
        name: null,
        locked: false,
        members: [{ kind: 'plant', id: 'missing-member' }],
      },
    ]
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection([{ kind: 'group', id: 'group-1' }])

    controller.ungroupSelected()
    controller.bringToFront()
    controller.sendToBack()

    expect(sceneStore.persisted.groups.map((group) => group.id)).toEqual(['group-1', 'group-2'])
    expect(sceneStore.persisted.plants).toHaveLength(2)
    expect(sceneStore.session.selectedTargets).toEqual([{ kind: 'group', id: 'group-1' }])
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(0)
  })

  it('does not duplicate selected groups that contain locked members', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-1' ? { ...plant, locked: true } : plant,
    )
    file.groups = [
      {
        id: 'group-1',
        name: null,
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'plant', id: 'plant-2' },
        ],
      },
    ]
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection([{ kind: 'group', id: 'group-1' }])

    controller.duplicateSelected()

    expect(sceneStore.persisted.groups).toHaveLength(1)
    expect(sceneStore.persisted.plants).toHaveLength(2)
    expect(sceneStore.session.selectedTargets).toEqual([{ kind: 'group', id: 'group-1' }])
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(0)
  })

  it('does not delete a selected Design Object after its Layer becomes locked', () => {
    const file = makeFile()
    file.layers = file.layers.map((layer) =>
      layer.name === 'zones' ? { ...layer, locked: true } : layer,
    )
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection([{ kind: 'zone', id: 'zone-1' }])

    controller.deleteSelected()

    expect(sceneStore.persisted.zones.map((zone) => zone.id)).toEqual(['zone-1'])
    expect(sceneStore.session.selectedTargets).toEqual([{ kind: 'zone', id: 'zone-1' }])
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(0)
  })

  it('selectAll skips grouped members and locked entities', () => {
    const file = makeFile()
    file.groups = [
      {
        id: 'group-1',
        name: null,
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'plant', id: 'plant-2' },
        ],
      },
    ]
    file.zones = file.zones.map((zone) =>
      zone.id === 'zone-1' ? { ...zone, locked: true } : zone,
    )
    const { controller, sceneStore, state } = createController(file)

    controller.selectAll()

    expect(sceneStore.session.selectedTargets).toEqual([
      { kind: 'annotation', id: 'annotation-1' },
      { kind: 'group', id: 'group-1' },
    ])
    expect(state.invalidations).toBe(1)
  })

  it('selectAll skips groups that contain locked members', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-1' ? { ...plant, locked: true } : plant,
    )
    file.groups = [
      {
        id: 'group-1',
        name: null,
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'plant', id: 'plant-2' },
        ],
      },
    ]
    const { controller, sceneStore, state } = createController(file)

    controller.selectAll()

    expect(sceneStore.session.selectedTargets).toEqual([
      { kind: 'zone', id: 'zone-1' },
      { kind: 'annotation', id: 'annotation-1' },
    ])
    expect(state.invalidations).toBe(1)
  })

  it('selectAll reads layer visibility from the scene store', () => {
    const file = makeFile()
    file.layers = file.layers.map((layer) =>
      layer.name === 'annotations' ? { ...layer, visible: false } : layer,
    )
    const { controller, sceneStore } = createController(file)

    controller.selectAll()

    expect(sceneStore.session.selectedTargets).toEqual([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'plant', id: 'plant-2' },
      { kind: 'zone', id: 'zone-1' },
    ])
  })

  it('selectAll skips Design Objects on locked Layers', () => {
    const file = makeFile()
    file.layers = file.layers.map((layer) =>
      layer.name === 'plants' ? { ...layer, locked: true } : layer,
    )
    const { controller, sceneStore } = createController(file)

    controller.selectAll()

    expect(sceneStore.session.selectedTargets).toEqual([
      { kind: 'zone', id: 'zone-1' },
      { kind: 'annotation', id: 'annotation-1' },
    ])
  })

  it('groups mixed concrete Design Objects into typed Object Group members', () => {
    const { controller, sceneStore, state } = createController()
    sceneStore.setSelection([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'zone', id: 'zone-1' },
      { kind: 'annotation', id: 'annotation-1' },
    ])

    controller.groupSelected()

    expect(sceneStore.persisted.groups).toHaveLength(1)
    const group = sceneStore.persisted.groups[0]!
    expect(group.members).toEqual([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'zone', id: 'zone-1' },
      { kind: 'annotation', id: 'annotation-1' },
    ])
    expect(sceneStore.session.selectedTargets).toEqual([{ kind: 'group', id: group.id }])
    expect(state.dirtyTypes).toEqual(['group-selected'])
  })

  it('flattens one selected Object Group into its existing identity when grouping with another object', () => {
    const file = makeFile()
    file.groups = [{
      id: 'group-1',
      name: 'Guild',
      locked: false,
      members: [
        { kind: 'plant', id: 'plant-1' },
        { kind: 'zone', id: 'zone-1' },
      ],
    }]
    const { controller, sceneStore } = createController(file)
    sceneStore.setSelection([
      { kind: 'group', id: 'group-1' },
      { kind: 'annotation', id: 'annotation-1' },
    ])

    controller.groupSelected()

    expect(sceneStore.persisted.groups).toEqual([{
      kind: 'group',
      id: 'group-1',
      name: 'Guild',
      locked: false,
      members: [
        { kind: 'plant', id: 'plant-1' },
        { kind: 'zone', id: 'zone-1' },
        { kind: 'annotation', id: 'annotation-1' },
      ],
    }])
    expect(sceneStore.session.selectedTargets).toEqual([{ kind: 'group', id: 'group-1' }])
  })

  it('merges multiple selected Object Groups into the topmost selected group', () => {
    const file = makeFile()
    file.groups = [
      {
        id: 'group-low',
        name: 'Low',
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'zone', id: 'zone-1' },
        ],
      },
      {
        id: 'group-top',
        name: 'Top',
        locked: false,
        members: [
          { kind: 'plant', id: 'plant-2' },
          { kind: 'annotation', id: 'annotation-1' },
        ],
      },
    ]
    const { controller, sceneStore } = createController(file)
    sceneStore.setSelection([
      { kind: 'group', id: 'group-low' },
      { kind: 'group', id: 'group-top' },
    ])

    controller.groupSelected()

    expect(sceneStore.persisted.groups).toEqual([{
      kind: 'group',
      id: 'group-top',
      name: 'Top',
      locked: false,
      members: [
        { kind: 'plant', id: 'plant-1' },
        { kind: 'zone', id: 'zone-1' },
        { kind: 'plant', id: 'plant-2' },
        { kind: 'annotation', id: 'annotation-1' },
      ],
    }])
    expect(sceneStore.session.selectedTargets).toEqual([{ kind: 'group', id: 'group-top' }])
  })

  it('selectSameSpecies selects eligible same-Species plants without dirtying the document', () => {
    const file = makeFile()
    file.plants = [
      ...file.plants,
      {
        id: 'plant-3',
        canonical_name: 'Pyrus communis',
        common_name: 'Pear',
        color: null,
        position: geoAt(30, 30),
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      },
      {
        id: 'plant-4',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        position: geoAt(40, 40),
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: true,
      },
      {
        id: 'plant-5',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        position: geoAt(50, 50),
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      },
    ]
    file.groups = [{
      id: 'group-1',
      name: null,
      locked: false,
      members: [{ kind: 'plant', id: 'plant-5' }],
    }]
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection([{ kind: 'plant', id: 'plant-1' }])

    controller.selectSameSpecies()

    expect(sceneStore.session.selectedTargets).toEqual([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'plant', id: 'plant-2' },
    ])
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(1)
  })

  it('selectSpecies replaces the selection with selectable plants of every named species', () => {
    const file = makeFile()
    file.plants = [
      ...file.plants,
      {
        id: 'plant-3',
        canonical_name: 'Pyrus communis',
        common_name: 'Pear',
        color: null,
        position: geoAt(30, 30),
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      },
      {
        id: 'plant-4',
        canonical_name: 'Pyrus communis',
        common_name: 'Pear',
        color: null,
        position: geoAt(40, 40),
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: true,
      },
    ]
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection([{ kind: 'plant', id: 'plant-1' }])

    controller.selectSpecies(['Pyrus communis', 'Malus domestica', 'Unknown species'])

    expect(sceneStore.session.selectedTargets).toEqual([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'plant', id: 'plant-2' },
      { kind: 'plant', id: 'plant-3' },
    ])
    expect(state.dirtyTypes).toEqual([])
    controller.selectSpecies(['Unknown species'])
    expect(sceneStore.session.selectedTargets).toHaveLength(3)
  })

  it('selectSpecies with one name selects that species as the chip and the key panel ask', () => {
    const file = makeFile()
    const plant = file.plants[0]!
    file.plants = [
      ...file.plants,
      { ...plant, id: 'plant-3', canonical_name: 'Pyrus communis', position: geoAt(30, 30) },
      { ...plant, id: 'plant-4', position: geoAt(40, 40), locked: true },
      { ...plant, id: 'plant-5', position: geoAt(50, 50) },
    ]
    file.groups = [{ id: 'group-1', name: null, locked: false, members: [{ kind: 'plant', id: 'plant-5' }] }]
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection([{ kind: 'plant', id: 'plant-3' }])

    controller.selectSpecies([plant.canonical_name])

    expect(sceneStore.session.selectedTargets).toEqual([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'plant', id: 'plant-2' },
    ])
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(1)
    controller.selectSpecies([plant.canonical_name])
    expect(state.invalidations).toBe(1)
  })

  it('rotates the selection about its centre as one undoable edit', () => {
    const { controller, sceneStore, state } = createController()
    sceneStore.setSelection([{ kind: 'plant', id: 'plant-1' }, { kind: 'plant', id: 'plant-2' }])
    const [first, second] = sceneStore.persisted.plants.map((plant) => plant.position)
    const centre = { x: (first!.x + second!.x) / 2, y: (first!.y + second!.y) / 2 }

    controller.rotateSelected(90)

    const [rotatedFirst, rotatedSecond] = sceneStore.persisted.plants.map((plant) => plant.position)
    // Clockwise on the map (the plane's y grows southward): north of the centre turns to east.
    const turned = (point: { x: number; y: number }) => ({
      x: centre.x - (point.y - centre.y),
      y: centre.y + (point.x - centre.x),
    })
    expect(rotatedFirst!.x).toBeCloseTo(turned(first!).x)
    expect(rotatedFirst!.y).toBeCloseTo(turned(first!).y)
    expect(rotatedSecond!.x).toBeCloseTo(turned(second!).x)
    expect(rotatedSecond!.y).toBeCloseTo(turned(second!).y)
    expect(state.dirtyTypes).toEqual(['rotate-selected'])
  })

  it('turns a rectangle zone and keeps its shape', () => {
    const { controller, sceneStore } = createController()
    sceneStore.setSelection([{ kind: 'zone', id: 'zone-1' }])

    controller.rotateSelected(-30)

    expect(sceneStore.persisted.zones[0]!.rotationDeg).toBeCloseTo(330)
  })

  it('never rotates locked objects, and ignores a zero or non-finite angle', () => {
    const file = makeFile()
    file.plants[1] = { ...file.plants[1]!, locked: true }
    const { controller, sceneStore, state } = createController(file)
    const before = sceneStore.persisted.plants.map((plant) => ({ ...plant.position }))
    sceneStore.setSelection([{ kind: 'plant', id: 'plant-1' }, { kind: 'plant', id: 'plant-2' }])

    controller.rotateSelected(45)
    sceneStore.setSelection([{ kind: 'zone', id: 'zone-1' }])
    controller.rotateSelected(0)
    controller.rotateSelected(Number.NaN)
    controller.rotateSelected(360)

    expect(sceneStore.persisted.plants.map((plant) => plant.position)).toEqual(before)
    expect(sceneStore.persisted.zones[0]!.rotationDeg).toBe(0)
    expect(state.dirtyTypes).toEqual([])
  })

  it('unlocks every locked object in the Design as one edit, and does nothing when none is locked', () => {
    const file = makeFile()
    file.plants[1] = { ...file.plants[1]!, locked: true }
    file.zones[0] = { ...file.zones[0]!, locked: true }
    file.groups = [{ id: 'group-1', locked: true, name: null, members: [{ kind: 'annotation', id: 'annotation-1' }] }]
    file.annotations[0] = { ...file.annotations[0]!, locked: true }
    file.measurement_guides = [{ id: 'guide-1', start: geoAt(0, 0), end: geoAt(4, 0), locked: true }]
    const { controller, sceneStore, state } = createController(file)
    expect(lockedSceneDesignObjectTargets(sceneStore.persisted)).toEqual([
      { kind: 'plant', id: 'plant-2' },
      { kind: 'zone', id: 'zone-1' },
      { kind: 'annotation', id: 'annotation-1' },
      { kind: 'measurement-guide', id: 'guide-1' },
      { kind: 'group', id: 'group-1' },
    ])
    expect(sceneHasLockedDesignObjects(sceneStore.persisted)).toBe(true)

    controller.unlockAll()

    expect(sceneStore.persisted.plants.map((plant) => plant.locked)).toEqual([false, false])
    expect(sceneStore.persisted.zones[0]!.locked).toBe(false)
    expect(sceneStore.persisted.groups[0]!.locked).toBe(false)
    expect(sceneStore.persisted.annotations[0]!.locked).toBe(false)
    expect(sceneStore.persisted.measurementGuides[0]!.locked).toBe(false)
    expect(sceneHasLockedDesignObjects(sceneStore.persisted)).toBe(false)
    controller.unlockAll()
    expect(state.dirtyTypes).toEqual(['unlock-all'])
  })

  it('clears the selection without editing the Design', () => {
    const { controller, sceneStore, state } = createController()
    sceneStore.setSelection([{ kind: 'plant', id: 'plant-1' }, { kind: 'zone', id: 'Z01' }])

    controller.clearSelection()

    expect(sceneStore.session.selectedTargets).toEqual([])
    expect(state.dirtyTypes).toEqual([])
    controller.clearSelection()
    expect(sceneStore.session.selectedTargets).toEqual([])
  })

  it('updates species colors through the presentation seam', () => {
    const { controller, sceneStore, state } = createController()

    const changed = controller.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(2)
    expect(sceneStore.persisted.plantSpeciesColors).toEqual({
      'Malus domestica': '#C44230',
    })
    expect(state.plantSpeciesColorSyncs).toBe(1)
    expect(state.dirtyTypes).toEqual(['set-plant-color-for-species'])
    expect(state.invalidations).toBe(1)
  })

  it('updates selected plant symbols through the presentation seam', () => {
    const { controller, sceneStore, state } = createController()
    sceneStore.setSelection([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'plant', id: 'plant-2' },
    ])

    const changed = controller.setSelectedPlantSymbol('conifer')

    expect(changed).toBe(2)
    expect(sceneStore.persisted.plants.map((plant) => plant.symbol)).toEqual(['conifer', 'conifer'])
    expect(controller.getSelectedPlantSymbolContext()).toMatchObject({
      plantIds: ['plant-1', 'plant-2'],
      sharedCurrentSymbol: 'conifer',
      sharedEffectiveSymbol: 'conifer',
      canClearSelectedSymbol: true,
    })
    expect(state.dirtyTypes).toEqual(['set-selected-plant-symbol'])
    expect(state.invalidations).toBe(1)
  })

  it('clears selected plant symbols back to inherited symbols', () => {
    const file = makeFile()
    file.plant_species_symbols = { 'Malus domestica': 'canopy' }
    file.plants = file.plants.map((plant) => ({ ...plant, symbol: 'conifer' }))
    const { controller, sceneStore, state } = createController(file)
    sceneStore.setSelection([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'plant', id: 'plant-2' },
    ])

    const changed = controller.setSelectedPlantSymbol(null)

    expect(changed).toBe(2)
    expect(sceneStore.persisted.plants.map((plant) => plant.symbol ?? null)).toEqual([null, null])
    expect(controller.getSelectedPlantSymbolContext()).toMatchObject({
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'canopy',
      inheritedSymbol: 'canopy',
      canClearSelectedSymbol: false,
    })
    expect(state.dirtyTypes).toEqual(['set-selected-plant-symbol'])
  })

  it('updates species symbols through the presentation seam and treats round as an explicit default', () => {
    const { controller, sceneStore, state } = createController()
    sceneStore.setSelection([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'plant', id: 'plant-2' },
    ])

    const changed = controller.setPlantSymbolForSpecies('Malus domestica', 'round')

    expect(changed).toBe(2)
    expect(sceneStore.persisted.plantSpeciesSymbols).toEqual({
      'Malus domestica': 'round',
    })
    expect(sceneStore.persisted.plants.map((plant) => plant.symbol)).toEqual(['round', 'round'])
    expect(controller.getSelectedPlantSymbolContext()).toMatchObject({
      singleSpeciesDefaultSymbol: 'round',
      inheritedSymbol: 'round',
    })
    expect(state.dirtyTypes).toEqual(['set-plant-symbol-for-species'])
    expect(state.invalidations).toBe(1)
  })

  it('does not resymbol locked Plants through species-wide symbol edits', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-2' ? { ...plant, locked: true } : plant,
    )
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantSymbolForSpecies('Malus domestica', 'canopy')
    const lockedPlant = sceneStore.persisted.plants.find((plant) => plant.id === 'plant-2')!

    expect(changed).toBe(1)
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-1')?.symbol).toBe('canopy')
    expect(lockedPlant.symbol).toBe('round')
    expect(resolvePlantSymbolForPlant(lockedPlant, sceneStore.persisted.plantSpeciesSymbols)).toBe('round')
    expect(sceneStore.persisted.plantSpeciesSymbols).toEqual({
      'Malus domestica': 'canopy',
    })
    expect(state.dirtyTypes).toEqual(['set-plant-symbol-for-species'])
  })

  it('does not resymbol Plants inside locked Object Groups through species-wide symbol edits', () => {
    const file = makeFile()
    file.groups = [{
      id: 'group-1',
      name: null,
      locked: true,
      members: [{ kind: 'plant', id: 'plant-2' }],
    }]
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantSymbolForSpecies('Malus domestica', 'canopy')
    const groupedPlant = sceneStore.persisted.plants.find((plant) => plant.id === 'plant-2')!

    expect(changed).toBe(1)
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-1')?.symbol).toBe('canopy')
    expect(groupedPlant.symbol).toBe('round')
    expect(resolvePlantSymbolForPlant(groupedPlant, sceneStore.persisted.plantSpeciesSymbols)).toBe('round')
    expect(state.dirtyTypes).toEqual(['set-plant-symbol-for-species'])
  })

  it('does not create a species symbol edit while the Plants Layer is locked', () => {
    const file = makeFile()
    file.layers = file.layers.map((layer) =>
      layer.name === 'plants' ? { ...layer, locked: true } : layer,
    )
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantSymbolForSpecies('Malus domestica', 'canopy')

    expect(changed).toBe(0)
    expect(sceneStore.persisted.plants.map((plant) => plant.symbol ?? null)).toEqual([null, null])
    expect(sceneStore.persisted.plantSpeciesSymbols).toEqual({})
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(0)
  })

  it('does not recolor locked Plants through species-wide color edits', () => {
    const file = makeFile()
    file.plants = file.plants.map((plant) =>
      plant.id === 'plant-2' ? { ...plant, locked: true } : plant,
    )
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(1)
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-1')?.color).toBe('#C44230')
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-2')?.color).toBeNull()
    expect(sceneStore.persisted.plantSpeciesColors).toEqual({
      'Malus domestica': '#C44230',
    })
    expect(state.plantSpeciesColorSyncs).toBe(1)
    expect(state.dirtyTypes).toEqual(['set-plant-color-for-species'])
  })

  it('does not recolor Plants inside locked Object Groups through species-wide color edits', () => {
    const file = makeFile()
    file.groups = [{
      id: 'group-1',
      name: null,
      locked: true,
      members: [{ kind: 'plant', id: 'plant-2' }],
    }]
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(1)
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-1')?.color).toBe('#C44230')
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-2')?.color).toBeNull()
    expect(sceneStore.persisted.plantSpeciesColors).toEqual({
      'Malus domestica': '#C44230',
    })
    expect(state.plantSpeciesColorSyncs).toBe(1)
    expect(state.dirtyTypes).toEqual(['set-plant-color-for-species'])
  })

  it('does not recolor Plants inside Object Groups locked by another member', () => {
    const file = makeFile()
    file.plants = [
      ...file.plants,
      {
        id: 'plant-3',
        canonical_name: 'Pyrus communis',
        common_name: 'Pear',
        color: null,
        position: geoAt(30, 30),
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: true,
      },
    ]
    file.groups = [{
      id: 'group-1',
      name: null,
      locked: false,
      members: [
        { kind: 'plant', id: 'plant-2' },
        { kind: 'plant', id: 'plant-3' },
      ],
    }]
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(1)
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-1')?.color).toBe('#C44230')
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-2')?.color).toBeNull()
    expect(sceneStore.persisted.plants.find((plant) => plant.id === 'plant-3')?.color).toBeNull()
    expect(sceneStore.persisted.plantSpeciesColors).toEqual({
      'Malus domestica': '#C44230',
    })
    expect(state.plantSpeciesColorSyncs).toBe(1)
    expect(state.dirtyTypes).toEqual(['set-plant-color-for-species'])
  })

  it('does not create a species color edit while the Plants Layer is locked', () => {
    const file = makeFile()
    file.layers = file.layers.map((layer) =>
      layer.name === 'plants' ? { ...layer, locked: true } : layer,
    )
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(0)
    expect(sceneStore.persisted.plants.map((plant) => plant.color)).toEqual([null, null])
    expect(sceneStore.persisted.plantSpeciesColors).toEqual({})
    expect(state.plantSpeciesColorSyncs).toBe(0)
    expect(state.dirtyTypes).toEqual([])
    expect(state.invalidations).toBe(0)
  })

  it('sets a species default color when no placed Plants of that species exist', () => {
    const file = makeFile()
    file.plants = []
    const { controller, sceneStore, state } = createController(file)

    const changed = controller.setPlantColorForSpecies('Malus domestica', '#C44230')

    expect(changed).toBe(0)
    expect(sceneStore.persisted.plantSpeciesColors).toEqual({
      'Malus domestica': '#C44230',
    })
    expect(state.plantSpeciesColorSyncs).toBe(1)
    expect(state.dirtyTypes).toEqual(['set-plant-color-for-species'])
  })
})

// A planted row through the real runtime (plan §4, "2.0 plant along a path"; A5, A7, A11): the row writer's Scene
// Edit and its Undo, the whole-row move, and membership derived on read after every other edit, with undo and redo.
const ROW_PLANTS = ['h1', 'h2', 'h3', 'h4'] as const

/** Four hazels 2 m apart on a row `hedge`, each at its `at`, and an apple beside it. */
function rowFile(): CanopiFile {
  const plant = (id: string, x: number, y: number, canonical = 'Corylus avellana') => ({
    id, canonical_name: canonical, common_name: null, color: null, position: geoAt(x, y), rotation: null, scale: 3,
    notes: null, planted_date: null, quantity: 1, locked: false,
  })
  const plants = [...ROW_PLANTS.map((id, index) => plant(id, index * 2, 0)), plant('apple', 4, 10, 'Malus domestica')]
  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name: 'Row membership',
    description: null,
    plant_species_colors: {},
    layers: [{ name: 'plants', visible: true, locked: false, opacity: 1 }],
    plants,
    zones: [],
    annotations: [],
    measurement_guides: [],
    plant_rows: [{
      id: 'hedge',
      anchors: [{ position: geoAt(0, 0), sharp: false }, { position: geoAt(6, 0), sharp: false }],
      closed: false,
      spacing: { kind: 'interval', interval_m: 2 },
      members: plants.slice(0, 4).map((entry) => ({ plant_id: entry.id, at: entry.position })),
    }],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-10-11T00:00:00.000Z',
    updated_at: '2026-10-11T00:00:00.000Z',
    extra: {},
  }
}

function createRuntime() {
  const runtime = new SceneCanvasRuntime({ appAdapter: createDetachedCanvasRuntimeAppAdapter() })
  runtime.documentSurface.loadDocument(rowFile())
  runtime.documentSurface.resize(400, 300)
  return runtime
}

function sceneEdits(runtime: SceneCanvasRuntime): SceneEditCoordinator {
  return (runtime as unknown as { _sceneCommands: SceneEditCoordinator })._sceneCommands
}

function scene(runtime: SceneCanvasRuntime) {
  return runtime.querySurface.getSceneSnapshot()
}

/** Each row's attached members, by row id. */
function rows(runtime: SceneCanvasRuntime): Record<string, string[]> {
  const snapshot = scene(runtime)
  const plants = plantsById(snapshot)
  return Object.fromEntries(snapshot.plantRows.map((row) => [row.id, attachedPlantRowMembers(row, plants).map((member) => member.plantId)]))
}

function withRuntime(test: (runtime: SceneCanvasRuntime) => void): void {
  const runtime = createRuntime()
  try {
    test(runtime)
  } finally {
    runtime.destroy()
  }
}

describe('the row writer through the scene runtime (A7)', () => {
  it('re-spaces a row in one Scene Edit, and one Undo restores the plants, their ids and the row', () => {
    withRuntime((runtime) => {
      const before = scene(runtime)
      const at = (index: number) => ({ x: before.plants[0]!.position.x + index * 1.5, y: before.plants[0]!.position.y })
      let created = 0
      let members: string[] | null = null
      expect(sceneEdits(runtime).run('interaction-plant-row-edit', (tx) => {
        tx.mutate((draft) => {
          members = applyPlantRowPositions(draft, {
            id: 'hedge', anchors: before.plantRows[0]!.anchors, closed: false, spacing: { kind: 'interval', metres: 1.5 },
            positions: [0, 1, 2, 3, 4, 5].map(at), createId: () => `copy-${++created}`,
          })
        })
        tx.setSelection((members ?? []).map((id) => ({ kind: 'plant', id })))
      })).toBe(true)
      expect(members).toEqual([...ROW_PLANTS, 'copy-1', 'copy-2'])
      expect(rows(runtime)).toEqual({ hedge: members })
      expect(runtime.querySurface.getSelection().map((target) => target.id)).toEqual(members)

      runtime.commandSurface.history.undo()
      expect(scene(runtime).plants).toEqual(before.plants)
      expect(scene(runtime).plantRows).toEqual(before.plantRows)
      runtime.commandSurface.history.redo()
      expect(rows(runtime)).toEqual({ hedge: members })
    })
  })
})

function select(runtime: SceneCanvasRuntime, ids: readonly string[]): void {
  expect(sceneEdits(runtime).run('select', (tx) => tx.setSelection(ids.map((id) => ({ kind: 'plant', id }))))).toBe(true)
}

/** The row's points and members' `at`, which follow a whole-row move. */
function rowGeometry(runtime: SceneCanvasRuntime) {
  const row = scene(runtime).plantRows.find((entry) => entry.id === 'hedge')!
  return { anchors: row.anchors.map((anchor) => anchor.position), at: row.members.map((member) => member.at) }
}

/** Runs `edit`, checks `after`, then that Undo restores the rows and Redo the edit's. */
function expectUndoable(runtime: SceneCanvasRuntime, edit: () => void, after: Record<string, string[]>): void {
  const before = rows(runtime)
  edit()
  expect(rows(runtime)).toEqual(after)
  runtime.commandSurface.history.undo()
  expect(rows(runtime)).toEqual(before)
  runtime.commandSurface.history.redo()
  expect(rows(runtime)).toEqual(after)
}

describe('a whole row moves as a row (A11)', () => {
  it('a nudge of all its plants carries its points and every at, and keeps it a row', () => {
    withRuntime((runtime) => {
      const start = rowGeometry(runtime)
      select(runtime, ROW_PLANTS)
      expectUndoable(runtime, () => {
        expect(runtime.commandSurface.sceneEdits.nudgeSelected({ x: 0.25, y: -1 })).toBe(true)
        runtime.commandSurface.sceneEdits.endNudge()
      }, { hedge: [...ROW_PLANTS] })
      const moved = rowGeometry(runtime)
      const shifted = (points: readonly { x: number; y: number }[]) => points.map((point) => ({ x: point.x + 0.25, y: point.y - 1 }))
      expect(moved.anchors).toEqual(shifted(start.anchors))
      expect(moved.at).toEqual(scene(runtime).plants.slice(0, 4).map((plant) => plant.position))
    })
  })

  it('a rotation of all its plants turns its points and every at about the same pivot', () => {
    withRuntime((runtime) => {
      select(runtime, ROW_PLANTS)
      expectUndoable(runtime, () => runtime.commandSurface.sceneEdits.rotateSelected(90), { hedge: [...ROW_PLANTS] })
      const moved = rowGeometry(runtime)
      const plants = scene(runtime).plants.slice(0, 4).map((plant) => plant.position)
      expect(moved.at).toEqual(plants)
      // The row lay along x; turned a quarter, its first and last points now share an x.
      expect(moved.anchors[0]!.x).toBeCloseTo(moved.anchors[1]!.x, 9)
      expect(Math.abs(moved.anchors[1]!.y - moved.anchors[0]!.y)).toBeCloseTo(6, 4)
    })
  })

  it('a move of all its plants with another plant still carries the row', () => {
    withRuntime((runtime) => {
      select(runtime, [...ROW_PLANTS, 'apple'])
      expectUndoable(runtime, () => {
        runtime.commandSurface.sceneEdits.nudgeSelected({ x: 3, y: 0 })
        runtime.commandSurface.sceneEdits.endNudge()
      }, { hedge: [...ROW_PLANTS] })
    })
  })

  it('a move-drag of all its plants under Select keeps it a row', async () => {
    const renderer = { setSnapshot: vi.fn(), setDraft: vi.fn(), requestRender: vi.fn() }
    const runtime = new SceneCanvasRuntime({ appAdapter: createDetachedCanvasRuntimeAppAdapter() })
    runtime.connectRenderTarget(renderer)
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    await runtime.init(container)
    runtime.documentSurface.loadDocument(rowFile())
    runtime.documentSurface.resize(400, 300)
    const events = createSceneInteractionEventHarness(container)
    try {
      const first = scene(runtime).plants[0]!.position
      placeOnHost(runtime.cameraHost, runtime.querySurface.sessionPlane.peek()!, { x: 100 - first.x * 20, y: 150 - first.y * 20, scale: 20 })
      select(runtime, ROW_PLANTS)
      const start = rowGeometry(runtime)
      events.pointerDown({ x: 100, y: 150 })
      events.pointerMove({ x: 120, y: 150 })
      events.pointerMove({ x: 140, y: 170 })
      events.pointerUp({ x: 140, y: 170 })
      expect(rows(runtime)).toEqual({ hedge: [...ROW_PLANTS] })
      const moved = rowGeometry(runtime)
      expect(moved.anchors[0]!.x - start.anchors[0]!.x).toBeCloseTo(2, 6)
      expect(moved.anchors[0]!.y - start.anchors[0]!.y).toBeCloseTo(1, 6)
      runtime.commandSurface.history.undo()
      expect(rowGeometry(runtime)).toEqual(start)
    } finally {
      events.dispose()
      runtime.destroy()
    }
  })
})

describe('any other edit takes plants out of their row (A5)', () => {
  it('moving some of its plants leaves the rest a row without them', () => {
    withRuntime((runtime) => {
      select(runtime, ['h2', 'h3'])
      expectUndoable(runtime, () => {
        runtime.commandSurface.sceneEdits.nudgeSelected({ x: 0, y: 1 })
        runtime.commandSurface.sceneEdits.endNudge()
      }, { hedge: ['h1', 'h4'] })
    })
  })

  it('rotating some of its plants takes them out', () => {
    withRuntime((runtime) => {
      select(runtime, ['h1', 'h2', 'apple'])
      expectUndoable(runtime, () => runtime.commandSurface.sceneEdits.rotateSelected(45), { hedge: ['h3', 'h4'] })
    })
  })

  it('deleting or cutting a plant takes it out', () => {
    withRuntime((runtime) => {
      select(runtime, ['h4'])
      expectUndoable(runtime, () => runtime.commandSurface.sceneEdits.deleteSelected(), { hedge: ['h1', 'h2', 'h3'] })
      select(runtime, ['h1'])
      expectUndoable(runtime, () => {
        runtime.commandSurface.sceneEdits.copy()
        runtime.commandSurface.sceneEdits.deleteSelected()
      }, { hedge: ['h2', 'h3'] })
    })
  })

  it('copies are plain plants: Ctrl+D and paste leave the row as it was', () => {
    withRuntime((runtime) => {
      select(runtime, ROW_PLANTS)
      expectUndoable(runtime, () => runtime.commandSurface.sceneEdits.duplicateSelected(), { hedge: [...ROW_PLANTS] })
      expect(scene(runtime).plants).toHaveLength(9)
      runtime.commandSurface.sceneEdits.copy()
      expectUndoable(runtime, () => runtime.commandSurface.sceneEdits.paste(), { hedge: [...ROW_PLANTS] })
      expect(scene(runtime).plants).toHaveLength(13)
    })
  })
})
