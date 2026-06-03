import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("opens the Open Design workspace from the sidebar", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("open-design-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await expect(window.getByTestId("workspace-list")).toContainText(basename(workspacePath));

    await window.getByRole("button", { name: "Open Design" }).click();

    await expect(window.getByRole("heading", { name: "Open Design" })).toBeVisible();
    await expect(window.getByText("Run the Open Design 0.9 environment inside Pi GUI.")).toBeVisible();
    await expect(window.getByRole("button", { name: "Start Open Design" })).toBeVisible();
  } finally {
    await harness.close();
  }
});
