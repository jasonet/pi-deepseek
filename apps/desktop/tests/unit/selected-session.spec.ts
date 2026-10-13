import { expect, test } from "@playwright/test";
import { getSelectedSession, type DesktopAppState, createEmptyDesktopAppState } from "../../src/desktop-state";
import { computeDualPanePartner } from "../../src/dual-pane-rotation";

test.describe("Selected session resolution and dual-pane isolation for archived sessions", () => {
  const baseState = createEmptyDesktopAppState();

  const workspaceWithArchived = {
    id: "ws-1",
    name: "Workspace 1",
    path: "/path/to/ws1",
    lastOpenedAt: "2026-09-18T10:00:00Z",
    kind: "primary" as const,
    sessions: [
      {
        backendId: "pi" as const,
        id: "session-active-1",
        title: "Active Session 1",
        updatedAt: "2026-09-18T12:00:00Z",
        preview: "Hello",
        status: "idle" as const,
        hasUnseenUpdate: false,
      },
      {
        backendId: "pi" as const,
        id: "session-active-2",
        title: "Active Session 2",
        updatedAt: "2026-09-18T11:00:00Z",
        preview: "World",
        status: "idle" as const,
        hasUnseenUpdate: false,
      },
      {
        backendId: "pi" as const,
        id: "session-archived-1",
        title: "Archived Session 1",
        updatedAt: "2026-09-18T09:00:00Z",
        archivedAt: "2026-09-18T10:00:00Z",
        preview: "Old work",
        status: "idle" as const,
        hasUnseenUpdate: false,
      },
    ],
  };

  test("getSelectedSession returns active session when selectedSessionId matches active session", () => {
    const state: DesktopAppState = {
      ...baseState,
      selectedWorkspaceId: "ws-1",
      selectedSessionId: "session-active-1",
      workspaces: [workspaceWithArchived],
    };

    const selected = getSelectedSession(state);
    expect(selected?.id).toBe("session-active-1");
    expect(selected?.archivedAt).toBeUndefined();
  });

  test("getSelectedSession correctly returns archived session when selectedSessionId is an archived session", () => {
    const state: DesktopAppState = {
      ...baseState,
      selectedWorkspaceId: "ws-1",
      selectedSessionId: "session-archived-1",
      workspaces: [workspaceWithArchived],
    };

    const selected = getSelectedSession(state);
    expect(selected).toBeDefined();
    expect(selected?.id).toBe("session-archived-1");
    expect(selected?.archivedAt).toBe("2026-09-18T10:00:00Z");
  });

  test("when archived session is selected, dual-pane partner is strictly undefined", () => {
    const state: DesktopAppState = {
      ...baseState,
      selectedWorkspaceId: "ws-1",
      selectedSessionId: "session-archived-1",
      workspaces: [workspaceWithArchived],
    };

    const selected = getSelectedSession(state);
    expect(selected).toBeDefined();

    const partner = computeDualPanePartner(selected, workspaceWithArchived.sessions);
    expect(partner).toBeUndefined();
  });

  test("when active session is selected in the same workspace, dual-pane partner is computed normally", () => {
    const state: DesktopAppState = {
      ...baseState,
      selectedWorkspaceId: "ws-1",
      selectedSessionId: "session-active-1",
      workspaces: [workspaceWithArchived],
    };

    const selected = getSelectedSession(state);
    expect(selected).toBeDefined();

    const partner = computeDualPanePartner(selected, workspaceWithArchived.sessions);
    expect(partner?.id).toBe("session-active-2");
  });
});
