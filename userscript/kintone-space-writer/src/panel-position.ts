export type PanelPosition = { left: number; top: number }

type Size = { width: number; height: number }

const EDGE = 8

export function clampPanelPosition(position: PanelPosition, viewport: Size, panel: Size): PanelPosition {
  return {
    left: Math.min(Math.max(position.left, EDGE), Math.max(EDGE, viewport.width - panel.width - EDGE)),
    top: Math.min(Math.max(position.top, EDGE), Math.max(EDGE, viewport.height - panel.height - EDGE)),
  }
}
