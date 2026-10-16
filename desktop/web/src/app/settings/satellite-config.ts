import type { SatelliteConfig } from '../../maplibre/satellite-provider'
import { activeGoogleMapsApiKey, locale } from './state'

/**
 * The Satellite imagery configuration every map mount is given: the saved Google key while Settings › Map and imagery
 * chooses it, and the app locale. A getter, not values: it reads the settings signals, so the band's settings observer
 * that calls it follows a key or locale change on a live map. The only path from the key to a map (P40, P46).
 */
export function readSatelliteConfig(): SatelliteConfig {
  return { googleMapsApiKey: activeGoogleMapsApiKey.value, locale: locale.value }
}
