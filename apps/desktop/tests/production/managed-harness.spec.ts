import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { parse } from "yaml";
import { launchDesktop, launchDesktopByExecutable, makeUserDataDir } from "../helpers/electron-app";
import { DSH_VERSION } from "../../electron/dsh-managed-runtime";
import { verifyPojiaDsh } from "../../electron/pojia-dsh";

test("fresh managed Pojia Harness installs, opens, restarts and stops with Electron", async () => {
  test.skip(process.env.PI_APP_DSH_INSTALL_SMOKE !== "1", "Opt-in real Node/npm download, no model prompts");
  test.setTimeout(20 * 60_000);
  const root = await makeUserDataDir("taosi-pojia-first-run-");
  await mkdir(join(root, "dsh"));
  await writeFile(join(root, "dsh", ".credentials.yaml"),
    "version: 1\nrefs:\n  DEEPSEEK_API_KEY: smoke-not-a-real-key\nrecords: {}\nDEEPSEEK_API_KEY: legacy-not-a-real-key\n",
    { mode: 0o600 });
  const options = { scrubProviderEnv: true, testMode: "background" as const, envOverrides: { PI_APP_DSH_WEB_URL: "" } };
  const launch = () => process.env.PI_APP_DSH_SMOKE_EXECUTABLE
    ? launchDesktopByExecutable(process.env.PI_APP_DSH_SMOKE_EXECUTABLE, root, options)
    : launchDesktop(root, options);
  const harness = await launch();
  let pid: number | undefined;
  try {
    const window = await harness.firstWindow();
    const errors: string[] = [];
    window.on("pageerror", (error) => errors.push(error.message));
    await window.getByTestId("open-deepseek-harness").click();
    await expect(window.getByRole("heading", { name: "正在安装 Pojia Harness" })).toBeVisible();
    await expect(window.getByRole("progressbar", { name: "安装进度" })).toBeVisible();
    await window.screenshot({ path: test.info().outputPath("installing.png") });
    await expect.poll(async () => {
      if (await window.getByTestId("dsh-web-error").isVisible()) {
        throw new Error(await window.getByTestId("dsh-web-error").innerText());
      }
      return window.getByTestId("dsh-web-surface").isVisible();
    }, { timeout: 15 * 60_000, intervals: [1000, 3000] }).toBe(true);
    const frame = window.frameLocator('[data-testid="dsh-web-frame"]');
    await expect(frame.locator("body")).not.toContainText("authentication required");
    await expect(frame.getByRole("button").first()).toBeVisible({ timeout: 30_000 });
    await expect(window.getByTestId("dsh-web-port")).toContainText("127.0.0.1:");
    await window.screenshot({ path: test.info().outputPath("running.png") });
    const runtime = join(root, "harness", `dsh-${DSH_VERSION}-pojia-1`);
    expect(await verifyPojiaDsh(runtime)).toBe(true);
    expect(await readFile(join(runtime, "POJIA-LICENSE.txt"), "utf8")).toContain("MIT License");
    const credentials = parse(await readFile(join(root, "dsh", ".credentials.yaml"), "utf8"));
    // DSH adds its own browser grant; never print that private record on failure.
    expect(Object.keys(credentials).sort()).toEqual(["records", "refs", "version"]);
    expect(credentials.version).toBe(1);
    expect(credentials.refs.DEEPSEEK_API_KEY === "smoke-not-a-real-key").toBe(true);
    // PID is not a UI command; read it only to prove restart/quit process ownership.
    const status = () => window.evaluate(() => window.piApp!.getDshWebStatus());
    const first = await status();
    pid = first.pid;
    expect(pid).toBeGreaterThan(0);
    if (first.state !== "running") throw new Error("DSH did not start");
    const unauthenticated = await fetch(new URL("/", first.url));
    expect(unauthenticated.status).toBe(401);
    await unauthenticated.body?.cancel();
    await window.getByRole("button", { name: "重启 DSH 服务", exact: true }).click();
    await expect.poll(async () => (await status()).pid, { timeout: 120_000 }).not.toBe(pid);
    await expect(window.getByTestId("dsh-web-surface")).toBeVisible({ timeout: 120_000 });
    await expect(frame.getByRole("button").first()).toBeVisible({ timeout: 30_000 });
    expect(() => process.kill(pid!, 0)).toThrow();
    pid = (await status()).pid;
    expect(errors).toEqual([]);
    console.log(JSON.stringify({ userData: root, runtime, pid, status: (await status()).state }));
  } finally { await harness.close(); }
  if (pid) await expect.poll(() => { try { process.kill(pid!, 0); return true; } catch { return false; } }).toBe(false);
  const reopened = await launch();
  try {
    const window = await reopened.firstWindow();
    await window.getByTestId("open-deepseek-harness").click();
    await expect(window.getByTestId("dsh-web-surface")).toBeVisible({ timeout: 30_000 });
    await expect(window.frameLocator('[data-testid="dsh-web-frame"]').getByRole("button", { name: "New session", exact: true }).first()).toBeVisible({ timeout: 30_000 });
    const status = await window.evaluate(() => window.piApp!.getDshWebStatus());
    expect(status.logs?.join("\n")).not.toContain("安装 DeepSeek Harness");
    pid = status.pid;
    await reopened.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1060, 760));
    await expect(window.getByRole("button", { name: "重启 DSH 服务", exact: true })).toBeVisible();
    await window.screenshot({ path: test.info().outputPath("reopened-compact.png") });
  } finally { await reopened.close(); }
  if (pid) await expect.poll(() => { try { process.kill(pid!, 0); return true; } catch { return false; } }).toBe(false);
});

