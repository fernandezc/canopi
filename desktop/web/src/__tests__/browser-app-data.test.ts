import { describe, expect, it } from 'vitest'
import {
  BrowserDraftChangedError,
  createBrowserAppDataStore,
  type BrowserStorageAdapter,
} from '../web/browser-app-data'
import type { CanopiFile } from '../types/design'

const V1_KEY = 'canopi:web-app-data:v1'
const V2_KEYS = {
  drafts: 'canopi:web-app-data:v2:drafts',
  settings: 'canopi:web-app-data:v2:settings',
  species: 'canopi:web-app-data:v2:species',
  stamps: 'canopi:web-app-data:v2:saved-object-stamps',
} as const

describe('browser app data store', () => {
  it('persists Browser Drafts as local convenience state without notebook fields', () => {
    const storage = memoryStorage()
    const store = createBrowserAppDataStore({ storage })
    const file = makeDesign({ name: 'Terrace Draft' })

    const saved = store.saveDraft({ file, now: '2026-07-04T12:00:00.000Z' })

    expect(saved.ok).toBe(true)
    if (!saved.ok) throw new Error('draft should save')
    expect(saved.value).toEqual({
      id: 'draft-terrace-draft',
      name: 'Terrace Draft',
      updatedAt: '2026-07-04T12:00:00.000Z',
    })
    expect(store.listDrafts()).toEqual([saved.value])
    expect(store.loadDraft(saved.value.id)).toEqual({ ...file, extra: {} })
    expect(saved.value).not.toHaveProperty('path')
    expect(saved.value).not.toHaveProperty('sectionId')
    expect([...storage.values.keys()]).toEqual([V2_KEYS.drafts])
  })

  it('refuses a Draft write another tab overtook, and writes a Draft another tab deleted again rather than lose the edit', () => {
    const store = createBrowserAppDataStore({ storage: memoryStorage() })
    store.saveDraft({ id: 'draft-x', file: makeDesign({ name: 'X' }), now: '2026-07-04T12:00:00.000Z' })
    store.saveDraft({ id: 'draft-y', file: makeDesign({ name: 'Y' }), now: '2026-07-04T12:01:00.000Z' })

    const overtaken = store.saveDraft({
      id: 'draft-y',
      file: makeDesign({ name: 'Y', description: 'edited' }),
      now: '2026-07-04T12:06:00.000Z',
      expectedUpdatedAt: '2026-07-04T11:00:00.000Z',
    })
    expect(!overtaken.ok && overtaken.error).toBeInstanceOf(BrowserDraftChangedError)

    store.deleteDraft('draft-x')
    const edit = store.saveDraft({
      id: 'draft-x',
      file: makeDesign({ name: 'X', description: 'edited' }),
      now: '2026-07-04T13:01:00.000Z',
      expectedUpdatedAt: '2026-07-04T12:00:00.000Z',
    })
    expect(edit.ok).toBe(true)
    expect(store.listDrafts().map((draft) => draft.id)).toEqual(['draft-x', 'draft-y'])
  })

  it('stores Draft files in .canopi wire form, keeping unknown fields at the root', () => {
    const storage = memoryStorage()
    const store = createBrowserAppDataStore({ storage })
    const file = { ...makeDesign({ name: 'Wire Draft' }), extra: { future_top_level: { keep: true } } }

    const saved = store.saveDraft({ file, now: '2026-07-04T12:00:00.000Z' })
    if (!saved.ok) throw new Error('draft should save')

    const stored = JSON.parse(storage.values.get(V2_KEYS.drafts)!) as { draftFiles: Record<string, Record<string, unknown>> }
    const wire = stored.draftFiles[saved.value.id]!
    expect(wire).not.toHaveProperty('extra')
    expect(wire.future_top_level).toEqual({ keep: true })
    expect(store.loadDraft(saved.value.id)?.extra).toEqual({ future_top_level: { keep: true } })
  })

  it('persists browser settings, Species app data, and Saved Object Stamps', () => {
    const storage = memoryStorage()
    const store = createBrowserAppDataStore({ storage })

    expect(store.saveSettings({ locale: 'fr', theme: 'dark' }).ok).toBe(true)
    expect(store.loadSettings()).toEqual({ locale: 'fr', theme: 'dark' })

    expect(store.setFavoriteSpecies(['Malus domestica', 'Quercus robur']).ok).toBe(true)
    expect(store.listFavoriteSpecies()).toEqual(['Malus domestica', 'Quercus robur'])

    expect(store.recordRecentlyViewedSpecies('Malus domestica', 3).ok).toBe(true)
    expect(store.recordRecentlyViewedSpecies('Prunus persica', 3).ok).toBe(true)
    expect(store.recordRecentlyViewedSpecies('Malus domestica', 3).ok).toBe(true)
    expect(store.listRecentlyViewedSpecies()).toEqual(['Malus domestica', 'Prunus persica'])

    expect(store.saveSavedObjectStamps([
      { id: 'stamp-1', name: 'Patio guild', payload: { objects: 2 } },
    ]).ok).toBe(true)
    expect(store.listSavedObjectStamps()).toEqual([
      { id: 'stamp-1', name: 'Patio guild', payload: { objects: 2 } },
    ])
    expect([...storage.values.keys()].sort()).toEqual([
      V2_KEYS.settings,
      V2_KEYS.species,
      V2_KEYS.stamps,
    ].sort())
  })

  it('ignores browser data written by an older Canopi', () => {
    const storage = memoryStorage()
    storage.values.set(V1_KEY, JSON.stringify({
      drafts: [{ id: 'draft-1', name: 'Draft', updatedAt: '2026-07-04T12:00:00.000Z' }],
      draftFiles: { 'draft-1': makeDesign({ name: 'Draft' }) },
      settings: { locale: 'fr' },
      favoriteSpecies: ['Malus domestica'],
      recentlyViewedSpecies: ['Pyrus communis'],
      savedObjectStamps: [{ id: 'stamp-1', name: 'Guild', payload: { objects: 2 } }],
    }))
    const store = createBrowserAppDataStore({ storage })

    expect(store.listDrafts()).toEqual([])
    expect(store.loadSettings()).toBeNull()
    expect(store.listFavoriteSpecies()).toEqual([])
    expect(store.listSavedObjectStamps()).toEqual([])
    expect(store.setFavoriteSpecies(['Quercus robur']).ok).toBe(true)
    expect(storage.reads).not.toContain(V1_KEY)
    expect(storage.values.has(V1_KEY)).toBe(true)
  })

  describe('data from before Canopi 2.0', () => {
    const NOW = '2026-10-02T12:00:00.000Z'
    const NOTICE_MARKER = 'canopi:web-app-data:before-2.0-kept-in-place-notice'

    function seedEarlierData(storage: MemoryStorage) {
      const v1 = JSON.stringify({
        drafts: [{ id: 'draft-1', name: 'Draft', updatedAt: '2026-07-04T12:00:00.000Z' }],
        draftFiles: { 'draft-1': { ...makeDesign({ name: 'Draft' }), version: 6 } },
        settings: { locale: 'fr' },
      })
      storage.values.set(V1_KEY, v1)
      seedOlderDrafts(storage)
      return v1
    }

    /** Drafts a Canopi 2 preview stored at version 8, beside a current one. */
    function seedOlderDrafts(storage: MemoryStorage) {
      storage.values.set(V2_KEYS.drafts, JSON.stringify({
        version: 2,
        drafts: [
          { id: 'hedge', name: 'Hedge', updatedAt: '2026-09-20T12:00:00.000Z' },
          { id: 'terrace', name: 'Terrace', updatedAt: '2026-10-01T12:00:00.000Z' },
        ],
        draftFiles: {
          hedge: { ...makeDesign({ name: 'Hedge' }), version: 8 },
          terrace: makeDesign({ name: 'Terrace' }),
        },
      }))
    }

    it('leaves them in place, unread, and tells once, writing only the notice marker', () => {
      const storage = memoryStorage()
      seedV2Partitions(storage)
      seedEarlierData(storage)
      const before = new Map(storage.values)
      const store = createBrowserAppDataStore({ storage })

      expect(store.takeEarlierDataNotice(NOW)).toBe(true)
      expect(storage.writes).toEqual([NOTICE_MARKER])
      expect(new Map([...storage.values].filter(([key]) => key !== NOTICE_MARKER))).toEqual(before)
      expect(store.listDrafts().map((draft) => draft.id)).toEqual(['terrace'])

      const told = new Map(storage.values)
      storage.writes.length = 0
      expect(store.takeEarlierDataNotice('2026-10-03T12:00:00.000Z')).toBe(false)
      expect(storage.writes).toEqual([])
      expect(storage.values).toEqual(told)
    })

    it('says nothing for Drafts of a 2.0 preview alone: only the 1.x document is told', () => {
      const storage = memoryStorage()
      seedOlderDrafts(storage)
      const before = new Map(storage.values)
      const store = createBrowserAppDataStore({ storage })

      expect(store.takeEarlierDataNotice(NOW)).toBe(false)
      expect(storage.writes).toEqual([])
      expect(storage.values).toEqual(before)
    })

    it('writes nothing in a browser without earlier data', () => {
      const storage = memoryStorage()
      seedV2Partitions(storage)
      const store = createBrowserAppDataStore({ storage })

      expect(store.takeEarlierDataNotice(NOW)).toBe(false)
      expect(storage.writes).toEqual([])
    })

    // Probe P-D2 (release close, stream D): Chromium and WebKit throw a
    // QuotaExceededError DOMException for every write at the quota, the notice
    // marker included, and leave existing keys as they were.
    it('tells again and leaves the 1.x document untouched while the browser is full', () => {
      const storage = memoryStorage()
      const v1 = seedEarlierData(storage)
      storage.rejectWrite = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      const store = createBrowserAppDataStore({ storage })
      const before = new Map(storage.values)

      expect(store.takeEarlierDataNotice(NOW)).toBe(true)
      expect(store.takeEarlierDataNotice('2026-10-03T12:00:00.000Z')).toBe(true)
      expect(storage.values).toEqual(before)
      expect(storage.values.get(V1_KEY)).toBe(v1)
    })

    it('does not claim earlier data was found when browser storage cannot be read', () => {
      const storage = memoryStorage()
      seedEarlierData(storage)
      storage.forbiddenReadKeys.add(V1_KEY)
      const store = createBrowserAppDataStore({ storage })

      expect(store.takeEarlierDataNotice(NOW)).toBe(false)
      expect(storage.writes).toEqual([])
    })
  })

  it('saves Settings without reading or serializing the Draft partition', () => {
    const storage = memoryStorage()
    storage.values.set(V2_KEYS.drafts, JSON.stringify({
      version: 2,
      drafts: [{ id: 'large', name: 'Large', updatedAt: '2026-07-04T12:00:00.000Z' }],
      draftFiles: { large: makeDesign({ name: 'x'.repeat(10_000) }) },
    }))
    storage.forbiddenReadKeys.add(V2_KEYS.drafts)
    storage.maxWriteLength = 200
    const store = createBrowserAppDataStore({ storage })

    const result = store.saveSettings({ locale: 'fr', theme: 'dark' })

    expect(result).toEqual({ ok: true, value: { locale: 'fr', theme: 'dark' } })
    expect(storage.reads).not.toContain(V2_KEYS.drafts)
    expect(storage.writes).toEqual([V2_KEYS.settings])
  })

  it('reopens app data without reparsing an already-published Draft partition', () => {
    const storage = memoryStorage()
    const firstStore = createBrowserAppDataStore({ storage })
    expect(firstStore.saveDraft({
      file: makeDesign({ name: 'x'.repeat(10_000) }),
      now: '2026-07-04T12:00:00.000Z',
    }).ok).toBe(true)
    storage.reads.length = 0
    storage.forbiddenReadKeys.add(V2_KEYS.drafts)
    const reopened = createBrowserAppDataStore({ storage })

    expect(reopened.loadSettings()).toBeNull()
    expect(reopened.saveSettings({ locale: 'fr' }).ok).toBe(true)
    expect(storage.reads).not.toContain(V2_KEYS.drafts)
  })

  it.each([
    ['drafts', V2_KEYS.drafts],
    ['settings', V2_KEYS.settings],
    ['species', V2_KEYS.species],
    ['stamps', V2_KEYS.stamps],
  ] as const)('isolates a corrupt %s partition', (_name, corruptKey) => {
    const storage = memoryStorage()
    seedV2Partitions(storage)
    storage.values.set(corruptKey, '{not-json')
    const store = createBrowserAppDataStore({ storage })

    expect(store.listDrafts().map((draft) => draft.id)).toEqual(
      corruptKey === V2_KEYS.drafts ? [] : ['draft-1'],
    )
    expect(store.loadSettings()).toEqual(
      corruptKey === V2_KEYS.settings ? null : { locale: 'fr' },
    )
    expect(store.listFavoriteSpecies()).toEqual(
      corruptKey === V2_KEYS.species ? [] : ['Malus domestica'],
    )
    expect(store.listRecentlyViewedSpecies()).toEqual(
      corruptKey === V2_KEYS.species ? [] : ['Pyrus communis'],
    )
    expect(store.listSavedObjectStamps()).toEqual(
      corruptKey === V2_KEYS.stamps
        ? []
        : [{ id: 'stamp-1', name: 'Guild', payload: { objects: 2 } }],
    )
  })

  it('reports storage failures without replacing existing readable app data', () => {
    const storage = memoryStorage()
    const store = createBrowserAppDataStore({ storage })
    const saved = store.saveDraft({ file: makeDesign({ name: 'Safe Draft' }), now: '2026-07-04T12:00:00.000Z' })
    if (!saved.ok) throw new Error('initial save should pass')
    storage.failWrites = true

    const failed = store.saveDraft({ file: makeDesign({ name: 'Broken Draft' }), now: '2026-07-04T13:00:00.000Z' })

    expect(failed.ok).toBe(false)
    expect(store.listDrafts()).toEqual([saved.value])
    expect(store.loadDraft(saved.value.id)?.name).toBe('Safe Draft')
  })

  it('keeps the stored bytes of Drafts it cannot open when another Draft is saved or deleted', () => {
    const storage = memoryStorage()
    // The released Web Edition stored Drafts as in-memory files at version 6
    // with a root `extra`; this Canopi refuses them but must not erase them.
    const olderDraft = { ...makeDesign({ name: 'Orchard' }), version: 6, extra: {}, spatial_frame: null }
    const damagedDraft = { ...makeDesign({ name: 'Pond' }), plants: 'not-an-array' }
    const olderSummary = { id: 'orchard', name: 'Orchard', updatedAt: '2026-07-04T12:00:00.000Z' }
    const damagedSummary = { id: 'pond', name: 'Pond', updatedAt: '2026-07-04T11:00:00.000Z' }
    storage.values.set(V2_KEYS.drafts, JSON.stringify({
      version: 2,
      drafts: [olderSummary, damagedSummary],
      draftFiles: { orchard: olderDraft, pond: damagedDraft },
    }))
    const store = createBrowserAppDataStore({ storage })
    expect(store.listDrafts()).toEqual([])

    const saved = store.saveDraft({ id: 'new', file: makeDesign({ name: 'New' }), now: '2026-07-05T12:00:00.000Z' })
    expect(saved.ok).toBe(true)
    expect(store.deleteDraft('new').ok).toBe(true)
    expect(store.saveDraft({ id: 'next', file: makeDesign({ name: 'Next' }), now: '2026-07-05T13:00:00.000Z' }).ok).toBe(true)

    const stored = JSON.parse(storage.values.get(V2_KEYS.drafts)!) as {
      drafts: unknown[]
      draftFiles: Record<string, unknown>
    }
    expect(stored.draftFiles.orchard).toEqual(olderDraft)
    expect(stored.draftFiles.pond).toEqual(damagedDraft)
    expect(stored.draftFiles).not.toHaveProperty('new')
    expect(stored.drafts).toEqual(expect.arrayContaining([olderSummary, damagedSummary]))
    expect(store.listDrafts().map((draft) => draft.id)).toEqual(['next'])
  })

  it('isolates corrupted Drafts without discarding unrelated browser app data', () => {
    const storage = memoryStorage()
    seedV2Partitions(storage)
    storage.values.set(V2_KEYS.drafts, JSON.stringify({
      version: 2,
      drafts: [
        { id: 'valid', name: 'Valid', updatedAt: '2026-07-04T12:00:00.000Z' },
        { id: 'corrupt', name: 'Corrupt', updatedAt: '2026-07-04T13:00:00.000Z' },
        { id: 'missing', name: 'Missing', updatedAt: '2026-07-04T14:00:00.000Z' },
      ],
      draftFiles: {
        valid: makeDesign({ name: 'Valid' }),
        corrupt: { ...makeDesign({ name: 'Corrupt' }), plants: 'not-an-array' },
      },
    }))
    storage.values.set(V2_KEYS.settings, JSON.stringify({
      version: 2,
      settings: { locale: 'fr', theme: 'dark' },
    }))
    const store = createBrowserAppDataStore({ storage })

    expect(store.listDrafts().map((draft) => draft.id)).toEqual(['valid'])
    expect(store.loadDraft('valid')?.name).toBe('Valid')
    expect(store.loadDraft('corrupt')).toBeNull()
    expect(store.loadDraft('missing')).toBeNull()
    expect(store.loadSettings()).toEqual({ locale: 'fr', theme: 'dark' })
    expect(store.listFavoriteSpecies()).toEqual(['Malus domestica'])
    expect(store.listRecentlyViewedSpecies()).toEqual(['Pyrus communis'])
    expect(store.listSavedObjectStamps()).toEqual([
      { id: 'stamp-1', name: 'Guild', payload: { objects: 2 } },
    ])
  })
})

