// Fingers for the Web Edition browser checks: real touch input through CDP Input.dispatchTouchEvent, so Chromium only
// (Playwright's WebKit has page.touchscreen.tap and no multi-touch driver). A spec using it skips WebKit with a reason.
import type { CDPSession, Page } from '@playwright/test'

export interface Point { readonly x: number, readonly y: number }

/**
 * Fingers through CDP Input.dispatchTouchEvent. Each call sends every finger still down (CDP's contract); a finger
 * keeps its id from its start to its lift, so Chromium makes one pointer of each.
 */
export class Fingers {
  private readonly down = new Map<number, Point>()

  private constructor(private readonly cdp: CDPSession) {}

  static async of(page: Page): Promise<Fingers> {
    return new Fingers(await page.context().newCDPSession(page))
  }

  private async send(type: 'touchStart' | 'touchMove' | 'touchEnd'): Promise<void> {
    const touchPoints = [...this.down].map(([id, { x, y }]) => ({ id, x, y, radiusX: 4, radiusY: 4, force: 1 }))
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
  }

  async start(id: number, at: Point): Promise<void> {
    this.down.set(id, at)
    await this.send('touchStart')
  }

  async move(moves: Readonly<Record<number, Point>>): Promise<void> {
    for (const [id, at] of Object.entries(moves)) this.down.set(Number(id), at)
    await this.send('touchMove')
  }

  async end(id: number): Promise<void> {
    this.down.delete(id)
    await this.send('touchEnd')
  }

  /** One finger: down, along `path`, held `holdMs` at its end, then up. */
  async tap(at: Point, { holdMs = 0, path = [] }: { holdMs?: number, path?: readonly Point[] } = {}): Promise<void> {
    await this.start(0, at)
    for (const point of path) await this.move({ 0: point })
    if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs))
    await this.end(0)
  }

  /** One finger dragged from `from` to `to` in `steps` moves. */
  async drag(from: Point, to: Point, steps = 10): Promise<void> {
    await this.start(0, from)
    for (let step = 1; step <= steps; step += 1) await this.move({ 0: lerp(from, to, step / steps) })
    await this.end(0)
  }

  /**
   * Two fingers on either side of `centre`, `radius` apart from it, ending `endRadius` from a centre moved by `drift`
   * and turned by `turnDeg` (positive is clockwise on screen); both lift at the end.
   */
  async pair(centre: Point, radius: number, { endRadius = radius, turnDeg = 0, drift = { x: 0, y: 0 }, steps = 12 } = {}): Promise<void> {
    const place = (t: number) => {
      const r = radius + (endRadius - radius) * t
      const angle = (turnDeg * t * Math.PI) / 180
      const c = { x: centre.x + drift.x * t, y: centre.y + drift.y * t }
      const dx = Math.cos(angle) * r
      const dy = Math.sin(angle) * r
      return { 0: { x: c.x - dx, y: c.y - dy }, 1: { x: c.x + dx, y: c.y + dy } }
    }
    const start = place(0)
    await this.start(0, start[0])
    await this.start(1, start[1])
    for (let step = 1; step <= steps; step += 1) await this.move(place(step / steps))
    await this.end(1)
    await this.end(0)
  }
}

function lerp(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}
