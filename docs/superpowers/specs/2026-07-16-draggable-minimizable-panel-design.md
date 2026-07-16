# Draggable and Minimizable Panel Design

## Goal

Keep the manual article-version panel available without permanently obscuring
the kintone page.

## Interaction

- Dragging starts only from the panel title bar; panel controls and version rows
  retain their normal click behavior.
- A title-bar `—` button collapses the panel to its title and an expand button.
- The panel position is clamped within the visible browser viewport when it is
  moved or restored.
- The last position and collapsed state are saved through Tampermonkey storage
  and restored on page reload.

## Boundaries

The feature does not alter Bridge discovery, version retrieval, article
application, or native kintone editor behavior.

## Verification

- Unit-test the pure viewport-clamping helper.
- Run the userscript test suite and production build.
