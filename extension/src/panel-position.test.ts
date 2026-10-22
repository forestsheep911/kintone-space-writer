import { describe, expect, it } from 'vitest'

import { clampPanelPosition } from './panel-position'

describe('panel position', () => {
  it('keeps a visible grab area in the viewport', () => {
    expect(
      clampPanelPosition({ left: -400, top: 900 }, { width: 800, height: 600 }, { width: 260, height: 180 }),
    ).toEqual({ left: -220, top: 560 })
  })
})
