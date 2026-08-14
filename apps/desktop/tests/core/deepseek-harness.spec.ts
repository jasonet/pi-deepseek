import { createServer } from "node:http";

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

test("prompts for the DSH web command when no local service is running", async () => {
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
    testMode: "background",
    envOverrides: { PI_APP_DSH_WEB_URL: `http://127.0.0.1:${address.port}` },
  });

  try {
    const window = await harness.firstWindow();
    await window.getByTestId("open-deepseek-harness").click();

    await expect(window.getByTestId("dsh-web-error")).toBeVisible();
    await expect(window.getByRole("heading", { name: "DeepSeek Harness 未运行" })).toBeVisible();
    await expect(window.getByText("npx @deepseek-ai/dsh web", { exact: false })).toBeVisible();
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
