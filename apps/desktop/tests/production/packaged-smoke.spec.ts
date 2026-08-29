import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchPackagedDesktop,
  makeUserDataDir,
  makeWorkspace,
  resolvePackagedAppBundle,
  resolvePackagedAppExecutable,
} from "../helpers/electron-app";
import { assertPackagedAppCanStartThread } from "./packaged-smoke-assertions";

test("launches the packaged app bundle and starts a thread through the real UI", async () => {
  test.setTimeout(120_000);

  const userDataDir = await makeUserDataDir("pi-gui-packaged-user-data-");
  const workspacePath = await makeWorkspace("packaged-smoke-workspace");
  const promptText = "Packaged smoke thread";
  const appBundlePath = await resolvePackagedAppBundle();
  const updateConfig = await readFile(join(appBundlePath, "Contents", "Resources", "app-update.yml"), "utf8");
  expect(updateConfig).toContain("provider: github");
  expect(updateConfig).toContain("owner: jasonet");
  expect(updateConfig).toContain("repo: pi-deepseek");
  const expectedExecutablePath = await resolvePackagedAppExecutable();
  const harness = await launchPackagedDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await assertPackagedAppCanStartThread(harness, window, {
      expectedExecutablePath,
      promptText,
      workspacePath,
    });
  } finally {
    await harness.close();
  }
});
