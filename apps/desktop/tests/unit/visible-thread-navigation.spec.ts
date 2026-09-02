import { expect, test } from "@playwright/test";
import { getVisibleThreadNavigationEntries, type ThreadGroup } from "../../src/thread-groups";
import type { SessionRecord, WorkspaceRecord } from "../../src/desktop-state";

function session(id: string, archived = false): SessionRecord {
  return {
    id,
    title: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "idle",
    backendId: "pi",
    ...(archived ? { archivedAt: "2026-01-02T00:00:00.000Z" } : {}),
  } as SessionRecord;
}

function workspace(id: string): WorkspaceRecord {
  return { id, name: id, path: `/tmp/${id}`, kind: "primary", sessions: [] } as WorkspaceRecord;
}

function group(id: string, sessionIds: readonly string[]): ThreadGroup {
  const rootWorkspace = workspace(id);
  return {
    rootWorkspace,
    threads: sessionIds.map((sessionId) => ({
      workspaceId: id,
      session: session(sessionId),
      environment: { kind: "local", label: "Local" },
    })),
    archivedThreads: [],
  };
}

test("session shortcut navigation includes only sessions in expanded workspace groups", () => {
  const entries = getVisibleThreadNavigationEntries(
    [group("expanded", ["first", "second"]), group("collapsed", ["hidden"])],
    { collapsed: true },
  );

  expect(entries.map((entry) => entry.session.id)).toEqual(["first", "second"]);
});
