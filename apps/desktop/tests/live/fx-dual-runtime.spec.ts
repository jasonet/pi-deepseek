import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  startThreadViaIpc,
} from "../helpers/electron-app";

const execFileAsync = promisify(execFile);

test("starts a Pi + fx task and streams fx through the right pane", async () => {
  test.setTimeout(120_000);
  let fxPath = process.env.PI_FX_BINARY;
  try {
    fxPath ??= (await execFileAsync("which", ["fx"])).stdout.trim();
    await execFileAsync(fxPath, ["status", "--json"]);
  } catch {
    test.skip(true, "A logged-in system fx is required for this live test.");
  }

  const userDataDir = await makeUserDataDir("pi-fx-dual-");
  const workspacePath = await makeWorkspace("fx-dual-runtime");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_FX_ENABLED: "1", PI_FX_BINARY: fxPath },
  });
  try {
    const window = await harness.firstWindow();
    await startThreadViaIpc(window, {
      prompt: "Reply with exactly FX_DUAL_OK and do not use tools.",
    });

    await expect(window.locator(".dual-pane")).toBeVisible({ timeout: 30_000 });
    const panes = window.locator(".dual-pane__col");
    await expect(panes).toHaveCount(2);
    await expect(panes.nth(0).locator(".agent-backend-badge")).toHaveText("pi");
    await expect(panes.nth(1).locator(".agent-backend-badge")).toHaveText("fx");

    const pairedSessions = (await getDesktopState(window)).workspaces.flatMap(
      (workspace) => workspace.sessions,
    );
    const piSession = pairedSessions.find(
      (session) => session.backendId === "pi",
    );
    const fxSession = pairedSessions.find(
      (session) => session.backendId === "fx",
    );
    expect(piSession).toBeDefined();
    expect(fxSession?.companionSessionId).toBe(piSession?.id);

    await expect
      .poll(
        async () => {
          const state = await getDesktopState(window);
          const fxSession = state.workspaces
            .flatMap((workspace) => workspace.sessions)
            .find((session) => session.backendId === "fx");
          if (!fxSession) return "missing";
          const workspace = state.workspaces.find((candidate) =>
            candidate.sessions.some((session) => session.id === fxSession.id),
          );
          if (!workspace) return "missing";
          const transcript = await window.evaluate(
            async ({ workspaceId, sessionId }) =>
              window.piApp?.getTranscriptFor({ workspaceId, sessionId }),
            { workspaceId: workspace.id, sessionId: fxSession.id },
          );
          return (
            transcript?.transcript
              .filter(
                (item) => item.kind === "message" && item.role === "assistant",
              )
              .map((item) => item.text)
              .join("\n") ?? ""
          );
        },
        { timeout: 90_000 },
      )
      .toContain("FX_DUAL_OK");

    await startThreadViaIpc(window, { prompt: "" });
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const workspace = state.workspaces.find(
          (candidate) => candidate.id === state.selectedWorkspaceId,
        );
        const selected = workspace?.sessions.find(
          (session) => session.id === state.selectedSessionId,
        );
        return workspace?.sessions.find(
          (session) =>
            session.backendId === "fx" &&
            session.companionSessionId === selected?.id,
        )?.title;
      })
      .toBe("New thread");
    await expect(
      window.locator(".dual-pane__col").nth(0).locator(".chat-header__title"),
    ).toHaveText("New thread");
    await expect(
      window.locator(".dual-pane__col").nth(1).locator(".chat-header__title"),
    ).toHaveText("New thread");

    const secondPair = await getDesktopState(window);
    const secondWorkspace = secondPair.workspaces.find(
      (candidate) => candidate.id === secondPair.selectedWorkspaceId,
    );
    const secondPiId = secondPair.selectedSessionId;
    const secondFxId = secondWorkspace?.sessions.find(
      (session) =>
        session.backendId === "fx" && session.companionSessionId === secondPiId,
    )?.id;
    expect(secondFxId).toBeDefined();
    await window.evaluate(
      async ({ workspaceId, sessionId }) =>
        window.piApp?.archiveSession({ workspaceId, sessionId }),
      { workspaceId: secondWorkspace!.id, sessionId: secondPiId },
    );
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const sessions = state.workspaces.find(
          (workspace) => workspace.id === secondWorkspace!.id,
        )?.sessions;
        return [secondPiId, secondFxId].every(
          (sessionId) =>
            sessions?.find((session) => session.id === sessionId)?.archivedAt,
        );
      })
      .toBe(true);
  } finally {
    await harness.close();
  }
});
