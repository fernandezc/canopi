import { describe, expect, it } from 'vitest'
import tauriConfigText from '../../../tauri.conf.json?raw'

function readTauriCsp(): Record<string, string> {
  const config = JSON.parse(tauriConfigText)
  return config.app.security.csp
}

describe('Tauri CSP', () => {
  it('allows shared blob workers through the WebKit worker-src fallback', () => {
    const csp = readTauriCsp()

    expect(csp['worker-src']).toContain('blob:')
    expect(csp['child-src']).toContain('blob:')
  })
})

describe('Tauri window', () => {
  // Windows' WebView2 drops HTML5 drags inside the page while native file drops are on, so dragging a plant from the
  // catalog or Favorites onto the map would fail there (canopi-f47t.6.2; user, 2026-10-13). Nothing reads native drops.
  it('turns native file drops off so HTML5 drags reach the map on Windows', () => {
    const config = JSON.parse(tauriConfigText)

    expect(config.app.windows.map((window: { dragDropEnabled?: boolean }) => window.dragDropEnabled)).toEqual([false])
  })
})
