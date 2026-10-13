type MapLibreCanvasSurfaceStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * The background band's download status (maplibre/map-background.ts): Satellite's while it is on, else the
 * OpenFreeMap Basemap's; `failed` until Retry, a new download, or the row is hidden.
 */
export type MapLibreBasemapStatus = 'idle' | 'loading' | 'ok' | 'failed'

/** Engine text never enters this state: notices are fixed, localized sentences and the cause goes to the log. */
export interface MapLibreCanvasSurfaceState {
  readonly status: MapLibreCanvasSurfaceStatus
  readonly terrainStatus: MapLibreCanvasSurfaceStatus
  /** An optional map contribution (overlay, raster band) was skipped; the map stays editable. */
  readonly layerSkipped: boolean
  readonly basemapStatus: MapLibreBasemapStatus
  /** With status `error`: a user Retry can rebuild the map (WebGL2 present, the runtime alive). */
  readonly retryable: boolean
}

export const IDLE_MAPLIBRE_CANVAS_SURFACE_STATE: MapLibreCanvasSurfaceState = {
  status: 'idle',
  terrainStatus: 'idle',
  layerSkipped: false,
  basemapStatus: 'idle',
  retryable: false,
}

/** The map cannot be built (no WebGL2), or the canvas runtime that would draw it could not start; no Retry is offered. */
export const UNAVAILABLE_MAPLIBRE_CANVAS_SURFACE_STATE: MapLibreCanvasSurfaceState = {
  ...IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  status: 'error',
}

export function mapLibreCanvasSurfaceStateEquals(
  left: MapLibreCanvasSurfaceState,
  right: MapLibreCanvasSurfaceState,
): boolean {
  return (
    left.status === right.status
    && left.terrainStatus === right.terrainStatus
    && left.layerSkipped === right.layerSkipped
    && left.basemapStatus === right.basemapStatus
    && left.retryable === right.retryable
  )
}