test("installed Harness starts with the explicitly selected existing user profile", async () => {
  const userData = process.env.PI_APP_DSH_EXISTING_USER_DATA;
  test.skip(!userData, "Opt-in existing profile: repairs credentials and launches, never sends prompts");
  test.setTimeout(180_000);
  const launch = () => launchDesktopByExecutable(
    process.env.PI_APP_DSH_SMOKE_EXECUTABLE ?? "/Applications/Taosi.app/Contents/MacOS/Taosi",
    userData!, { agentDir: join(homedir(), ".pi", "agent"), testMode: "background",
      envOverrides: { DSH_HOME: join(homedir(), ".dsh"), PI_APP_DSH_WEB_URL: "" } });
  for (let attempt = 0; attempt < 2; attempt++) {
    const harness = await launch();
    let pid: number | undefined;
    try {
      const window = await harness.firstWindow();
      await window.getByTestId("open-deepseek-harness").click();
      await expect(window.getByTestId("dsh-web-surface")).toBeVisible({ timeout: 90_000 });
      const frame = window.frameLocator('[data-testid="dsh-web-frame"]');
      await expect(frame.getByRole("button").first()).toBeVisible({ timeout: 30_000 });
      await window.screenshot({ path: test.info().outputPath(`existing-profile-${attempt}.png`) });
      // Existing profiles may load ds-bot, which replaces the stock sidebar.
      await expect(frame.getByRole("textbox").first()).toBeVisible({ timeout: 30_000 });
      await expect(frame.locator("body")).not.toContainText("authentication required");
      const status = () => window.evaluate(() => window.piApp!.getDshWebStatus());
      pid = (await status()).pid;
      expect(pid).toBeGreaterThan(0);
      if (attempt === 0) {
        await window.getByRole("button", { name: "重启 DSH 服务", exact: true }).click();
        await expect.poll(async () => (await status()).pid, { timeout: 60_000 }).not.toBe(pid);
        await expect(frame.getByRole("textbox").first()).toBeVisible({ timeout: 60_000 });
        expect(() => process.kill(pid!, 0)).toThrow();
        pid = (await status()).pid;
      }
      const current = await status();
      console.log(JSON.stringify({ attempt, state: current.state, port: current.port, pid: current.pid }));
    } finally { await harness.close(); }
    if (pid) await expect.poll(() => { try { process.kill(pid!, 0); return true; } catch { return false; } }).toBe(false);
  }
});
