const READY_CHECK_INTERVAL_MS = 5_000
const DISCOVERY_DELAYS_MS = [5_000, 10_000, 30_000]

export function isReadyCheckDue(lastCheckAt: number, now: number, manual: boolean) {
  return manual || now - lastCheckAt >= READY_CHECK_INTERVAL_MS
}

export function nextDiscoveryDelay(consecutiveFailures: number) {
  return DISCOVERY_DELAYS_MS[Math.min(consecutiveFailures, DISCOVERY_DELAYS_MS.length - 1)]
}
