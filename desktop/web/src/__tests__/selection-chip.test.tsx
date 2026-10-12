import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale, plantSpacingIntervalM } from '../app/settings/state'
import { phoneLayout } from '../app/shell/phone-layout'
import { SelectionChip } from '../components/canvas/SelectionChip'
import { RenameZoneDialog } from '../components/canvas/RenameZoneDialog'
import { renameZoneDialog } from '../app/rename-zone/state'
import { SpeciesFocusChip } from '../components/canvas/SpeciesFocusChip'
import { plantFinderMapMatches } from '../app/plant-finder/map-matches'
import { SceneStore } from '../canvas/runtime/scene/store'
import { rowOfSelection } from '../canvas/runtime/scene/plant-rows'
import type { SceneDesignObjectSelection } from '../canvas/runtime/scene'
import type { CanvasCommandSurface, CanvasPlantRowSpacing } from '../canvas/runtime/runtime'
import { setCurrentCanvasSession } from '../canvas/session'
import { currentCanvasSelection } from '../canvas/session-state'
import {
  createTestCanvasCommandSurface,
  createTestCanvasDocumentSurface,
  createTestCanvasKeyboardPort,
} from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface, type TestCanvasQuerySurface } from './support/canvas-query-surface'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'
import { createDetachedCanvasRuntimeAppAdapter } from '../canvas/runtime/app-adapter'
import { CURRENT_CANOPI_FILE_VERSION } from '../generated/canopi-design-format'
import type { CanopiFile } from '../types/design'
import { geoAt } from './support/geo-design'

const RECT_ID = 'zone-ee08f9f9-634f-4723-bbde-1200610562dc'
const ELLIPSE_ID = 'zone-0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b'
const LINE_ID = 'zone-9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'
const GUIDE_ID = 'measurement-guide-6f1e2d3c-4b5a-4968-8776-655443322110'

const PLANTS = [
  { id: 'apricot-1', canonicalName: 'Prunus armeniaca', commonName: 'Apricot' },
  { id: 'apricot-2', canonicalName: 'Prunus armeniaca', commonName: 'Apricot' },
  { id: 'apricot-3', canonicalName: 'Prunus armeniaca', commonName: 'Apricot' },
  { id: 'fig-1', canonicalName: 'Ficus carica', commonName: 'Fig' },
  { id: 'mint-1', canonicalName: 'Mentha spicata', commonName: null },
]

