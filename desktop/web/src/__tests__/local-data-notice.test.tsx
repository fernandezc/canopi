import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../app/shell/modal-layer', () => ({
  holdModalLayer: () => () => {},
  registerModalInertRegion: () => () => {},
}))

import { lidarLibraryStatus, localDataStatus, plantDbStatus } from '../app/health/state'
import { locale } from '../app/settings/state'
import { DegradedBanner } from '../components/shared/DegradedBanner'

const NOT_OPENED = 'Canopi 2.0 can’t open data saved by earlier versions. It was left unchanged, and Canopi started fresh.'

let container: HTMLDivElement

beforeEach(() => {
  locale.value = 'en'
  plantDbStatus.value = 'available'
  lidarLibraryStatus.value = { kind: 'ready' }
  localDataStatus.value = { kind: 'current' }
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  render(null, container)
  container.remove()
  localDataStatus.value = { kind: 'current' }
})

/**
 * Canopi 2.0 does not open local data from before 2.0 (ADR 0021). The native
 * side reports it on the start that renamed the 1.x user database only; the
 * banner says so, in the Web Edition's words, until the user dismisses it.
 */
describe('local data from before Canopi 2.0', () => {
  it('says nothing when the local data is current', async () => {
    await act(async () => { render(<DegradedBanner />, container) })
    expect(container.querySelector('[data-notice-tone]')).toBeNull()
  })

  it('tells the user once that earlier data was not opened, until dismissed', async () => {
    localDataStatus.value = { kind: 'moved_aside' }
    await act(async () => { render(<DegradedBanner />, container) })

    const notice = container.querySelector('[data-notice-tone="info"]')
    expect(notice?.textContent).toContain(NOT_OPENED)
    expect(container.querySelector('[role="alert"]')).toBeNull()

    const dismiss = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Dismiss')
    expect(dismiss).toBeDefined()
    await act(async () => { dismiss!.click() })

    expect(container.querySelector('[data-notice-tone]')).toBeNull()
    expect(localDataStatus.value).toEqual({ kind: 'current' })
  })

  it('stacks with a degraded subsystem in the same row', async () => {
    localDataStatus.value = { kind: 'moved_aside' }
    plantDbStatus.value = 'missing'
    await act(async () => { render(<DegradedBanner />, container) })

    const notices = container.querySelectorAll('[data-notice-tone]')
    expect(notices).toHaveLength(2)
    expect(notices[0]!.parentElement).toBe(notices[1]!.parentElement)
  })
})
