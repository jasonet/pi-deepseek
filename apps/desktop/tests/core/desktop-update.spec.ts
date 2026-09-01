import { expect, test } from "@playwright/test";
import {
  emitTestUpdateStatus,
  getUpdateInstallRequestCount,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("downloads an available update with progress and prompts to restart", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("desktop-update-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await emitTestUpdateStatus(harness, {
      phase: "available",
      currentVersion: "2.9.1",
      latestVersion: "2.9.2",
    });

    const banner = window.getByTestId("update-status");
    await expect(banner).toContainText("Version 2.9.2 is available");
    await window.getByRole("button", { name: "Upgrade", exact: true }).click();
    await expect(window.getByRole("progressbar", { name: "Update download progress" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );

    await emitTestUpdateStatus(harness, {
      phase: "downloading",
      currentVersion: "2.9.1",
      latestVersion: "2.9.2",
      percent: 48.4,
      transferred: 48_400_000,
      total: 100_000_000,
      bytesPerSecond: 2_000_000,
    });
    await expect(banner).toContainText("48%");

    await emitTestUpdateStatus(harness, {
      phase: "ready",
      currentVersion: "2.9.1",
      latestVersion: "2.9.2",
      percent: 100,
    });
    await expect(banner).toContainText("Restart Taosi to apply the update");
    await window.getByRole("button", { name: "Restart now", exact: true }).click();
    await expect.poll(() => getUpdateInstallRequestCount(harness)).toBe(1);
  } finally {
    await harness.close();
  }
});
