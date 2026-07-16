import { describe, expect, it } from 'vitest'

import { clampPanelPosition } from './panel-position'

describe('panel position', () => {
  it('keeps a stored panel position inside the viewport', () => {
    expect(
      clampPanelPosition({ left: -40, top: 900 }, { width: 800, height: 600 }, { width: 260, height: 180 }),
    ).toEqual({ left: 8, top: 412 })
  })
})
