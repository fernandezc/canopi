import { describe, expect, it } from 'vitest'
import type { PathPoints } from '../plant-path/curve'
import {
  addPoint,
  closePath,
  editDraft,
  insertAfter,
  movePoint,
  removePoint,
  setSharp,
  startDraft,
  stepBack,
  stepForward,
} from './anchors'

const at = (x: number, y = 0) => ({ position: { x, y }, sharp: false })

function open(...xs: readonly number[]): PathPoints {
  return { points: xs.map((x) => at(x)), closed: false }
}

describe('the point reducer', () => {
  it('adds, moves, inserts and sharpens points without changing its argument', () => {
    const path = open(0, 10)
    const frozen = JSON.stringify(path)
    expect(addPoint(path, { x: 20, y: 0 }, true).points.at(-1)).toEqual({ position: { x: 20, y: 0 }, sharp: true })
    expect(movePoint(path, 1, { x: 12, y: 3 }).points[1]).toEqual({ position: { x: 12, y: 3 }, sharp: false })
    expect(insertAfter(path, 0, { x: 5, y: 2 }).points.map((point) => point.position.x)).toEqual([0, 5, 10])
    expect(setSharp(path, 1, true).points[1]!.sharp).toBe(true)
    expect(JSON.stringify(path)).toBe(frozen)
    // Nothing to do answers the same path.
    expect(setSharp(path, 1, false)).toBe(path)
    expect(movePoint(path, 7, { x: 0, y: 0 })).toBe(path)
    expect(insertAfter(path, 1, { x: 15, y: 0 }), 'an open path has no segment after its last point').toBe(path)
  })

  it('removes a point down to 2 on an open path and 3 on a loop', () => {
    expect(removePoint(open(0, 5, 10), 1)?.points.map((point) => point.position.x)).toEqual([0, 10])
    expect(removePoint(open(0, 10), 1)).toBeNull()
    const loop = closePath(open(0, 5, 10, 15))!
    expect(removePoint(loop, 3)).toMatchObject({ closed: true })
    expect(removePoint(removePoint(loop, 3)!, 0)).toBeNull()
  })

  it('closes a path of 3 points or more, and inserts on a loop\'s closing segment', () => {
    expect(closePath(open(0, 5))).toBeNull()
    const loop = closePath(open(0, 5, 10))!
    expect(loop.closed).toBe(true)
    expect(addPoint(loop, { x: 1, y: 1 }, false)).toBe(loop)
    expect(insertAfter(loop, 2, { x: 5, y: 5 }).points.map((point) => point.position)).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }])
  })
})

describe('a draft\'s step-backs', () => {
  it('step back point by point onto the redo stack, then forward again', () => {
    let draft = startDraft(at(0))
    for (const x of [5, 10, 15]) draft = editDraft(draft, addPoint(draft.path, { x, y: 0 }, false))
    const full = draft.path

    draft = stepBack(draft, 1)!
    draft = stepBack(draft, 1)!
    expect(draft.path.points.map((point) => point.position.x)).toEqual([0, 5])
    draft = stepForward(draft)!
    expect(draft.path.points.map((point) => point.position.x)).toEqual([0, 5, 10])
    draft = stepForward(draft)!
    expect(draft.path).toBe(full)
    expect(stepForward(draft)).toBeNull()
  })

  it('keeps the points it is told to keep, opens a loop first and forgets its redo on an edit', () => {
    let draft = startDraft(at(0))
    expect(stepBack(draft, 1)).toBeNull()
    draft = editDraft(draft, addPoint(draft.path, { x: 5, y: 0 }, false))
    draft = editDraft(draft, addPoint(draft.path, { x: 5, y: 5 }, true))
    draft = editDraft(draft, closePath(draft.path)!)

    draft = stepBack(draft, 1)!
    expect(draft.path).toMatchObject({ closed: false })
    expect(draft.path.points).toHaveLength(3)
    draft = stepBack(draft, 1)!
    expect(draft.redo).toHaveLength(2)
    draft = editDraft(draft, movePoint(draft.path, 1, { x: 6, y: 0 }))
    expect(draft.redo).toEqual([])
    expect(editDraft(draft, draft.path)).toBe(draft)
  })
})
