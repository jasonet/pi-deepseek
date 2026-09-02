# Sidebar Window Drag Region Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the empty titlebar strip above the expanded sidebar move the Electron window without interfering with clickable controls or sortable sessions/workspaces.

**Architecture:** Add one explicit, layout-owned drag strip as the first child of `Sidebar`, rather than marking the sidebar or overlaying its content. Give only that strip Electron's native drag region and use the existing window maximize API for double-click parity with `Topbar`; all dnd-kit content stays in a separate grid row.

**Tech Stack:** React 19, TypeScript, CSS, Electron `-webkit-app-region`, Playwright Electron tests, dnd-kit.

## Global Constraints

- The window drag surface is limited to the currently empty strip at the top of the expanded sidebar.
- Sidebar controls, workspace rows, session rows, scrolling, and dnd-kit reordering must remain outside the native drag region.
- Double-clicking the left strip must use the existing `PiDesktopApi.toggleWindowMaximize(): Promise<void>` behavior.
- Do not add broad Node or Electron exposure to the renderer.
- Verify behavior on the real Electron surface, not only with typecheck.

---

## File Structure

- Modify `apps/desktop/src/sidebar.tsx`: render the dedicated drag strip and handle double-click maximize through the existing API.
- Modify `apps/desktop/src/styles/sidebar.css`: allocate a separate titlebar grid row and mark only the strip as draggable while preserving current spacing.
- Modify `apps/desktop/tests/core/sidebar-toggle.spec.ts`: assert the strip occupies only the titlebar area and interactive/dnd elements are outside it.

### Task 1: Add the Isolated Sidebar Drag Strip

**Files:**
- Modify: `apps/desktop/src/sidebar.tsx:66-105, rendered aside root`
- Modify: `apps/desktop/src/styles/sidebar.css:14-43`
- Test: `apps/desktop/tests/core/sidebar-toggle.spec.ts`

**Interfaces:**
- Consumes: existing `SidebarProps.api: PiDesktopApi` and `PiDesktopApi.toggleWindowMaximize(): Promise<void>`.
- Produces: DOM element `[data-testid="sidebar-drag-region"]` with class `.sidebar__drag-region`, native drag behavior, and double-click maximize/restore.

- [ ] **Step 1: Add a failing Electron layout-boundary test**

In `apps/desktop/tests/core/sidebar-toggle.spec.ts`, add this test after the helper functions:

```ts
test("keeps the sidebar window drag region isolated above sortable content", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("sidebar-drag-region-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    const sidebar = window.locator(".sidebar");
    const dragRegion = window.getByTestId("sidebar-drag-region");
    const sidebarTop = window.locator(".sidebar__top");
    const workspaceList = window.getByTestId("workspace-list");

    await expect(dragRegion).toBeVisible();
    await expect(workspaceList).toBeVisible();

    const [sidebarBox, dragBox, topBox, listBox, dragStyles] = await Promise.all([
      sidebar.boundingBox(),
      dragRegion.boundingBox(),
      sidebarTop.boundingBox(),
      workspaceList.boundingBox(),
      dragRegion.evaluate((element) => ({
        appRegion: getComputedStyle(element).getPropertyValue("-webkit-app-region"),
        pointerEvents: getComputedStyle(element).pointerEvents,
      })),
    ]);

    expect(sidebarBox).not.toBeNull();
    expect(dragBox).not.toBeNull();
    expect(topBox).not.toBeNull();
    expect(listBox).not.toBeNull();
    expect(dragBox?.x).toBe(sidebarBox?.x);
    expect(dragBox?.width).toBe(sidebarBox?.width);
    expect(dragBox?.y).toBe(sidebarBox?.y);
    expect((dragBox?.y ?? 0) + (dragBox?.height ?? 0)).toBeLessThanOrEqual(topBox?.y ?? 0);
    expect((dragBox?.y ?? 0) + (dragBox?.height ?? 0)).toBeLessThanOrEqual(listBox?.y ?? 0);
    expect(dragStyles.appRegion).toBe("drag");
    expect(dragStyles.pointerEvents).not.toBe("none");
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
pnpm --dir apps/desktop run test:e2e:runner -- tests/core/sidebar-toggle.spec.ts --grep "sidebar window drag region"
```

Expected: FAIL because `[data-testid="sidebar-drag-region"]` does not exist.

- [ ] **Step 3: Render the dedicated drag strip**