describe('Selection chip', () => {
  let container: HTMLDivElement
  let queries: TestCanvasQuerySurface
  let selectSpecies: ReturnType<typeof vi.fn<CanvasCommandSurface['sceneEdits']['selectSpecies']>>
  let clearSelection: ReturnType<typeof vi.fn<CanvasCommandSurface['sceneEdits']['clearSelection']>>

  beforeEach(() => {
    locale.value = 'en'
    container = document.createElement('div')
    document.body.append(container)
    const store = new SceneStore()
    store.updatePersisted((draft) => {
      draft.plants = PLANTS.map((plant, index) => ({
        id: plant.id,
        canonicalName: plant.canonicalName,
        commonName: plant.commonName,
        kind: 'plant',
        locked: false,
        color: null,
        symbol: 'herb',
        position: { x: index * 5, y: 0 },
        canopySpreadM: null,
        rotationDeg: 0,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }))
      draft.zones = [{
        kind: 'zone', id: 'zone-z04', name: 'Z04', locked: false, zoneType: 'polygon', rotationDeg: 0, fillColor: null, notes: null,
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      }, {
        // Drawn with the Rectangle tool and never named.
        kind: 'zone', id: RECT_ID, name: null, locked: false, zoneType: 'rect', rotationDeg: 30, fillColor: null, notes: null,
        points: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 0, y: 10 }],
      }, {
        kind: 'zone', id: ELLIPSE_ID, name: null, locked: false, zoneType: 'ellipse', rotationDeg: 0, fillColor: null, notes: null,
        points: [{ x: 50, y: 50 }, { x: 10, y: 5 }],
      }, {
        kind: 'zone', id: LINE_ID, name: null, locked: false, zoneType: 'line', rotationDeg: 0, fillColor: null, notes: null,
        points: [{ x: 0, y: 0 }, { x: 30, y: 40 }],
      }]
      draft.annotations = [{
        kind: 'annotation', id: 'note-1', locked: false, annotationType: 'text', position: { x: 1, y: 1 },
        text: 'Mulch in November', fontSize: 14, rotationDeg: null,
      }]
      draft.measurementGuides = [{
        kind: 'measurement-guide', id: GUIDE_ID, locked: false, start: { x: 0, y: 0 }, end: { x: 3, y: 4 },
      }]
      draft.groups = [{
        kind: 'group', id: 'guild', locked: false, name: 'Guild',
        members: [{ kind: 'plant', id: 'fig-1' }, { kind: 'plant', id: 'mint-1' }],
      }]
    })
    queries = createTestCanvasQuerySurface({
      scene: store.persisted,
      localizedNames: new Map([['Prunus armeniaca', 'Apricot'], ['Mentha spicata', null]]),
    })
    selectSpecies = vi.fn<CanvasCommandSurface['sceneEdits']['selectSpecies']>()
    clearSelection = vi.fn<CanvasCommandSurface['sceneEdits']['clearSelection']>()
    setCurrentCanvasSession({
      commands: createTestCanvasCommandSurface({ sceneEdits: { selectSpecies, clearSelection } }),
      queries,
      documents: createTestCanvasDocumentSurface(),
      keyboard: createTestCanvasKeyboardPort(),
    })
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    currentCanvasSelection.value = new Set()
    plantFinderMapMatches.value = null
    setCurrentCanvasSession(null)
  })

  async function select(targets: SceneDesignObjectSelection): Promise<void> {
    await act(() => {
      queries.setSelection(targets)
      currentCanvasSelection.value = new Set(targets.map((target) => target.id))
    })
  }

  const chip = () => container.querySelector<HTMLElement>('[data-selection-chip]')
  const status = () => chip()?.querySelector('[role="status"]')?.textContent?.replace(/\s+/g, ' ').trim()
  const buttons = () => [...(chip()?.querySelectorAll('button') ?? [])].map((button) => button.textContent)

  it('shows nothing without a selection', async () => {
    await act(() => render(<SelectionChip />, container))
    expect(chip()).toBeNull()
  })

  it('names one plant and offers Select all of this species and Clear selection', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'plant', id: 'apricot-1' }])

    expect(chip()!.getAttribute('role')).toBe('group')
    expect(chip()!.getAttribute('aria-label')).toBe('Selection')
    const live = chip()!.querySelector('[role="status"]')!
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(status()).toBe('Apricot')
    expect(buttons()).toEqual(['Select all of this species', 'Clear selection'])
    for (const button of chip()!.querySelectorAll('button')) {
      expect(button.getAttribute('type')).toBe('button')
      expect(button.tabIndex).toBe(0)
    }

    await act(() => chip()!.querySelector<HTMLButtonElement>('button')!.click())
    expect(selectSpecies).toHaveBeenCalledWith(['Prunus armeniaca'])
    await act(() => [...chip()!.querySelectorAll<HTMLButtonElement>('button')].at(-1)!.click())
    expect(clearSelection).toHaveBeenCalledTimes(1)
  })

  it('counts plants of one species, and drops Select all once the whole species is selected', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'apricot-2' }])
    expect(status()).toBe('2 plants · Apricot · 5 m apart')
    expect(buttons()).toEqual(['Select all of this species', 'Clear selection'])

    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'apricot-2' }, { kind: 'plant', id: 'apricot-3' }])
    expect(status()).toBe('3 plants · Apricot · 5 m apart')
    expect(buttons()).toEqual(['Clear selection'])
  })

  it('counts species across plants, expanding groups, and falls back to the scientific name', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'group', id: 'guild' }])
    expect(status()).toBe('3 plants · 3 species · 8.3 m apart')
    expect(buttons()).toEqual(['Clear selection'])

    await select([{ kind: 'plant', id: 'mint-1' }])
    expect(status()).toBe('Mentha spicata')
  })

  it('names a species with no name in the interface language by its English name, marked', async () => {
    await act(() => render(<SelectionChip />, container))
    await act(() => {
      locale.value = 'fr'
      queries.setEnglishFallbackNames(new Map([['Mentha spicata', 'Spearmint']]))
      queries.bumpPlantNamesRevision()
    })
    await select([{ kind: 'plant', id: 'mint-1' }])
    const live = chip()!.querySelector('[role="status"]')!
    expect(live.querySelector('b [lang="en"]')?.textContent).toBe('Spearmint')
    expect(live.querySelector('b [aria-hidden="true"]')?.textContent).toBe('(angl.)')
  })

  it('marks the English name in the one-species detail and the right-click heading', async () => {
    const { readMapSelectionSummary } = await import('../app/map-selection/summary')
    const { mapSelectionHeading } = await import('../app/map-selection/summary-text')
    await act(() => {
      locale.value = 'fr'
      queries.setLocalizedNames(new Map([['Prunus armeniaca', null]]))
      queries.setEnglishFallbackNames(new Map([['Prunus armeniaca', 'Apricot']]))
      queries.bumpPlantNamesRevision()
    })
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'apricot-2' }])
    const detail = [...chip()!.querySelectorAll('[role="status"] span')].find((span) => span.querySelector('[lang="en"]'))
    expect(detail?.querySelector('[lang="en"]')?.textContent).toBe('Apricot')
    expect(mapSelectionHeading(readMapSelectionSummary(queries)!, 'fr').replace(/\s+/g, ' ')).toBe('2 plantes · Apricot (angl.) · espacées de 5 m')
  })

  it('gives the spacing of the selected plants', async () => {
    await act(() => render(<SelectionChip />, container))
    // Plants sit 5 m apart in a row; the mean nearest-neighbour distance is 5 m.
    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'apricot-2' }, { kind: 'plant', id: 'apricot-3' }])
    expect(status()).toBe('3 plants · Apricot · 5 m apart')
    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'fig-1' }, { kind: 'plant', id: 'mint-1' }])
    // 1 → 4 and 4 ↔ 5: (15 + 5 + 5) / 3 m.
    expect(status()).toBe('3 plants · 3 species · 8.3 m apart')
    await act(() => { locale.value = 'fr' })
    expect(status()).toBe('3 plantes · 3 espèces · espacées de 8,3 m')
  })

  it('names a zone by its name, with its area and perimeter', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'zone', id: 'zone-z04' }])
    // A right triangle with 10 m legs: 50 m², 10 + 10 + 14.1 m around.
    expect(status()).toBe('Zone · Z04 · 50 m² · 34.1 m')
  })

  it('never shows an id: an unnamed zone is named by its type', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'zone', id: RECT_ID }])
    expect(status()).toBe('Rectangle zone · 120 m² · 44 m')
    await select([{ kind: 'zone', id: ELLIPSE_ID }])
    // π · 10 · 5 m², and Ramanujan's perimeter of a 20 × 10 m ellipse.
    expect(status()).toBe('Ellipse zone · 157 m² · 48.4 m')
    await select([{ kind: 'zone', id: LINE_ID }])
    expect(status()).toBe('Line zone · 50 m')
    await act(() => { locale.value = 'fr' })
    expect(status()).toBe('Zone linéaire · 50 m')
  })

  it('offers Rename… for one zone, which renames it by its id through the runtime', async () => {
    const renameZone = vi.fn<CanvasCommandSurface['sceneEdits']['renameZone']>(() => true)
    setCurrentCanvasSession({
      commands: createTestCanvasCommandSurface({ sceneEdits: { selectSpecies, clearSelection, renameZone } }),
      queries,
      documents: createTestCanvasDocumentSurface(),
      keyboard: createTestCanvasKeyboardPort(),
    })
    await act(() => render(<><SelectionChip /><RenameZoneDialog /></>, container))
    await select([{ kind: 'zone', id: 'zone-z04' }, { kind: 'zone', id: RECT_ID }])
    expect(buttons()).toEqual(['Clear selection'])

    await select([{ kind: 'zone', id: RECT_ID }])
    await act(() => chip()!.querySelector<HTMLButtonElement>('button')!.click())
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
    expect(input.value).toBe('')
    await act(() => {
      input.value = '  Kitchen bed '
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(() => input.form!.requestSubmit())

    expect(renameZone).toHaveBeenCalledWith(RECT_ID, 'Kitchen bed')
    expect(renameZoneDialog.value).toBeNull()
  })

  it('a mouse click on Rename… opens the dialog (a finger\'s trailing click is the DOM input source\'s)', async () => {
    await act(() => render(<><SelectionChip /><RenameZoneDialog /></>, container))
    await select([{ kind: 'zone', id: RECT_ID }])
    const rename = [...chip()!.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Rename…')!

    await act(() => {
      rename.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, buttons: 1 }))
      rename.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
      rename.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    })
    expect(renameZoneDialog.value).not.toBeNull()
  })

  it('names a text note by its text and a measurement by its length', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'annotation', id: 'note-1' }])
    expect(status()).toBe('Text note · Mulch in November')
    await select([{ kind: 'measurement-guide', id: GUIDE_ID }])
    expect(status()).toBe('Measurement · 5 m')
  })

  it('names a zone and summarises a mixed selection', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'zone', id: 'zone-z04' }])
    expect(status()).toContain('Zone · Z04')
    expect(buttons()).toEqual(['Rename…', 'Clear selection'])

    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'fig-1' }, { kind: 'zone', id: 'zone-z04' }, { kind: 'annotation', id: 'note-1' }])
    expect(status()).toBe('4 selected · 2 plants · 1 zone · 1 text note')
  })

  it('follows the language', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'fig-1' }])
    await act(() => { locale.value = 'fr' })
    expect(status()).toBe('2 plantes · 2 espèces · espacées de 15 m')
    expect(buttons()).toEqual(['Effacer la sélection'])
  })

  it('sits apart from the finder chip: a separate bottom chip in the visible map area', async () => {
    plantFinderMapMatches.value = { query: 'apri', canonicalNames: ['Prunus armeniaca'] }
    await act(() => render(<><SpeciesFocusChip /><SelectionChip /></>, container))
    await select([{ kind: 'plant', id: 'apricot-1' }])
    const finder = container.querySelector('[aria-label="Plants highlighted on the map"]')
    expect(finder).not.toBeNull()
    expect(finder!.contains(chip())).toBe(false)
    expect(chip()!.dataset.selectionChip).toBe('bottom')
  })

  it('never shows an object id, whatever is selected', async () => {
    await act(() => render(<SelectionChip />, container))
    const scene = queries.getSceneSnapshot()
    const ids = [
      ...scene.plants.map((plant) => plant.id),
      ...scene.zones.map((zone) => zone.id),
      ...scene.annotations.map((note) => note.id),
      ...scene.measurementGuides.map((guide) => guide.id),
      ...scene.groups.map((group) => group.id),
    ]
    const targets: SceneDesignObjectSelection = [
      ...scene.plants.map((plant) => ({ kind: 'plant' as const, id: plant.id })),
      ...scene.zones.map((zone) => ({ kind: 'zone' as const, id: zone.id })),
      ...scene.annotations.map((note) => ({ kind: 'annotation' as const, id: note.id })),
      ...scene.measurementGuides.map((guide) => ({ kind: 'measurement-guide' as const, id: guide.id })),
      { kind: 'group' as const, id: 'guild' },
    ]
    const selections: SceneDesignObjectSelection[] = [
      ...targets.map((target) => [target]),
      targets,
      targets.filter((target) => target.kind === 'zone'),
      [{ kind: 'group', id: 'guild' }, { kind: 'annotation', id: 'note-1' }],
    ]
    for (const selection of selections) {
      await select(selection)
      const text = chip()!.textContent ?? ''
      for (const id of ids) expect(text).not.toContain(id)
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i)
    }
  })
})

