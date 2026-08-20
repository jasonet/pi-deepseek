import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { PiDesktopApi } from "../../src/ipc";
import { launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

test("configures Treg without exposing its login token to the renderer", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("treg-settings-workspace");
  const policyPath = path.join(userDataDir, "agent", "treg.json");
  const tregConfigPath = path.join(userDataDir, "treg", "config.json");
  const secret = "treg-renderer-secret-sentinel";
  await mkdir(path.dirname(tregConfigPath), { recursive: true });
  await writeFile(tregConfigPath, JSON.stringify({ token: secret, active_org: "test" }), "utf8");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: {
      PI_TREG_POLICY_PATH: policyPath,
      TREG_CONFIG: tregConfigPath,
    },
  });

  try {
    const window = await harness.firstWindow();
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await window.getByRole("button", { name: "External tools", exact: true }).click();

    await expect(window.getByRole("checkbox", { name: "Enable Treg" })).not.toBeChecked();
    await expect(window.locator(".settings-view")).toContainText("Login detected");
    await expect(window.locator("body")).not.toContainText(secret);

    const workspaceToggle = window.getByRole("checkbox", { name: path.basename(workspacePath) });
    await workspaceToggle.check();
    await window.getByLabel("Endpoint calls").selectOption("disabled");
    await window.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(window.getByRole("status")).toContainText("Treg settings saved");

    const policy = JSON.parse(await readFile(policyPath, "utf8"));
    expect(policy.workspaceRoots).toEqual([workspacePath]);
    expect(policy.paidCalls).toBe("disabled");
    expect(JSON.stringify(policy)).not.toContain(secret);

    const rendererStatus = await window.evaluate(async () => {
      const api = (window as Window & { piApp?: PiDesktopApi }).piApp;
      return api?.getTregStatus();
    });
    expect(JSON.stringify(rendererStatus)).not.toContain(secret);
  } finally {
    await harness.close();
  }
});
