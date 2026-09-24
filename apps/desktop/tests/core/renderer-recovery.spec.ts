import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { createNamedThread, getDesktopState, getSelectedTranscript, launchDesktop, launchDesktopByExecutable, makeUserDataDir, makeWorkspace,
  streamAssistantDeltas, waitForWorkspaceByPath } from "../helpers/electron-app";

test("oversized streaming content remains bounded and a crashed renderer restores the draft", async ({}, testInfo) => {
  const workspace = await makeWorkspace("renderer-recovery");
  const userDataDir = await makeUserDataDir();
  const options = { initialWorkspaces: [workspace], testMode: "background" as const };
  const executable = process.env.PI_APP_RECOVERY_TEST_EXECUTABLE;
  const harness = executable ? await launchDesktopByExecutable(executable, userDataDir, options) : await launchDesktop(userDataDir, options);
  try {
    const page = await harness.firstWindow();
    await waitForWorkspaceByPath(page, workspace);
    await createNamedThread(page, "Recovery session");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await streamAssistantDeltas(harness, page, ["Large response\n", ...Array.from({ length: 100 }, () => "x".repeat(32 * 1024))]);
    await expect(page.getByTestId("transcript")).toContainText("Display preview shortened");
    const bytes = Buffer.byteLength(JSON.stringify(await getSelectedTranscript(page)), "utf8");
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
    await page.getByTestId("composer").fill("Keep my draft after recovery");
    await expect.poll(async () => (await getDesktopState(page)).composerDraft).toBe("Keep my draft after recovery");
    // Native process death cannot be triggered through UI; exercise main's real recovery handler.
    await harness.electronApp.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents;
      const probe = globalThis as { __rendererRecoveryCompleted?: boolean };
      probe.__rendererRecoveryCompleted = false;
      contents.once("did-finish-load", () => { probe.__rendererRecoveryCompleted = true; });
      // Let the automation command finish before its page target disappears.
      setTimeout(() => contents.forcefullyCrashRenderer(), 50);
    });
    // Playwright marks a force-crashed Page unusable even after Chromium reloads
    // it. Inspect the recovered real DOM through Electron, not store shortcuts.
    await expect.poll(() => harness.electronApp.evaluate(({ BrowserWindow }) => {
      if (!(globalThis as { __rendererRecoveryCompleted?: boolean }).__rendererRecoveryCompleted) return null;
      return BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(`({
        draft: document.querySelector('[data-testid="composer"]')?.value,
        text: document.querySelector('[data-testid="transcript"]')?.textContent?.includes('Large response')
      })`);
    }).catch((error: Error) => {
        if (/context.*destroyed|navigation|frame.*disposed/i.test(error.message)) return null;
        throw error;
      }), { timeout: 20_000 }).toEqual({ draft: "Keep my draft after recovery", text: true });
    expect(errors).toEqual([]);
    const png = await harness.electronApp.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString("base64"));
    await writeFile(testInfo.outputPath("renderer-recovered.png"), Buffer.from(png, "base64"));
  } finally {
    await harness.close();
  }
});

test("an app-level render failure presents a recovery action instead of a blank window", async () => {
  const workspace = await makeWorkspace("app-error-recovery");
  const harness = await launchDesktop(await makeUserDataDir(), { initialWorkspaces: [workspace], testMode: "background" });
  try {
    const page = await harness.firstWindow();
    await waitForWorkspaceByPath(page, workspace);
    await createNamedThread(page, "Root boundary recovery");
    await page.getByTestId("composer").fill("Preserved root-boundary draft");
    await expect.poll(async () => (await getDesktopState(page)).composerDraft).toBe("Preserved root-boundary draft");
    await page.evaluate(() => {
      const original = document.createElement.bind(document);
      document.createElement = ((tag: string, options?: ElementCreationOptions) => {
        if (tag === "h1") throw new Error("Injected app renderer failure");
        return original(tag, options);
      }) as typeof document.createElement;
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator(".renderer-recovery")).toBeVisible();
    await page.getByRole("button", { name: "重新加载界面", exact: true }).click();
    await expect(page.locator(".settings-view")).toBeVisible();
    await expect(page.locator(".renderer-recovery")).toHaveCount(0);
    await expect.poll(async () => (await getDesktopState(page)).composerDraft).toBe("Preserved root-boundary draft");
  } finally {
    await harness.close();
  }
});

test("a failed Markdown renderer falls back to text without unmounting the composer", async () => {
  const workspace = await makeWorkspace("markdown-recovery");
  const harness = await launchDesktop(await makeUserDataDir(), { initialWorkspaces: [workspace], testMode: "background" });
  try {
    const page = await harness.firstWindow();
    await waitForWorkspaceByPath(page, workspace);
    await createNamedThread(page, "Markdown recovery");
    await page.getByTestId("composer").fill("Unsaved render-boundary draft");
    // Fault injection into the DOM renderer, without a production test backdoor.
    await page.evaluate(() => {
      const original = document.createElement.bind(document);
      document.createElement = ((tag: string, options?: ElementCreationOptions) => {
        if (tag === "code") throw new Error("Injected Markdown renderer failure");
        return original(tag, options);
      }) as typeof document.createElement;
    });
    await streamAssistantDeltas(harness, page, ["`Fallback content`"]);
    await expect(page.locator(".markdown-error-fallback")).toContainText("Fallback content");
    await expect(page.getByTestId("composer")).toHaveValue("Unsaved render-boundary draft");
    await page.getByTestId("composer").fill("Still interactive");
    await expect(page.getByTestId("composer")).toHaveValue("Still interactive");
  } finally {
    await harness.close();
  }
});
