import type { SatelliteViewport } from './satellite-provider-session'

/**
 * The ephemeral credential the official Google tile path needs, and every URL that carries it: the published tile
 * template and the provider's session and viewport requests (S24). No other module names a Google tile endpoint
 * (map-error-redaction.test.ts), so one file shows where the key goes.
 *
 * A session token is per-generation and expires, so it cannot live in a
 * published source descriptor: the descriptor is a stable, non-secret template
 * and this owner supplies the live token and API key at request time through
 * MapLibre's request transformation seam.
 *
 * The scope is deliberately one fixed endpoint. This is not a proxy and not a
 * general credential injector: a URL that is not the official Google 2D tile
 * path is returned untouched, so a caller-supplied or third-party URL can never
 * receive the key.
 */

/** Google's Map Tiles API. */
const GOOGLE_TILE_API = 'https://tile.googleapis.com/v1/'

/** The only endpoint this transport authenticates. */
const GOOGLE_OFFICIAL_TILE_ENDPOINT = `${GOOGLE_TILE_API}2dtiles/`

/** The placeholder a published descriptor carries instead of a live token. */
const GOOGLE_SESSION_PLACEHOLDER = '{session}'

/**
 * The official Map Tiles API 2D tile path. This is the published,
 * **non-secret** template: the live session and the key are supplied per
 * request by `BasemapTileAuth`, because a descriptor carrying a credential
 * could be persisted, exported or logged.
 */
export const GOOGLE_SESSION_TILES =
  `${GOOGLE_OFFICIAL_TILE_ENDPOINT}{z}/{x}/{y}?session=${GOOGLE_SESSION_PLACEHOLDER}`

/** The provider's session request: it carries the key, so it is never logged. */
export function googleSessionRequestUrl(key: string): string {
  return `${GOOGLE_TILE_API}createSession?key=${encodeURIComponent(key)}`
}

/** The provider's viewport request (copyright and zoom availability): it carries the session and the key. */
export function googleViewportRequestUrl(sessionToken: string, key: string, viewport: SatelliteViewport): string {
  return `${GOOGLE_TILE_API}viewport?session=${encodeURIComponent(sessionToken)}`
    + `&key=${encodeURIComponent(key)}`
    + `&zoom=${viewport.zoom}&north=${viewport.north}&south=${viewport.south}`
    + `&east=${viewport.east}&west=${viewport.west}`
}

export interface BasemapTileCredentials {
  readonly sessionToken: string
  readonly apiKey: string
}

/** Whether a URL addresses the fixed official tile endpoint. */
function isOfficialGoogleTileUrl(url: string): boolean {
  return url.startsWith(GOOGLE_OFFICIAL_TILE_ENDPOINT)
}

/**
 * Whether a tile template still carries the unresolved session placeholder.
 *
 * A descriptor that reaches a map in this state would request a literal
 * `{session}` and fail every tile, so callers refuse it rather than publishing
 * a source they cannot serve.
 */
export function hasUnresolvedSession(url: string): boolean {
  return isOfficialGoogleTileUrl(url) && url.includes(GOOGLE_SESSION_PLACEHOLDER)
}

/**
 * One map lifetime's worth of official tile credentials.
 *
 * Owned by the map, not by the provider and not by a module: the provider
 * publishes into it while it is live and clears it when it is disposed, so a
 * torn-down surface cannot keep authenticating requests.
 */
export class BasemapTileAuth {
  private credentials: BasemapTileCredentials | null = null

  set(credentials: BasemapTileCredentials | null): void {
    this.credentials = credentials
  }

  clear(): void {
    this.credentials = null
  }

  /** Whether a live credential is installed. */
  get installed(): boolean {
    return this.credentials !== null
  }

  /**
   * Authenticate one outgoing request URL.
   *
   * The session placeholder is replaced and the key appended, in that order,
   * for the fixed official endpoint only. Without a credential the template is
   * returned unchanged: the caller has already withdrawn the contribution, and
   * a request that slips through fails on Google's side rather than silently
   * addressing a different service.
   */
  authorize(url: string): string {
    if (!isOfficialGoogleTileUrl(url)) return url
    const credentials = this.credentials
    if (!credentials) return url
    const withSession = url.includes(GOOGLE_SESSION_PLACEHOLDER)
      ? url.split(GOOGLE_SESSION_PLACEHOLDER).join(encodeURIComponent(credentials.sessionToken))
      : url
    const separator = withSession.includes('?') ? '&' : '?'
    return `${withSession}${separator}key=${encodeURIComponent(credentials.apiKey)}`
  }

  /**
   * The request transformation MapLibre calls for every resource it fetches.
   *
   * Bound as a function rather than a method so a map can be handed
   * `tileAuth.transformRequest` directly.
   */
  readonly transformRequest = (url: string): { url: string } => ({ url: this.authorize(url) })
}
