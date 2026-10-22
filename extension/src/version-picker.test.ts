import { describe, expect, it } from 'vitest'

import { imageCacheKey, newestVersionsFirst } from './version-picker'

describe('manual version picker helpers', () => {
  it('reuses an image key only when its digest and rendered width are equal', () => {
    expect(imageCacheKey('same-image', 640)).toBe(imageCacheKey('same-image', 640))
    expect(imageCacheKey('changed-image', 640)).not.toBe(imageCacheKey('same-image', 640))
    expect(imageCacheKey('same-image', 480)).not.toBe(imageCacheKey('same-image', 640))
  })

  it('shows the newest retained versions first', () => {
    expect(
      newestVersionsFirst([
        { id: 'v001', createdAt: '2026-07-16T01:00:00+00:00' },
        { id: 'v002', createdAt: '2026-07-16T02:00:00+00:00' },
      ]),
    ).toEqual([
      { id: 'v002', createdAt: '2026-07-16T02:00:00+00:00' },
      { id: 'v001', createdAt: '2026-07-16T01:00:00+00:00' },
    ])
  })
})
