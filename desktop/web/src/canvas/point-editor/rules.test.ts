import { describe, expect, it } from 'vitest'

import { CLOSE_DISTANCE_PX, pointMenuItems, pointPressIntent, type PointPress } from './rules'

const press = (overrides: Partial<PointPress>): PointPress => ({
  role: 'point',
  clickCount: 1,
  alt: false,
  isLastDraftPoint: false,
  ...overrides,
})

describe('the point contract (A2): what a press on a point or a midpoint dot does', () => {
  it('a press on a point moves it; a still one only makes it the last-touched point', () => {
    expect(pointPressIntent(press({}))).toBe('move')
    expect(pointPressIntent(press({ isLastDraftPoint: true }))).toBe('move')
  })

  it('Alt+click on a point deletes it, on the last draft point and on a double-click too', () => {
    expect(pointPressIntent(press({ alt: true }))).toBe('delete')
    expect(pointPressIntent(press({ alt: true, isLastDraftPoint: true }))).toBe('delete')
    expect(pointPressIntent(press({ alt: true, clickCount: 2, isLastDraftPoint: true }))).toBe('delete')
  })

  it('a double-click on the last draft point finishes; on any other point it is an ordinary press', () => {
    expect(pointPressIntent(press({ clickCount: 2, isLastDraftPoint: true }))).toBe('finish')
    expect(pointPressIntent(press({ clickCount: 3, isLastDraftPoint: true }))).toBe('finish')
    expect(pointPressIntent(press({ clickCount: 2 }))).toBe('move')
  })

  it('a press on a dot inserts a point that follows the pointer; a double-click inserts one in place', () => {
    expect(pointPressIntent(press({ role: 'dot' }))).toBe('insert-drag')
    expect(pointPressIntent(press({ role: 'dot', clickCount: 2 }))).toBe('insert')
  })

  it('Alt changes nothing on a dot: a still Alt press inserts nothing, as a still press does', () => {
    expect(pointPressIntent(press({ role: 'dot', alt: true }))).toBe('insert-drag')
    expect(pointPressIntent(press({ role: 'dot', alt: true, clickCount: 2 }))).toBe('insert')
  })

  it('isLastDraftPoint means nothing on a dot', () => {
    expect(pointPressIntent(press({ role: 'dot', clickCount: 2, isLastDraftPoint: true }))).toBe('insert')
  })
})

describe('the point menu (A16)', () => {
  it('a row point offers Delete point, then Sharp corner while smooth', () => {
    expect(pointMenuItems({ sharpable: true, sharp: false, canDelete: true })).toEqual([
      { action: 'delete-point', disabled: false },
      { action: 'sharp-corner', disabled: false },
    ])
  })

  it('a sharp row point offers Smooth corner instead', () => {
    expect(pointMenuItems({ sharpable: true, sharp: true, canDelete: true })).toEqual([
      { action: 'delete-point', disabled: false },
      { action: 'smooth-corner', disabled: false },
    ])
  })

  it('a zone corner is not sharpable: Delete point only', () => {
    expect(pointMenuItems({ sharpable: false, sharp: false, canDelete: true })).toEqual([
      { action: 'delete-point', disabled: false },
    ])
  })

  it('a point at the minimum keeps Delete point, disabled', () => {
    expect(pointMenuItems({ sharpable: false, sharp: false, canDelete: false })).toEqual([
      { action: 'delete-point', disabled: true },
    ])
    expect(pointMenuItems({ sharpable: true, sharp: true, canDelete: false })).toEqual([
      { action: 'delete-point', disabled: true },
      { action: 'smooth-corner', disabled: false },
    ])
  })
})

describe('the close distance', () => {
  it('closes within 8 px for a mouse or a pen and 22 px for a finger, half ADR 0010s 44 px target', () => {
    expect(CLOSE_DISTANCE_PX).toEqual({ mouse: 8, pen: 8, touch: 22 })
    expect(Object.isFrozen(CLOSE_DISTANCE_PX)).toBe(true)
  })
})