// A planted row (plan §4 "2.0 plant along a path", A7): Select row on some of its plants, and its spacing once selected.
describe('Selection chip on a planted row', () => {
  const ROW = ['hazel-1', 'hazel-2', 'hazel-3'] as const
  let container: HTMLDivElement
  let queries: TestCanvasQuerySurface
  let selectPlantRow: ReturnType<typeof vi.fn<NonNullable<CanvasCommandSurface['sceneEdits']['selectPlantRow']>>>
  let setPlantRowSpacing: ReturnType<typeof vi.fn<NonNullable<CanvasCommandSurface['sceneEdits']['setPlantRowSpacing']>>>
  let rowLocked = false
  // The row's spacing as the runtime would read it after an edit or an Undo; null keeps the scene's.
  let rowSpacing: CanvasPlantRowSpacing | null = null

  beforeEach(() => {
    locale.value = 'en'
    container = document.createElement('div')
    document.body.append(container)
    const store = new SceneStore()
    store.updatePersisted((draft) => {
      draft.plants = [...ROW, 'hazel-4'].map((id, index) => ({
        id, canonicalName: 'Corylus avellana', commonName: 'Hazel', kind: 'plant', locked: false, color: null, symbol: 'shrub',
        position: { x: index * 2, y: 0 }, canopySpreadM: null, rotationDeg: 0, notes: null, plantedDate: null, quantity: 1,
      }))
      draft.plantRows = [{
        kind: 'plant-row', id: 'hedge', closed: false, spacing: { kind: 'interval', metres: 2 },
        anchors: [{ position: { x: 0, y: 0 }, sharp: false }, { position: { x: 4, y: 0 }, sharp: false }],
        members: ROW.map((plantId, index) => ({ plantId, at: { x: index * 2, y: 0 } })),
      }]
    })
    const base = createTestCanvasQuerySurface({ scene: store.persisted, localizedNames: new Map([['Corylus avellana', 'Hazel']]) })
    // The runtime's query reads the row through the row module; this one does the same over the fake's scene, whose
    // 4 m hedge every 2 m makes three spots 2 m apart.
    queries = Object.assign(base, {
      getSelectedPlantRow: () => {
        const selected = rowOfSelection(base.getSceneSnapshot(), base.getSelection())
        return selected && {
          id: selected.row.id, whole: selected.whole, spots: 3, spacing: rowSpacing ?? selected.row.spacing, gapM: 2,
          locked: rowLocked,
        }
      },
    })
    selectPlantRow = vi.fn()
    setPlantRowSpacing = vi.fn(() => true)
    rowLocked = false
    rowSpacing = null
    setCurrentCanvasSession({
      commands: createTestCanvasCommandSurface({ sceneEdits: { selectPlantRow, setPlantRowSpacing } }),
      queries,
      documents: createTestCanvasDocumentSurface(),
      keyboard: createTestCanvasKeyboardPort(),
    })
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    currentCanvasSelection.value = new Set()
    setCurrentCanvasSession(null)
  })

  async function select(ids: readonly string[]): Promise<void> {
    await act(() => {
      queries.setSelection(ids.map((id) => ({ kind: 'plant', id })))
      currentCanvasSelection.value = new Set(ids)
    })
  }

  const chip = () => container.querySelector<HTMLElement>('[data-selection-chip]')
  const button = (name: string) => [...(chip()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((entry) => entry.textContent === name)

  it('offers Select row on some of a row\'s plants, which selects the row through the runtime, and not once it is selected', async () => {
    await act(() => render(<SelectionChip />, container))
    await select(['hazel-2'])
    expect(button('Select row'), 'a row plant offers Select row').toBeDefined()
    await act(() => button('Select row')!.click())
    expect(selectPlantRow).toHaveBeenCalledTimes(1)

    await select(ROW)
    expect(button('Select row'), 'a selected row offers no Select row').toBeUndefined()
    await select(['hazel-4'])
    expect(button('Select row'), 'a plant of no row offers none').toBeUndefined()
    await select(['hazel-1', 'hazel-4'])
    expect(button('Select row'), 'nor a selection reaching outside the row').toBeUndefined()
  })

  const status = () => chip()!.querySelector('[role="status"]')!.textContent?.replace(/\s+/g, ' ').trim()

  it('on a phone, a selected row\'s spacing takes the place of Select all of this species and the distance apart', async () => {
    phoneLayout.value = 'landscape'
    try {
      await act(() => render(<SelectionChip />, container))
      await select(ROW)
      // The canvas menu keeps Select all of this species; the row's own spacing stands for the distance apart.
      expect(button('Select all of this species')).toBeUndefined()
      expect(status()).toBe('3 plants · Hazel')
      await select(['hazel-2'])
      expect(button('Select all of this species'), 'some plants of a row keep it').toBeDefined()
    } finally {
      phoneLayout.value = null
    }
  })

  const spacingField = () => chip()?.querySelector<HTMLInputElement>('[data-plant-row-spacing-input]') ?? null
  const countField = () => chip()?.querySelector<HTMLInputElement>('[data-plant-row-count-input]') ?? null
  const mode = (kind: 'interval' | 'count') => chip()!.querySelector<HTMLButtonElement>(`[data-plant-row-mode="${kind}"]`)!

  async function type(field: HTMLInputElement, text: string, key?: 'Enter' | 'Escape'): Promise<void> {
    await act(() => {
      field.focus()
      field.value = text
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    if (key) await act(() => { field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
  }

  it('shows a selected row\'s spacing, which re-spaces the row at Enter or on leaving an edited field, never as the device setting', async () => {
    plantSpacingIntervalM.value = 0.8
    await act(() => render(<SelectionChip />, container))
    await select(['hazel-2'])
    expect(spacingField(), 'some plants of a row show no spacing').toBeNull()

    await select(ROW)
    expect(spacingField()!.value).toBe('2 m')
    expect(button('Select all of this species'), 'a desktop chip keeps Select all of this species').toBeDefined()
    expect(status(), 'and the plants\' distance apart').toMatch(/^3 plants · Hazel · .+ apart$/)
    expect(mode('interval').getAttribute('aria-pressed')).toBe('true')
    expect(mode('count').getAttribute('aria-pressed')).toBe('false')
    // Leaving the field unedited changes nothing.
    await act(() => { spacingField()!.focus(); spacingField()!.blur() })
    expect(setPlantRowSpacing).not.toHaveBeenCalled()

    await type(spacingField()!, '1,5', 'Enter')
    expect(setPlantRowSpacing).toHaveBeenLastCalledWith('hedge', { kind: 'interval', metres: 1.5 })
    await type(spacingField()!, 'twelve', 'Enter')
    expect(spacingField()!.getAttribute('aria-invalid')).toBe('true')
    expect(setPlantRowSpacing).toHaveBeenCalledTimes(1)
    await type(spacingField()!, '2 m', 'Escape')
    expect(spacingField()!.value, 'Esc puts the row\'s spacing back').toBe('2 m')

    // The switch re-spaces the row from where the other mode starts (the spots its spacing makes), and leaves the field ready.
    await act(() => mode('count').click())
    expect(setPlantRowSpacing, 'the switch re-spaces the row').toHaveBeenCalledTimes(2)
    expect(setPlantRowSpacing).toHaveBeenLastCalledWith('hedge', { kind: 'count', count: 3 })
    expect(spacingField()).toBeNull()
    expect(countField()!.value, 'Plants starts at the row\'s spots').toBe('3')
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    expect(document.activeElement, 'the switch focuses the field').toBe(countField())
    await type(countField()!, '5')
    await act(() => { countField()!.blur() })
    expect(setPlantRowSpacing).toHaveBeenLastCalledWith('hedge', { kind: 'count', count: 5 })
    expect(setPlantRowSpacing).toHaveBeenCalledTimes(3)
    expect(plantSpacingIntervalM.value, 'the device interval is untouched').toBe(0.8)
  })

  it('shows the row\'s own spacing again once the row changes (an Undo), keeping the field and its focus', async () => {
    await act(() => render(<SelectionChip />, container))
    await select(ROW)
    const field = spacingField()!
    await type(field, '7')
    rowSpacing = { kind: 'count', count: 4 }
    await select([...ROW])
    expect(mode('count').getAttribute('aria-pressed')).toBe('true')
    expect(countField(), 'the same field, now for plants').toBe(field)
    expect(field.value).toBe('4')
    expect(document.activeElement).toBe(field)
    await act(() => { field.blur() })
    expect(setPlantRowSpacing, 'the dropped edit is not kept on leaving').not.toHaveBeenCalled()
  })

  it('a switch the row refuses keeps the mode pressed with its field marked invalid', async () => {
    await act(() => render(<SelectionChip />, container))
    await select(ROW)
    setPlantRowSpacing.mockReturnValueOnce(false)
    await act(() => mode('count').click())
    expect(setPlantRowSpacing).toHaveBeenLastCalledWith('hedge', { kind: 'count', count: 3 })
    expect(mode('count').getAttribute('aria-pressed')).toBe('true')
    expect(countField()!.getAttribute('aria-invalid')).toBe('true')
  })

  it('marks a spacing the row refuses as invalid and keeps the field, so the chip never shows a spacing the row lacks', async () => {
    await act(() => render(<SelectionChip />, container))
    await select(ROW)
    setPlantRowSpacing.mockReturnValueOnce(false)
    await type(spacingField()!, '5', 'Enter')
    expect(setPlantRowSpacing).toHaveBeenLastCalledWith('hedge', { kind: 'interval', metres: 5 })
    expect(spacingField()!.getAttribute('aria-invalid'), 'no plant fits every 5 m').toBe('true')
    expect(document.activeElement, 'Enter keeps the field').toBe(spacingField())
    await type(spacingField()!, '1', 'Enter')
    expect(setPlantRowSpacing).toHaveBeenLastCalledWith('hedge', { kind: 'interval', metres: 1 })
    expect(spacingField()!.getAttribute('aria-invalid')).toBe('false')
  })

  it('shows a locked row\'s spacing and switch disabled', async () => {
    rowLocked = true
    await act(() => render(<SelectionChip />, container))
    await select(ROW)
    expect(spacingField()!.disabled).toBe(true)
    expect(mode('interval').disabled).toBe(true)
    expect(mode('count').disabled).toBe(true)
  })
})

// The chip over the real runtime: what the switch sends is what the row's query reads, and the writer applies it.
describe('Selection chip on a planted row, over the runtime', () => {
  const hazel = (id: string, x: number, y = 0) => ({
    id, canonical_name: 'Corylus avellana', common_name: null, color: null, position: geoAt(x, y), rotation: null,
    scale: 3, notes: null, planted_date: null, quantity: 1, locked: false,
  })

  // An L-shaped hedge: a, b and c 2 m apart along 4 m, and a side row started from `from`, which the hedge gave up.
  function lHedge(from: 'a' | 'c'): CanopiFile {
    const plants = [hazel('a', 0), hazel('b', 2), hazel('c', 4)]
    const corner = from === 'a' ? 0 : 4
    const interval = { kind: 'interval' as const, interval_m: 2 }
    return {
      version: CURRENT_CANOPI_FILE_VERSION, name: 'Hedge', description: null, plant_species_colors: {},
      layers: [{ name: 'plants', visible: true, locked: false, opacity: 1 }],
      plants: [...plants, hazel('up', corner, 2)], zones: [], annotations: [], measurement_guides: [],
      plant_rows: [
        {
          id: 'hedge', closed: false, spacing: interval,
          anchors: [{ position: geoAt(0, 0), sharp: false }, { position: geoAt(4, 0), sharp: false }],
          members: plants.filter((plant) => plant.id !== from).map((plant) => ({ plant_id: plant.id, at: plant.position })),
        },
        {
          id: 'side', closed: false, spacing: interval,
          anchors: [{ position: geoAt(corner, 0), sharp: false }, { position: geoAt(corner, 2), sharp: false }],
          members: [{ plant_id: from, at: geoAt(corner, 0) }, { plant_id: 'up', at: geoAt(corner, 2) }],
        },
      ],
      consortiums: [], groups: [], timeline: [], budget: [], budget_currency: 'EUR',
      created_at: '2026-10-12T00:00:00.000Z', updated_at: '2026-10-12T00:00:00.000Z', extra: {},
    }
  }

  it.each(['c', 'a'] as const)('the Plants switch on a hedge whose plant %s started another row keeps every plant', async (from) => {
    locale.value = 'en'
    const container = document.createElement('div')
    document.body.append(container)
    const runtime = new SceneCanvasRuntime({ appAdapter: createDetachedCanvasRuntimeAppAdapter() })
    const chip = () => container.querySelector<HTMLElement>('[data-selection-chip]')
    const button = (name: string) => [...(chip()?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((entry) => entry.textContent === name)
    try {
      runtime.documentSurface.loadDocument(lHedge(from))
      setCurrentCanvasSession({
        commands: runtime.commandSurface,
        queries: runtime.querySurface,
        documents: runtime.documentSurface,
        keyboard: createTestCanvasKeyboardPort(),
      })
      await act(() => render(<SelectionChip />, container))
      // A click on the hedge's b (session state, as a click is), then Select row.
      await act(() => (runtime as unknown as { _setSelection(targets: unknown): void })._setSelection([{ kind: 'plant', id: 'b' }]))
      await act(() => button('Select row')!.click())
      const hedge = ['a', 'b', 'c'].filter((id) => id !== from)
      expect(runtime.querySurface.getSelection().map((target) => target.id)).toEqual(hedge)

      await act(() => chip()!.querySelector<HTMLButtonElement>('[data-plant-row-mode="count"]')!.click())
      // Three spots along the hedge's 4 m, one of them the side row's: the switch keeps the layout.
      expect(chip()!.querySelector<HTMLInputElement>('[data-plant-row-count-input]')!.value).toBe('3')
      expect(runtime.querySurface.getSelectedPlantRow?.()?.spacing).toEqual({ kind: 'count', count: 3 })
      expect(runtime.querySurface.getSceneSnapshot().plants.map((plant) => plant.id).sort(), 'no plant is lost')
        .toEqual(['a', 'b', 'c', 'up'])
      expect(runtime.querySurface.getSelection().map((target) => target.id), 'the hedge stays selected').toEqual(hedge)
    } finally {
      render(null, container)
      container.remove()
      currentCanvasSelection.value = new Set()
      setCurrentCanvasSession(null)
      runtime.destroy()
    }
  })
})
