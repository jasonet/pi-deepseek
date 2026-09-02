import { expect, test } from "@playwright/test";
import {
  createSessionViaIpc,
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSession,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("session shortcuts cycle only through sessions in expanded workspace groups", async () => {
  const userDataDir = await makeUserDataDir();
  const firstWorkspacePath = await makeWorkspace("shortcut-visible-first");
  const secondWorkspacePath = await makeWorkspace("shortcut-visible-second");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [firstWorkspacePath, secondWorkspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, firstWorkspacePath);
    await waitForWorkspaceByPath(window, secondWorkspacePath);
    await createSessionViaIpc(window, firstWorkspacePath, "Visible session A");
    await createSessionViaIpc(window, secondWorkspacePath, "Hidden session B");
    await createSessionViaIpc(window, secondWorkspacePath, "Hidden session C");

    const state = await getDesktopState(window);
    const secondWorkspace = state.workspaces.find((workspace) => workspace.path === secondWorkspacePath);
    expect(secondWorkspace).toBeTruthy();
    const secondGroup = window.locator(".workspace-group", { hasText: secondWorkspace!.name });
    await secondGroup.locator(".workspace-row__select").click();
    await expect(secondGroup.locator(".session-row__select")).toHaveCount(0);

    await selectSession(window, "Visible session A");
    await window.keyboard.press(desktopShortcut("Tab"));
    await expect(window.locator(".topbar__session")).toHaveText("Visible session A");

    await window.keyboard.press(desktopShortcut("Shift+Tab"));
    await expect(window.locator(".topbar__session")).toHaveText("Visible session A");
  } finally {
    await harness.close();
  }
});

test("sidebar hides the connect phone entry", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("hidden-connect-phone-entry");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await expect(window.getByRole("button", { name: "连接手机", exact: true })).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
