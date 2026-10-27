import { mkdir, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, launchDesktopByExecutable, makeUserDataDir } from "../helpers/electron-app";

test("installs and embeds isolated Trading, prepares a draft and opens native configuration", async ({}, testInfo) => {
  test.skip(process.env.PI_TRADING_SMOKE !== "1", "Opt in to the network-dependent Trading first-install smoke");
  test.setTimeout(35 * 60_000);
  const home = process.env.PI_TRADING_SMOKE_HOME || await makeUserDataDir("taosi-trading-smoke-");
  await mkdir(home, { recursive: true });
  if (process.env.PI_TRADING_SMOKE_RUNTIME_SOURCE) {
    for (const directory of ["harness", "trading-runtime"]) {
      await symlink(join(process.env.PI_TRADING_SMOKE_RUNTIME_SOURCE, directory), join(home, directory), "dir");
    }
  }
  const options = { testMode: "background" as const, scrubProviderEnv: true };
  const harness = process.env.PI_TRADING_SMOKE_EXECUTABLE
    ? await launchDesktopByExecutable(process.env.PI_TRADING_SMOKE_EXECUTABLE, home, options)
    : await launchDesktop(home, options);
  const page = await harness.firstWindow();
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  console.log(`Trading smoke data: ${home}`);
  try {
    await page.getByTestId("open-dsh-trading").click();
    await expect(page.getByRole("button", { name: "Trading 配置", exact: true })).toBeVisible();
    await page.locator('[data-testid="dsh-trading-error"], [data-testid="dsh-trading-surface"]').waitFor({ timeout: 30 * 60_000 });
    const failure = page.getByTestId("dsh-trading-error");
    if (await failure.isVisible()) throw new Error(await failure.innerText());
    await expect(page.getByRole("button", { name: "新建分析案例", exact: true })).toBeEnabled({ timeout: 60_000 });
    const frame = page.frameLocator('[data-testid="dsh-trading-frame"]');
    const preview = frame.getByRole("button", { name: /^(Continue|继续)$/ });
    if (await preview.isVisible()) await preview.click();
    if (process.env.PI_TRADING_SMOKE_REUSE === "1") await page.getByRole("button", { name: "新建分析案例", exact: true }).click();
    const composer = frame.locator('textarea, [contenteditable="true"]').first();
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => composer.evaluate((element) => (element as HTMLTextAreaElement).value ?? element.textContent), { timeout: 30_000 }).toContain("仅做分析");
    await expect.poll(async () => JSON.parse(await readFile(join(home, "dsh-trading/taosi-preferences.json"), "utf8")).examplePrepared).toBe(true);
    if (process.env.PI_TRADING_SMOKE_RUNTIME_SOURCE) {
      const workspace = await readFile(join(home, "dsh-trading/storages/workspace.json"), "utf8");
      expect(workspace).toContain(join(home, "dsh-trading/research"));
      const migration = JSON.parse(await readFile(join(home, "dsh-trading/.legacy-home-migrated.json"), "utf8"));
      expect(migration).toMatchObject({ copied: [], reason: "Taosi isolated profile" });
    }
    await page.getByRole("button", { name: "Trading 配置", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Trading 配置" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("默认分析案例").selectOption("crypto");
    await dialog.getByRole("button", { name: "市场与账户配置" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(frame.getByText(/Market data sources|市场数据源/).first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath("trading-settings.png") });
    await page.getByRole("button", { name: "重启 DSH Trading 服务" }).click();
    await expect(page.getByTestId("dsh-trading-surface")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "新建分析案例", exact: true })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Trading 配置", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Trading 配置" }).getByLabel("默认分析案例")).toHaveValue("crypto");
    expect(failures).toEqual([]);
  } finally {
    await testInfo.attach("trading-ui", { body: await page.content(), contentType: "text/html" });
    await page.screenshot({ path: testInfo.outputPath("trading-final.png") });
    await harness.close();
  }
});
