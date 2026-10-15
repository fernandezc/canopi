import { effect, signal } from '@preact/signals'
import type { convertFileSrc } from '@tauri-apps/api/core'
import type { RasterDisplayLayer } from '../../maplibre/raster-display/adapter'
import { lidarDisplayDescriptor, type LidarDisplayDescriptor } from '../../ipc/lidar'
import type { LibraryItemRole } from '../../generated/contracts'
import { lidarFailureMessage } from './lidar-failures'
import { cutOutlierRange, requestCutOutlierRange, resetCutOutlierRanges } from './display-range'
import { displayVariant, itemTypeStyle, type DisplayVariant, type LidarDisplayStyle, type RasterStyleInput } from './item-types'
import { storyPresentationOverrides } from '../story-presentation/overrides'
import { readCurrentLidarPresentation, refreshLidarLibrary, type LidarPresentationItem } from './library-store'

/**
 * Display descriptors of library entities, keyed by entity, generation and
 * variant (`displayVariant`: the relief Relief draws, else the elevation a
 * ramp colours).
 *
 * The library owns derivative preparation; this store only asks for the
 * descriptor of each generation something wants to draw or measure (a visible
 * Design reference, a library preview, or an entry set to Cut outliers) and
 * polls while it is preparing. Entries are identity-keyed, so a descriptor of
 * an older generation, or of the other variant, can never be used for this one.
 *
 * A refused or failed call (a busy executor, a catalogue read error) is no
 * answer about the derivative: the key is asked again, ever more slowly, and
 * only a call that keeps failing reads Display failed until one answers, its
 * reason recorded once through `lidarFailureMessage`. A
 * failed preparation is an answer and is never asked again unasked.
 */
export const lidarDisplayDescriptors = signal<ReadonlyMap<string, LidarDisplayDescriptor>>(new Map())

const PREPARING_POLL_MS = 800
/** A refused call is asked again after 0.8 s, doubling up to this. */
const MAX_REASK_MS = 30_000
/** Consecutive refusals before an entry reads Display failed: a busy executor clears well before. */
const REFUSALS_BEFORE_FAILED = 3
const MAX_ENTRIES = 256

const inflight = new Set<string>()
const pollTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Consecutive refused calls per key, while it is being asked again. */
const refusals = new Map<string, number>()
let storeGeneration = 0

/** A descriptor's identity: entity, generation and the derivative it draws, so relief and elevation never share one. */
export function displayKey(kind: LibraryItemRole, entityId: string, generationId: string | null, variant: DisplayVariant): string {
  return `${kind}/${entityId}/${generationId ?? ''}${variant === 'relief' ? '/relief' : ''}`
}

export function readLidarDisplay(
  kind: LibraryItemRole,
  entityId: string,
  generationId: string | null,
  variant: DisplayVariant,
): LidarDisplayDescriptor | null {
  return lidarDisplayDescriptors.value.get(displayKey(kind, entityId, generationId, variant)) ?? null
}

/** The derivative one entry draws; a reference whose item is gone draws nothing, so its elevation stands in. */
function entryVariant(item: Pick<LidarPresentationItem, 'itemType' | 'ramp'>): DisplayVariant {
  return item.itemType ? displayVariant(item.itemType, item) : 'elevation'
}

/** The descriptor of what one Site data entry draws, for its row's Preparing and Display failed. */
export function readLidarEntryDisplay(
  item: Pick<LidarPresentationItem, 'kind' | 'id' | 'generationId' | 'itemType' | 'ramp'>,
): LidarDisplayDescriptor | null {
  return item.generationId ? readLidarDisplay(item.kind, item.id, item.generationId, entryVariant(item)) : null
}

function store(key: string, descriptor: LidarDisplayDescriptor): void {
  const next = new Map(lidarDisplayDescriptors.value)
  next.delete(key)
  next.set(key, descriptor)
  while (next.size > MAX_ENTRIES) next.delete(next.keys().next().value!)
  lidarDisplayDescriptors.value = next
}

