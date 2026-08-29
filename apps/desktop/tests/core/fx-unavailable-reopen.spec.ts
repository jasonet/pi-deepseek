import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("falls back to Pi when a persisted standalone fx thread cannot run", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("fx-unavailable-reopen-workspace");
  const firstRun = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  let workspaceId = "";
  let piSessionId = "";
  try {
    const window = await firstRun.firstWindow();
    await createNamedThread(window, "Pi fallback thread");
    const state = await getDesktopState(window);
    workspaceId = state.selectedWorkspaceId;
    piSessionId = state.selectedSessionId;
  } finally {
    await firstRun.close();
  }

  const catalogsPath = join(userDataDir, "catalogs.json");
  const catalogs = JSON.parse(await readFile(catalogsPath, "utf8")) as {
    sessions: Array<Record<string, unknown> & {
      backendId: string;
      sessionRef: { workspaceId: string; sessionId: string };
      workspaceId: string;
      title: string;
    }>;
  };
  const piSession = catalogs.sessions.find(
    (session) => session.workspaceId === workspaceId && session.sessionRef.sessionId === piSessionId,
  );
  expect(piSession).toBeDefined();
  const fxSessionId = "fx:persisted-windows-session";
  const { sessionFilePath: _sessionFilePath, ...sessionWithoutFile } = piSession!;
  catalogs.sessions.push({
    ...sessionWithoutFile,
    backendId: "fx",
    sessionRef: { workspaceId, sessionId: fxSessionId },
    title: "Persisted fx thread",
    updatedAt: new Date(Date.now() + 1_000).toISOString(),
  });
  await writeFile(catalogsPath, `${JSON.stringify(catalogs, null, 2)}\n`, "utf8");

  const uiStatePath = join(userDataDir, "ui-state.json");
  const uiState = JSON.parse(await readFile(uiStatePath, "utf8")) as Record<string, unknown>;
  uiState.selectedWorkspaceId = workspaceId;
  uiState.selectedSessionId = fxSessionId;
  await writeFile(uiStatePath, `${JSON.stringify(uiState, null, 2)}\n`, "utf8");

  const secondRun = await launchDesktop(userDataDir, { testMode: "background" });
  try {
    const window = await secondRun.firstWindow();
    await expect.poll(async () => {
      const state = await getDesktopState(window);
      return {
        fxAvailable: state.fxAvailable,
        selectedSessionId: state.selectedSessionId,
        lastError: state.lastError,
      };
    }).toEqual({
      fxAvailable: false,
      selectedSessionId: piSessionId,
      lastError: undefined,
    });
    await expect(window.locator(".topbar__session")).toHaveText("Pi fallback thread");
  } finally {
    await secondRun.close();
  }
});
