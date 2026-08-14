import { createServer } from "node:http";

import { expect, test } from "@playwright/test";

import { selectDshLaunchCredential } from "../../electron/dsh-web-service";
import { getDesktopState, launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

test("keeps a working DSH credential ahead of the Pi-Deepseek fallback", async () => {
  const probed: string[] = [];
  const selection = await selectDshLaunchCredential(
    [{ source: "environment", value: "dsh-key" }],
    "pi-key",
    async (apiKey) => {
      probed.push(apiKey);
      return "valid";
    },
  );

  expect(selection).toEqual({ apiKey: "dsh-key", clearInherited: false });
  expect(probed).toEqual(["dsh-key"]);
});

test("uses the Pi-Deepseek credential when configured DSH credentials are rejected", async () => {
  const selection = await selectDshLaunchCredential(
    [
      { source: "environment", value: "bad-env-key" },
      { source: "file", value: "bad-file-key" },
    ],
    "pi-key",
    async (apiKey) => apiKey === "pi-key" ? "valid" : "invalid",
  );

  expect(selection).toEqual({ apiKey: "pi-key", clearInherited: false });
});

test("preserves the current DSH credential when the network cannot verify it", async () => {
  const selection = await selectDshLaunchCredential(
    [{ source: "file", value: "dsh-key" }],
    "pi-key",
    async () => "unknown",
  );

  expect(selection).toEqual({ apiKey: "dsh-key", clearInherited: false });
});

test("clears a rejected inherited credential when no working fallback exists", async () => {
  const selection = await selectDshLaunchCredential(
    [{ source: "environment", value: "bad-env-key" }],
    "bad-pi-key",
    async () => "invalid",
  );

  expect(selection).toEqual({ clearInherited: true });
});

test("opens the managed DeepSeek Harness web UI as a sidebar tab", async () => {
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