/**
 * Ask the library for one generation's descriptor of a variant unless an
 * answer that does not change on its own (ready, unavailable, failed) is
 * already stored.
 */
export function requestLidarDisplay(
  kind: LibraryItemRole,
  entityId: string,
  generationId: string | null,
  variant: DisplayVariant,
  options: { retry?: boolean } = {},
): void {
  const key = displayKey(kind, entityId, generationId, variant)
  const relief = variant === 'relief'
  const current = lidarDisplayDescriptors.value.get(key)
  if (!options.retry && current && current.state !== 'Preparing' && !refusals.has(key)) return
  if (inflight.has(key) || (!options.retry && pollTimers.has(key))) return
  inflight.add(key)
  const owner = storeGeneration
  void lidarDisplayDescriptor({
    kind,
    entity_id: entityId,
    expected_generation_id: generationId,
    retry: options.retry ?? false,
    relief,
  })
    .then((descriptor) => {
      if (owner !== storeGeneration) return
      refusals.delete(key)
      store(key, descriptor)
      if (descriptor.state === 'Preparing') {
        pollTimers.set(key, setTimeout(() => {
          pollTimers.delete(key)
          if (owner === storeGeneration) requestLidarDisplay(kind, entityId, generationId, variant)
        }, PREPARING_POLL_MS))
      } else if (descriptor.state === 'Stale') {
        // The item moved on: a fresh library read brings the new generation.
        void refreshLidarLibrary()
      }
    })
    .catch((error: unknown) => {
      if (owner !== storeGeneration) return
      const refused = (refusals.get(key) ?? 0) + 1
      refusals.set(key, refused)
      if (refused === REFUSALS_BEFORE_FAILED) {
        store(key, {
          kind,
          entity_id: entityId,
          generation_id: generationId,
          profile: '',
          relief,
          state: 'Failed',
          // The row reads Display failed; the reason goes to diagnostics, once per run of refusals.
          message: lidarFailureMessage(error),
          assets: [],
          prepared_assets: 0,
          total_assets: 0,
        })
      }
      clearTimeout(pollTimers.get(key))
      pollTimers.set(key, setTimeout(() => {
        pollTimers.delete(key)
        if (owner === storeGeneration) requestLidarDisplay(kind, entityId, generationId, variant)
      }, Math.min(MAX_REASK_MS, PREPARING_POLL_MS * 2 ** (refused - 1))))
    })
    .finally(() => inflight.delete(key))
}

/**
 * Whether the map draws an entry: as a presented story step shows it (its
 * library ids), else as the Design shows it (`shown`). Only the map reads the
 * story override, since the side dock is closed while a story is presented.
 */
function mapShown(
  item: Pick<LidarPresentationItem, 'id' | 'shown'>,
  presentedIds: ReadonlySet<string> | null,
): boolean {
  return presentedIds ? presentedIds.has(item.id) : item.shown
}

let displayDisposer: (() => void) | null = null

/**
 * Keep descriptors current for every reference the map draws, a presented
 * story step's included, of the variant it draws, and for every entry drawn
 * in Colours set to Cut outliers, shown or not, and read that entry's range
 * from its elevation once ready (`toAssetUrl` serves the display COGs). Relief
 * draws stored greys, so an entry drawing it reads no range.
 * Installed for the Desktop workspace lifetime next to the library workflow.
 */
export function installLidarDisplayDescriptors(toAssetUrl: (path: string) => string = lidarAssetUrl): void {
  disposeLidarDisplayDescriptors()
  displayDisposer = effect(() => {
    const presentedIds = storyPresentationOverrides.value?.siteDataIds ?? null
    const descriptors = lidarDisplayDescriptors.value
    for (const item of readCurrentLidarPresentation()) {
      if (item.availability !== 'present' || !item.generationId) continue
      const variant = entryVariant(item)
      const cutOutliers = variant === 'elevation' && item.range?.mode === 'CutOutliers'
      // A hidden entry set to Cut outliers still reads its range: its fields and legend show it, and Custom starts from it.
      if (mapShown(item, presentedIds) || cutOutliers) requestLidarDisplay(item.kind, item.id, item.generationId, variant)
      if (!cutOutliers) continue
      const key = displayKey(item.kind, item.id, item.generationId, 'elevation')
      const descriptor = descriptors.get(key)
      if (descriptor?.state === 'Ready' && descriptor.generation_id === item.generationId) {
        requestCutOutlierRange(key, descriptor.assets.map((asset) => ({ url: toAssetUrl(asset.path), bbox: asset.bounds })))
      }
    }
  })
}

