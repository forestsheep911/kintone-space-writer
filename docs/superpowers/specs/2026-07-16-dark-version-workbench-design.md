# Dark Version Workbench Design

## Goal

Replace the plain white article-version floating panel with a larger, denser
dark professional workbench that remains easy to drag and minimize.

## Layout

- The panel is 360 px wide in its expanded state and uses a charcoal surface,
  a distinct dark title bar, and a compact blue accent.
- The draggable title bar shows the title and development label on the left;
  its circular icon-only collapse control is on the right.
- Bridge connection is a compact green status badge. Refresh is a secondary
  action rather than a full-width primary block.
- Each retained version is a compact list row: version tag, title, timestamp,
  state badge, and an explicit apply action. The applied version receives a
  strong active treatment and `当前` label.
- Result/error text is a concise footer notice.

## Interaction and Accessibility

- Existing title-bar drag, viewport clamping, persisted position, and collapse
  behavior remain unchanged.
- The collapse control stays a native button with a tooltip and accessible
  label. Version application remains explicit.

## Verification

- Preserve all existing userscript tests.
- Run TypeScript checking and the production userscript build.
