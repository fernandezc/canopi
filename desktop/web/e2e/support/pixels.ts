// Page pixels for the Web Edition browser checks that read what the canvas drew without a baseline: a square of the
// page's screenshot around a point, decoded in the page, and one pixel of it.
import type { Page } from '@playwright/test'
import type { Point } from './fingers'

export interface Pixels { readonly x: number, readonly y: number, readonly width: number, readonly height: number, readonly data: Uint8Array }

/**
 * The page's pixels in a square around `at`, decoded in the page from a screenshot. They come back as one base64
 * string: as an array of numbers, a 524 px square took WebKit 18.6 s to serialise on two cores, past the poll's timeout.
 */
export async function pixelsAround(page: Page, at: Point, half: number): Promise<Pixels> {
  const viewport = page.viewportSize()!
  const x = Math.max(0, Math.round(at.x - half))
  const y = Math.max(0, Math.round(at.y - half))
  const clip = { x, y, width: Math.min(viewport.width - x, 2 * half), height: Math.min(viewport.height - y, 2 * half) }
  const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
  const decoded = await page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data
    let binary = ''
    for (let start = 0; start < bytes.length; start += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
    }
    return { width: canvas.width, height: canvas.height, data: btoa(binary) }
  }, png.toString('base64'))
  return { x, y, width: decoded.width, height: decoded.height, data: new Uint8Array(Buffer.from(decoded.data, 'base64')) }
}

export function pixel(pixels: Pixels, x: number, y: number): readonly [number, number, number] {
  const i = ((Math.round(y) - pixels.y) * pixels.width + (Math.round(x) - pixels.x)) * 4
  return [pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!]
}
