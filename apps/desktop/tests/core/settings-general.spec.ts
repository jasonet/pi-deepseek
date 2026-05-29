import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("toggles and boots with multiple app instances allowed", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("allow-multiple-instances");
  const firstHarness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  let secondHarness: Awaited<ReturnType<typeof launchDesktop>> | undefined;

  try {
    const firstWindow = await firstHarness.firstWindow();
    await waitForWorkspaceByPath(firstWindow, workspacePath);

    await firstWindow.keyboard.press(desktopShortcut(","));
    await expect(firstWindow.getByTestId("settings-surface")).toBeVisible();
    await firstWindow.getByRole("button", { name: "General", exact: true }).click();

    const allowMultipleToggle = firstWindow.getByLabel("Allow multiple app instances");
    await expect(allowMultipleToggle).not.toBeChecked();
    await allowMultipleToggle.click();
    await expect.poll(async () => (await getDesktopState(firstWindow)).allowMultiple).toBe(true);
    await expect(allowMultipleToggle).toBeChecked();
    await expect
      .poll(async () => {
        const persisted = JSON.parse(await readFile(join(userDataDir, "ui-state.json"), "utf8")) as {
          readonly allowMultiple?: unknown;
        };
        return persisted.allowMultiple;
      })
      .toBe(true);

    secondHarness = await launchDesktop(userDataDir, {
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });
    const secondWindow = await secondHarness.firstWindow();
    await waitForWorkspaceByPath(secondWindow, workspacePath);
    await expect.poll(async () => (await getDesktopState(secondWindow)).allowMultiple).toBe(true);
  } finally {
    await secondHarness?.close();
    await firstHarness.close();
  }
});
