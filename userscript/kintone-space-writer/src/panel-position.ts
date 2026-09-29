export type PanelPosition = { left: number; top: number }

type Size = { width: number; height: number }

// Keep a small grab area visible instead of requiring the whole panel to stay
// on screen. This lets the panel reach every part of the browser viewport
// without becoming impossible to recover.
const VISIBLE_EDGE = 40

export function clampPanelPosition(position: PanelPosition, viewport: Size, panel: Size): PanelPosition {
  return {
    left: Math.min(Math.max(position.left, VISIBLE_EDGE - panel.width), viewport.width - VISIBLE_EDGE),
    top: Math.min(Math.max(position.top, VISIBLE_EDGE - panel.height), viewport.height - VISIBLE_EDGE),
  }
}
