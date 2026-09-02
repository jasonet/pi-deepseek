# Sidebar Window Drag Region Design

## Goal

Make the empty macOS titlebar area above the desktop app's left sidebar draggable, matching the existing draggable topbar on the right side.

## Behavior

- The empty strip at the top of the expanded sidebar moves the application window when dragged.
- The strip uses Electron's native `-webkit-app-region: drag` behavior.
- Double-clicking the strip maximizes or restores the window, matching the main topbar.
- Interactive sidebar content remains clickable and retains its existing drag-and-drop behavior.
- Session and workspace reordering must not initiate window movement.
- When the sidebar is collapsed, the existing main topbar remains the only relevant drag surface.

## Implementation

Add a dedicated semantic drag-region element as the first child of the sidebar. It occupies only the existing empty titlebar space above sidebar controls. It does not overlay the navigation, workspace list, session rows, footer, or any other interactive content.

Pass a window-toggle callback into `Sidebar`, backed by the existing `api.toggleWindowMaximize()` API. Keep the callback scoped to double-click behavior on the dedicated region.

The dedicated region receives `-webkit-app-region: drag`. Existing controls and sortable rows remain outside this element, so their pointer events and dnd-kit handlers are unaffected. Explicit `no-drag` rules on interactive elements remain in place as a defensive boundary.

## Layout

The sidebar currently creates its titlebar clearance with top padding on `.sidebar__top`. Replace that implicit empty padding with an explicit fixed-height drag strip while preserving the same total vertical spacing and visual appearance.

## Verification

- Drag from the left titlebar strip and confirm the real Electron window moves.
- Double-click the strip and confirm maximize/restore.
- Click sidebar navigation and workspace controls.
- Drag a session to reorder it and confirm no window movement occurs.
- Collapse and reopen the sidebar and confirm the main topbar and sidebar toggle remain functional.
- Run desktop typecheck and the targeted Electron test for the native drag-region boundary where feasible.
