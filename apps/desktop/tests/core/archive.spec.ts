import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("archives a hovered thread into a restorable sidebar section", async () => {
  const userDataDir = await makeUserDataDir("pi-app-user-data-");
  const workspacePath = await makeWorkspace("archive-sidebar-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Thread one");
    await createNamedThread(window, "Thread two");
    await expect(window.locator(".topbar__session")).toHaveText("Thread two");

    const activeRow = window.locator(".session-list > .session-row").filter({ hasText: "Thread two" }).first();
    const archiveButton = activeRow.locator(".session-row__action");
    const timeLabel = activeRow.locator(".session-row__time");

    await expect(archiveButton).toHaveCSS("opacity", "0");
    await expect(timeLabel).toHaveCSS("opacity", "1");

    await activeRow.hover();
    await archiveButton.click();
    await expect(window.locator(".topbar__session")).toHaveText("Thread one");
    const archivedGroup = window.locator(".archived-thread-group");
    const archivedToggle = archivedGroup.locator(".archived-thread-group__toggle");
    await expect(archivedGroup).toContainText("Archived");
    await expect(archivedToggle).toHaveAttribute("aria-expanded", "false");
    await expect(window.locator(".session-list--archived")).toHaveCount(0);

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((session) => session.title === "Thread two")?.archivedAt ?? "";
      })
      .not.toBe("");

    await archivedToggle.click();
    await expect(archivedToggle).toHaveAttribute("aria-expanded", "true");
    await expect(window.locator(".session-list--archived")).toContainText("Thread two");

    const archivedRow = window.locator(".session-list--archived .session-row").filter({ hasText: "Thread two" }).first();
    const restoreButton = archivedRow.locator(".session-row__action");
    await archivedRow.hover();
    await restoreButton.click();

    await expect(window.locator(".session-list > .session-row").filter({ hasText: "Thread two" })).toHaveCount(1);
    await expect(window.locator(".archived-thread-group")).toHaveCount(0);

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((session) => session.title === "Thread two")?.archivedAt ?? "";
      })
      .toBe("");
  } finally {
    await harness.close();
  }
});

test("archiving the only visible thread keeps the app on a usable surface", async () => {
  const userDataDir = await makeUserDataDir("pi-app-user-data-");
  const workspacePath = await makeWorkspace("archive-last-thread-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Only thread");

    const activeRow = window.locator(".session-list > .session-row").filter({ hasText: "Only thread" }).first();
    await activeRow.hover();
    await activeRow.locator(".session-row__action").click();

    await expect(window.getByTestId("new-thread-composer")).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => window.locator("#root").evaluate((root) => root.children.length))
      .toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return {
          activeView: state.activeView,
          selectedSessionId: state.selectedSessionId,
        };
      })
      .toEqual({
        activeView: "new-thread",
        selectedSessionId: "",
      });
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces[0]?.sessions.find((session) => session.title === "Only thread")?.archivedAt ?? "";
      })
      .not.toBe("");
  } finally {
    await harness.close();
  }
});
