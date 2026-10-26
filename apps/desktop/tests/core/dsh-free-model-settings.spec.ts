import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { desktopShortcut, launchDesktop, launchDesktopByExecutable, makeUserDataDir } from "../helpers/electron-app";

test("fresh Electron settings can enable and disable the managed free-model bundle", async () => {
  test.setTimeout(60_000);
  const root = await makeUserDataDir("taosi-free-model-ui-");
  const dshHome = join(root, "dsh");
  const options = {
    testMode: "background", scrubProviderEnv: true,
    envOverrides: { DSH_HOME: dshHome, PI_APP_DSH_WEB_URL: "" },
  } as const;
  const app = process.env.PI_APP_DSH_SMOKE_EXECUTABLE
    ? await launchDesktopByExecutable(process.env.PI_APP_DSH_SMOKE_EXECUTABLE, root, options)
    : await launchDesktop(root, options);
  try {
    const window = await app.firstWindow();
    const errors: string[] = [];
    window.on("pageerror", (error) => errors.push(error.message));
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "DeepSeek Harness" }).click();
    const settings = window.getByTestId("dsh-settings-section");
    await expect(settings).toBeVisible();
    await expect(settings.getByText("Ready to install")).toBeVisible();
    const toggle = settings.getByRole("checkbox", { name: "Enable third-party models" });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(settings.getByText("Third-party free route", { exact: true })).toBeVisible();
    await settings.getByRole("radio", { name: "Free priority" }).click();
    await expect(settings.getByRole("radio", { name: "Free priority" })).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    const profile = join(dshHome, "profiles", "taosi-harness");
    const pkg = JSON.parse(await readFile(join(profile, "package.json"), "utf8"));
    expect(pkg.dsh.profile.bundles).not.toContain("dsh-our-free-model");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
