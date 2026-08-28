import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";

test("OpenRouter enabled-model editor supports none, all, and smart selection", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("openrouter-model-selection");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false, enabledModels: [] });
  await writeFile(
    join(agentDir, "auth.json"),
    `${JSON.stringify({ openrouter: { type: "api_key", key: "test-openrouter-key" } }, null, 2)}\n`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "Models", exact: true }).click();
    const disclosure = window.locator(".settings-disclosure", {
      has: window.locator(".settings-disclosure__summary", { hasText: "Edit enabled models" }),
    }).first();
    await disclosure.locator(".settings-disclosure__summary").click();

    const actions = window.getByRole("group", { name: "OpenRouter model selection" });
    await expect(actions).toBeVisible();
    const openRouterRows = disclosure.locator("label.settings-toggle", { hasText: "OpenRouter" });
    const modelCheckboxes = openRouterRows.locator('input[type="checkbox"]');
    const checkedModelCheckboxes = openRouterRows.locator('input[type="checkbox"]:checked');
    const modelCount = await modelCheckboxes.count();
    expect(modelCount).toBeGreaterThan(100);

    await actions.getByRole("button", { name: "Select none", exact: true }).click();
    await expect(checkedModelCheckboxes).toHaveCount(0);
    const workspaceId = (await getDesktopState(window)).selectedWorkspaceId;
    await window.evaluate(async (targetWorkspaceId) => {
      await window.piApp?.refreshRuntime(targetWorkspaceId);
    }, workspaceId);
    await expect(checkedModelCheckboxes).toHaveCount(0);

    await actions.getByRole("button", { name: "Smart select", exact: true }).click();
    await expect.poll(async () => checkedModelCheckboxes.count()).toBeGreaterThan(0);
    const smartCount = await checkedModelCheckboxes.count();
    expect(smartCount).toBeLessThan(modelCount);

    await actions.getByRole("button", { name: "Select all", exact: true }).click();
    await expect(checkedModelCheckboxes).toHaveCount(modelCount);
  } finally {
    await harness.close();
  }
});