In `apps/desktop/src/sidebar.tsx`, place this as the first child inside the root `<aside className="sidebar">`:

```tsx
<div
  aria-hidden="true"
  className="sidebar__drag-region"
  data-testid="sidebar-drag-region"
  onDoubleClick={() => void api.toggleWindowMaximize()}
/>
```

Do not wrap `.sidebar__top`, the workspace list, `DndContext`, `SortableContext`, `DragOverlay`, session rows, or footer in this element.

- [ ] **Step 4: Allocate an explicit non-overlapping layout row**

In `apps/desktop/src/styles/sidebar.css`, change the sidebar grid and title spacing to:

```css
.sidebar {
  display: grid;
  grid-template-rows: 40px auto 1fr auto;
  overflow: hidden;
  background: var(--sidebar);
  border-right: 1px solid var(--line);
}

.sidebar__drag-region {
  width: 100%;
  min-width: 0;
  -webkit-app-region: drag;
  user-select: none;
}

.sidebar__top {
  padding-top: 14px;
}
```

Keep the shared `.sidebar__top, .sidebar__section, .sidebar__footer { padding: 14px 16px; }` declaration unchanged. This preserves the existing total top clearance (`40px + 14px = 54px`) while ensuring no drag element overlaps interactive content.

- [ ] **Step 5: Run typecheck and the targeted Electron test**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
pnpm --dir apps/desktop run test:e2e:runner -- tests/core/sidebar-toggle.spec.ts --grep "sidebar window drag region"
```

Expected: Typecheck exits 0; targeted test passes.

- [ ] **Step 6: Commit the isolated drag strip**

```bash
git add apps/desktop/src/sidebar.tsx apps/desktop/src/styles/sidebar.css apps/desktop/tests/core/sidebar-toggle.spec.ts
git commit -m "feat: add draggable sidebar titlebar region"
```

### Task 2: Verify Native Window Drag and Sidebar Reordering

**Files:**
- Verify: `apps/desktop/src/sidebar.tsx`
- Verify: `apps/desktop/src/styles/sidebar.css`
- Verify: `apps/desktop/tests/core/sidebar-toggle.spec.ts`

**Interfaces:**
- Consumes: `[data-testid="sidebar-drag-region"]`, native Electron drag region, existing sidebar dnd-kit behavior.
- Produces: verification evidence that native window movement and in-sidebar sorting remain independent.

- [ ] **Step 1: Run the complete owning core spec**

Run:

```bash
pnpm --dir apps/desktop run test:e2e:runner -- tests/core/sidebar-toggle.spec.ts
```

Expected: All tests in `sidebar-toggle.spec.ts` pass, including sidebar collapse/persistence and drag-region isolation.

- [ ] **Step 2: Launch the real Electron development surface**

Run:

```bash
pnpm --dir apps/desktop dev
```

Expected: The Taosi Electron window opens with the sidebar expanded.

- [ ] **Step 3: Verify native movement and maximize behavior manually**

On the real Electron window:

1. Press and drag in the empty strip above the sidebar controls; confirm the whole window moves.
2. Double-click the same strip; confirm the window maximizes or restores.
3. Drag the right topbar; confirm its existing movement behavior still works.

Expected: Both titlebar surfaces move the same window, and double-click behavior matches.

- [ ] **Step 4: Verify interactive boundaries manually**

On the same surface:

1. Click New Thread and confirm it opens normally.
2. Collapse and expand a workspace.
3. Scroll the session list.
4. Drag a workspace to reorder it when at least two workspaces exist.
5. Drag a session using the existing session sorting behavior when applicable.
6. Confirm none of those actions move the window.

Expected: Sidebar interactions and dnd-kit sorting work normally; only the empty titlebar strip moves the window.

- [ ] **Step 5: Run final static verification**

Run:

```bash
pnpm --filter @pi-gui/desktop typecheck
pnpm --dir apps/desktop run build
```

Expected: Both commands exit 0. Existing Vite browser-externalization warnings are acceptable; new errors are not.

- [ ] **Step 6: Record verification without an extra code commit**

If Task 1 already contains the complete implementation and no verification-driven corrections were needed, do not create an empty commit. If corrections were required, commit only those focused corrections:

```bash
git add apps/desktop/src/sidebar.tsx apps/desktop/src/styles/sidebar.css apps/desktop/tests/core/sidebar-toggle.spec.ts
git commit -m "fix: preserve sidebar sorting outside window drag region"
```
