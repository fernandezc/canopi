import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatRelativeDate } from '../components/shared/relative-date'

// The start screen's dates in a zone east of UTC (canopi-f47t.61): Recent Designs and Drafts carry UTC instants with
// their zone (`…Z`), and the row shows the local day and time.
describe('formatRelativeDate in Europe/Paris', () => {
  let zone: string | undefined
  beforeAll(() => {
    zone = process.env.TZ
    process.env.TZ = 'Europe/Paris'
  })
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  })

  it('pins the zone it runs in', () => {
    expect(new Date('2026-10-13T23:11:59Z').getHours()).toBe(1)
  })

  it('shows a Design saved at 01:11 CEST, 23:11 UTC the day before, as today at 1:11 AM', () => {
    const now = new Date('2026-10-14T08:00:00Z')
    expect(formatRelativeDate('2026-10-13T23:11:59Z', 'en', now)).toBe('Today, 1:11 AM')
  })

  it('shows a Draft stamped with milliseconds in local time too', () => {
    const now = new Date('2026-10-14T08:00:00Z')
    expect(formatRelativeDate('2026-10-12T22:30:00.000Z', 'en', now)).toBe('Yesterday, 12:30 AM')
  })

  it('shows an older instant by its local day', () => {
    const now = new Date('2026-10-14T08:00:00Z')
    expect(formatRelativeDate('2026-09-11T22:30:00Z', 'en', now)).toBe('Sep 12')
  })
})
