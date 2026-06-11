import { expect, test, type Page } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("connect phone exposes QR login providers", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("settings-channels-workspace");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await openConnectPhone(window);

    await expect(window.getByRole("button", { name: /微信/ })).toBeVisible();
    await expect(window.getByRole("button", { name: /飞书/ })).toBeVisible();
    await expect(window.locator(".connect-phone__qr-box")).toContainText("扫码连接");
    await expect(window.getByRole("button", { name: "生成二维码", exact: true })).toBeVisible();
    await expect(window.locator(".connect-phone__future")).toContainText("Telegram");
    await expect(window.locator(".connect-phone__future")).toContainText("WhatsApp");
  } finally {
    await harness.close();
  }
});

async function openConnectPhone(window: Page): Promise<void> {
  await window.getByRole("button", { name: "连接手机", exact: true }).click();
  await expect(window.getByTestId("connect-phone-surface")).toBeVisible();
  await expect(window.locator(".view-header__title")).toHaveText("连接手机");
}
