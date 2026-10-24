import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { getDesktopState, launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

test("opens a running DeepSeek Harness web UI as a sidebar tab", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body><main>Harness integration ready</main></body></html>");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Harness fixture server did not bind a TCP port");

  const userDataDir = await makeUserDataDir("pi-gui-dsh-web-");
  const workspacePath = await makeWorkspace("dsh-web-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
    envOverrides: { PI_APP_DSH_WEB_URL: `http://127.0.0.1:${address.port}` },
  });

  try {
    const window = await harness.firstWindow();
    await window.getByTestId("open-deepseek-harness").click();

    await expect(window.getByTestId("dsh-web-surface")).toBeVisible();
    await expect(window.getByTestId("open-deepseek-harness")).toHaveClass(/sidebar__nav-item--active/);
    await expect(window.frameLocator('[data-testid="dsh-web-frame"]').getByText("Harness integration ready")).toBeVisible();
    await expect.poll(async () => (await getDesktopState(window)).activeView).toBe("deepseek-harness");

    await window.getByRole("button", { name: "Threads", exact: true }).click();
    await expect.poll(async () => (await getDesktopState(window)).activeView).toBe("threads");
  } finally {
    await harness.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("retries an explicitly configured external DSH without installing or taking ownership", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body><main>Harness started after prompt</main></body></html>");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Harness recovery server did not bind a TCP port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  const userDataDir = await makeUserDataDir("pi-gui-dsh-web-missing-");
  const workspacePath = await makeWorkspace("dsh-web-missing-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
    envOverrides: { PI_APP_DSH_WEB_URL: `http://127.0.0.1:${address.port}` },
  });

  try {
    const window = await harness.firstWindow();
    await window.getByTestId("open-deepseek-harness").click();

    await expect(window.getByTestId("dsh-web-error")).toBeVisible();
    await expect(window.getByRole("heading", { name: "DeepSeek Harness 未运行" })).toBeVisible();
    await expect(window.getByText("指定的本机 DeepSeek Harness 服务未运行。请启动该服务后重试。", { exact: false })).toBeVisible();
    const retry = window.getByRole("button", { name: "重试" });
    await expect(retry).toBeVisible();

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(address.port, "127.0.0.1", resolve);
    });
    await retry.click();
    await expect(window.frameLocator('[data-testid="dsh-web-frame"]').getByText("Harness started after prompt")).toBeVisible();
  } finally {
    await harness.close();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

test("keeps the Harness and Bot tabs on their separate local services", async () => {
  const harnessServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body>Harness-only page</body></html>");
  });
  const botServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body>Bot-only page</body></html>");
  });
  for (const server of [harnessServer, botServer]) {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  }
  const harnessAddress = harnessServer.address();
  const botAddress = botServer.address();
  if (!harnessAddress || typeof harnessAddress === "string" || !botAddress || typeof botAddress === "string") {
    throw new Error("DSH fixture server did not bind a TCP port");
  }
  const userDataDir = await makeUserDataDir("pi-gui-dsh-split-");
  const workspacePath = await makeWorkspace("dsh-split-workspace");
  const dshHome = join(userDataDir, "dsh");
  const webProfile = join(dshHome, "profiles", "web");
  await mkdir(join(webProfile, "node_modules", "ds-bot"), { recursive: true });
  await writeFile(join(webProfile, "package.json"), JSON.stringify({ dependencies: { "ds-bot": "1.0.0" } }));
  await writeFile(join(webProfile, "node_modules", "ds-bot", "package.json"), "{}\n");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
    envOverrides: {
      PI_APP_DSH_WEB_URL: `http://127.0.0.1:${harnessAddress.port}`,
      PI_APP_DS_BOT_WEB_URL: `http://127.0.0.1:${botAddress.port}`,
      DSH_HOME: dshHome,
    },
  });
  try {
    const window = await harness.firstWindow();
    await window.getByTestId("open-deepseek-bot").click();
    await expect(window.frameLocator('[data-testid="ds-bot-frame"]').getByText("Bot-only page")).toBeVisible();
    await window.getByTestId("open-deepseek-harness").click();
    await expect(window.frameLocator('[data-testid="dsh-web-frame"]').getByText("Harness-only page")).toBeVisible();
    await window.getByTestId("open-deepseek-bot").click();
    await expect(window.getByTestId("ds-bot-surface")).toBeVisible();
  } finally {
    await harness.close();
    for (const server of [harnessServer, botServer]) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});
