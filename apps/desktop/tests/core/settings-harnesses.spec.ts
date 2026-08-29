import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  desktopShortcut,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
} from "../helpers/electron-app";

test("keeps Pi available and hides the fx thread option when fx is unavailable", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("settings-unavailable-fx-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await openNewThread(window);
    await expect(window.getByRole("button", { name: "Use Pi harness for new thread" })).toBeVisible();
    await expect(window.getByRole("button", { name: "Use fx harness for new thread" })).toHaveCount(0);

    await window.keyboard.press(desktopShortcut(","));
    const settings = window.getByTestId("harness-settings");
    await expect(settings).toBeVisible();
    await expect(settings.getByText("Unavailable", { exact: true })).toBeVisible();
    await expect(settings.getByText(/Pi remains available|Pi 可正常使用|Pi 仍可正常使用/)).toBeVisible();
    await expect(settings.getByRole("button", { name: "Connect in browser" }).first()).toBeDisabled();
  } finally {
    await harness.close();
  }
});

test("shows Pi, fx, and DeepSeek Harness configuration on one settings page", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("settings-harnesses-workspace");
  const fxSettingsPath = join(userDataDir, "fx-settings.json");
  const fxBinaryPath = join(userDataDir, "fake-fx.mjs");
  const fxStatePath = join(userDataDir, "fake-fx-state.json");
  const fxLogPath = join(userDataDir, "fake-fx.log");
  await writeFile(
    fxSettingsPath,
    `${JSON.stringify({ provider: "codex", models: { codex: "gpt-5.6-sol" } })}\n`,
    "utf8",
  );
  await writeFile(fxStatePath, JSON.stringify({ active: "codex", connected: ["codex"] }), "utf8");
  await writeFile(
    fxBinaryPath,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const statePath = ${JSON.stringify(fxStatePath)};
const logPath = ${JSON.stringify(fxLogPath)};
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(statePath, "utf8"));
appendFileSync(logPath, args.join(" ") + "\\n");
if (args[0] === "status") {
  const source = state.active === "codex" ? "Codex subscription" : state.active === "grok" ? "Grok subscription" : "Vercel AI Gateway";
  console.log(JSON.stringify({ kind: "status", model: state.active === "codex" ? "gpt-5.6-sol" : "grok-4", model_source: source, auth: source, connected_providers: state.connected.map((item) => item === "vercel" ? "vercel-ai-gateway" : item) }));
} else if (args[0] === "models") {
  console.log(JSON.stringify({ kind: "models", ids: state.active === "codex" ? ["gpt-5.6-sol", "gpt-5.6-terra"] : ["grok-4"] }));
} else if (args[0] === "login") {
  const provider = args[1] ?? "vercel";
  state.active = provider;
  if (!state.connected.includes(provider)) state.connected.push(provider);
  writeFileSync(statePath, JSON.stringify(state));
} else if (args[0] === "provider") {
  state.active = args[1] === "gateway" ? "vercel" : args[1];
  writeFileSync(statePath, JSON.stringify(state));
}
`,
    "utf8",
  );
  await chmod(fxBinaryPath, 0o755);
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: {
      PI_FX_BINARY: fxBinaryPath,
      PI_FX_ENABLED: "1",
      PI_FX_SETTINGS_PATH: fxSettingsPath,
    },
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));

    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await expect(window.locator(".view-header__title")).toHaveText("Harnesses");
    const settings = window.getByTestId("harness-settings");
    await expect(settings).toBeVisible();
    await expect(settings.locator(".settings-section__title")).toHaveText([
      "Pi",
      "fx",
      "DeepSeek Harness",
    ]);
    await expect(settings.getByLabel("Pi default model")).toBeVisible();
    await expect(settings.getByText("codex", { exact: true })).toBeVisible();
    await expect(settings.getByText("gpt-5.6-sol", { exact: true })).toBeVisible();
    await expect(settings.getByText("http://127.0.0.1:3080/", { exact: true })).toBeVisible();

    const codexCard = settings.locator(".fx-provider-card").filter({ hasText: "OpenAI Codex" });
    const grokCard = settings.locator(".fx-provider-card").filter({ hasText: "xAI Grok" });
    await expect(codexCard).toContainText("Active");
    await grokCard.getByRole("button", { name: "Connect in browser" }).click();
    await expect(grokCard).toContainText("Connected", { timeout: 15_000 });
    await expect(codexCard).toContainText("Active");
    await expect.poll(async () => readFile(fxLogPath, "utf8")).toContain("login grok\nprovider codex");
  } finally {
    await harness.close();
  }
});
