// @vitest-environment node
/**
 * Raster tile seams (canopi-f47t.49): adjacent tiles of one derivative, read
 * through the real `cog-tiler-wasm` as the display lane draws them, meet with
 * no gap, no value step and no under-line along their shared edge.
 *
 * Placeholder: the seam probe that counts gaps, steps and under-lines is the
 * relief stream's first commit; until then `seamCounts` answers null and the
 * case is expected to fail.
 */
import { describe, expect, it } from 'vitest'

interface SeamCounts {
  /** Edge pixels left transparent between two tiles that both hold data. */
  gaps: number
  /** Edge pixel pairs whose values differ by more than the derivative's own neighbours do. */
  steps: number
  /** Edge pixels drawn from the tile underneath instead of the tile that owns them. */
  underLines: number
}

/** Replaced by the probe through the real cog-tiler (canopi-f47t.49). */
async function seamCounts(): Promise<SeamCounts | null> {
  return null
}

describe('raster tile seams', () => {
  it.fails('[expected-fail R canopi-f47t.49] adjacent tiles of a derivative meet with no gap, step or under-line', async () => {
    expect(await seamCounts()).toEqual({ gaps: 0, steps: 0, underLines: 0 })
  })
})