export function disposeLidarDisplayDescriptors(): void {
  displayDisposer?.()
  displayDisposer = null
  storeGeneration += 1
  resetCutOutlierRanges()
  for (const timer of pollTimers.values()) clearTimeout(timer)
  pollTimers.clear()
  refusals.clear()
  inflight.clear()
}

/** Replicates Tauri v2 `convertFileSrc` so pure projection stays testable. */
export function lidarAssetUrl(path: string): string {
  const encoded = encodeURIComponent(path)
  const platform = typeof navigator !== 'undefined' ? navigator.platform : ''
  return platform.startsWith('Win') ? `http://asset.localhost/${encoded}` : `asset://localhost/${encoded}`
}

/**
 * Upstream palette and stretch for one entry, always in its item's stored
 * units: its own ramp, Reverse and range over its item type's defaults, with
 * Cut outliers' range once it is read. A reference whose item is gone has no
 * type: it draws nothing and has no legend.
 */
export function lidarDisplayStyle(
  item: RasterStyleInput & Pick<LidarPresentationItem, 'kind' | 'id' | 'generationId' | 'itemType'>,
): LidarDisplayStyle | null {
  if (!item.itemType) return null
  const cutRange = item.range?.mode === 'CutOutliers' && item.generationId && entryVariant(item) === 'elevation'
    ? cutOutlierRange(displayKey(item.kind, item.id, item.generationId, 'elevation'))
    : null
  return itemTypeStyle(item.itemType, { ...item, cutRange })
}

/**
 * Project the references the map draws (`mapShown`) into renderer layers,
 * back to front, each from the derivative of the variant it draws; a relief
 * layer's id ends `-relief`, so the renderer never restyles one variant's
 * tiles into the other. A reference whose derivatives are not ready draws
 * nothing yet; the rest of the band keeps rendering.
 */
export function lidarDisplayLayers(
  items: readonly LidarPresentationItem[],
  descriptors: ReadonlyMap<string, LidarDisplayDescriptor>,
  presentedIds: ReadonlySet<string> | null,
  toAssetUrl: typeof convertFileSrc = lidarAssetUrl,
): RasterDisplayLayer[] {
  const layers: RasterDisplayLayer[] = []
  for (const item of items) {
    if (!mapShown(item, presentedIds) || item.availability !== 'present' || !item.generationId) continue
    const variant = entryVariant(item)
    const descriptor = descriptors.get(displayKey(item.kind, item.id, item.generationId, variant))
    if (!descriptor || descriptor.state !== 'Ready' || descriptor.generation_id !== item.generationId) continue
    if (descriptor.assets.length === 0) continue
    const style = lidarDisplayStyle(item)
    if (!style) continue
    const bounds = descriptor.assets.reduce<[number, number, number, number]>(
      (union, asset) => [
        Math.min(union[0], asset.bounds[0]),
        Math.min(union[1], asset.bounds[1]),
        Math.max(union[2], asset.bounds[2]),
        Math.max(union[3], asset.bounds[3]),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    )
    layers.push({
      id: `lidar-${item.kind === 'Derived' ? 'result' : 'source'}-${item.id}-${item.generationId}${variant === 'relief' ? '-relief' : ''}`,
      name: item.name,
      assets: descriptor.assets.map((asset) => ({ url: toAssetUrl(asset.path), bbox: asset.bounds })),
      bounds,
      opacity: item.opacity,
      rescale: style.rescale,
      colormap: style.colormap,
      reversed: style.reversed,
    })
  }
  return layers
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeLidarDisplayDescriptors()
  })
}
