import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { readFxDefaultModelSelection } from "../../electron/fx-acp-driver";
import { makeUserDataDir } from "../helpers/electron-app";

test("reads the provider-specific default model from fx settings", async () => {
  const dir = await makeUserDataDir("pi-gui-fx-config-");
  const settingsPath = join(dir, "settings.json");
  await writeFile(
    settingsPath,
    `${JSON.stringify({ provider: "codex", codex_model: "gpt-5.6-sol" })}\n`,
    "utf8",
  );

  await expect(readFxDefaultModelSelection(settingsPath)).resolves.toEqual({
    provider: "codex",
    modelId: "gpt-5.6-sol",
  });
});

test("reads the current nested fx model preference format", async () => {
  const dir = await makeUserDataDir("pi-gui-fx-config-current-");
  const settingsPath = join(dir, "settings.json");
  await writeFile(
    settingsPath,
    `${JSON.stringify({ provider: "grok", models: { codex: "gpt-5.6-sol", grok: "grok-4" } })}\n`,
    "utf8",
  );

  await expect(readFxDefaultModelSelection(settingsPath)).resolves.toEqual({
    provider: "grok",
    modelId: "grok-4",
  });
});
