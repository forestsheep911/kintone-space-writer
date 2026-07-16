import { describe, expect, it } from 'vitest'

import { isReadyCheckDue, nextDiscoveryDelay } from './bridge-polling'

describe('bridge polling schedule', () => {
  it('checks for a Ready package at most once every five seconds unless manual', () => {
    expect(isReadyCheckDue(10_000, 14_999, false)).toBe(false)
    expect(isReadyCheckDue(10_000, 15_000, false)).toBe(true)
    expect(isReadyCheckDue(10_000, 10_001, true)).toBe(true)
  })

  it('backs off disconnected Bridge discovery and caps it at thirty seconds', () => {
    expect(nextDiscoveryDelay(0)).toBe(5_000)
    expect(nextDiscoveryDelay(1)).toBe(10_000)
    expect(nextDiscoveryDelay(2)).toBe(30_000)
    expect(nextDiscoveryDelay(10)).toBe(30_000)
  })
})