interface MemoryStorage extends BrowserStorageAdapter {
  failWrites: boolean
  forbiddenReadKeys: Set<string>
  maxWriteLength: number | null
  /** Every write throws what this returns, as a full browser storage does. */
  rejectWrite: (() => unknown) | null
  reads: string[]
  writes: string[]
  values: Map<string, string>
}

function memoryStorage(): MemoryStorage {
  const values = new Map<string, string>()
  return {
    failWrites: false,
    forbiddenReadKeys: new Set(),
    maxWriteLength: null,
    rejectWrite: null,
    reads: [],
    writes: [],
    values,
    getItem(key) {
      this.reads.push(key)
      if (this.forbiddenReadKeys.has(key)) throw new Error(`forbidden read: ${key}`)
      return values.get(key) ?? null
    },
    setItem(key, value) {
      this.writes.push(key)
      if (this.rejectWrite) throw this.rejectWrite()
      if (this.failWrites || (this.maxWriteLength !== null && value.length > this.maxWriteLength)) {
        throw new Error('storage unavailable')
      }
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

function seedV2Partitions(storage: MemoryStorage): void {
  storage.values.set(V2_KEYS.drafts, JSON.stringify({
    version: 2,
    drafts: [{ id: 'draft-1', name: 'Draft', updatedAt: '2026-07-04T12:00:00.000Z' }],
    draftFiles: { 'draft-1': makeDesign({ name: 'Draft' }) },
  }))
  storage.values.set(V2_KEYS.settings, JSON.stringify({
    version: 2,
    settings: { locale: 'fr' },
  }))
  storage.values.set(V2_KEYS.species, JSON.stringify({
    version: 2,
    favoriteSpecies: ['Malus domestica'],
    recentlyViewedSpecies: ['Pyrus communis'],
  }))
  storage.values.set(V2_KEYS.stamps, JSON.stringify({
    version: 2,
    savedObjectStamps: [{ id: 'stamp-1', name: 'Guild', payload: { objects: 2 } }],
  }))
}

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 9,
    name: 'Draft',
    description: null,
    plant_species_colors: {},
    plant_species_symbols: {},
    plant_species_codes: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    groups: [],
    consortiums: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    views: [],
    stories: [],
    created_at: '2026-07-04T00:00:00.000Z',
    updated_at: '2026-07-04T00:00:00.000Z',
    ...overrides,
  }
}
