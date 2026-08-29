import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
} from "../helpers/electron-app";

const execFileAsync = promisify(execFile);

test("starts a standalone fx thread from the new-thread harness selector", async () => {
  test.setTimeout(120_000);
  let fxPath = process.env.PI_FX_BINARY;
  try {
    fxPath ??= (await execFileAsync("which", ["fx"])).stdout.trim();
    await execFileAsync(fxPath, ["status", "--json"]);
  } catch {
    test.skip(true, "A logged-in system fx is required for this live test.");
  }

  const userDataDir = await makeUserDataDir("pi-fx-selected-");
  const workspacePath = await makeWorkspace("fx-selected-runtime");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
    envOverrides: { PI_FX_ENABLED: "1", PI_FX_BINARY: fxPath },
  });
  try {
    const window = await harness.firstWindow();
    await openNewThread(window);

    const piOption = window.getByRole("button", { name: "Use Pi harness for new thread" });
    const fxOption = window.getByRole("button", { name: "Use fx harness for new thread" });
    await expect(piOption).toHaveAttribute("aria-pressed", "true");
    await expect(fxOption).toHaveAttribute("aria-pressed", "false");
    await fxOption.click();
    await expect(fxOption).toHaveAttribute("aria-pressed", "true");

    await window.getByTestId("new-thread-composer").fill(
      "Reply with exactly FX_SELECTED_OK and do not use tools.",
    );
    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.locator(".dual-pane")).toHaveCount(0);
    await expect.poll(async () => {
      const state = await getDesktopState(window);
      const workspace = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId);
      return workspace?.sessions.find((entry) => entry.id === state.selectedSessionId)?.backendId;
    }).toBe("fx");
    const fxSessionRow = window.locator(".session-row--active");
    const fxEngineMark = fxSessionRow.locator('.session-row__engine-mark[data-engine="fx"]');
    await expect(fxEngineMark).toBeVisible();
    await expect(fxSessionRow.locator(".agent-backend-badge")).toHaveText("fx");
    await expect(fxSessionRow.locator(".session-row__leading > :first-child")).toHaveAttribute("data-engine", "fx");
    await expect
      .poll(() => fxEngineMark.locator("img").evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ))
      .toBe(true);

    await expect.poll(async () => {
      const state = await getDesktopState(window);
      const workspace = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId);
      const session = workspace?.sessions.find((entry) => entry.id === state.selectedSessionId);
      if (!workspace || !session) return "missing";
      const transcript = await window.evaluate(
        async ({ workspaceId, sessionId }) => window.piApp?.getTranscriptFor({ workspaceId, sessionId }),
        { workspaceId: workspace.id, sessionId: session.id },
      );
      return transcript?.transcript
        .filter((item) => item.kind === "message" && item.role === "assistant")
        .map((item) => item.text)
        .join("\n") ?? "";
    }, { timeout: 90_000 }).toContain("FX_SELECTED_OK");

    const state = await getDesktopState(window);
    const sessions = state.workspaces.flatMap((workspace) => workspace.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.backendId).toBe("fx");
    expect(sessions[0]?.companionSessionId).toBeUndefined();

    await openNewThread(window);
    await expect(piOption).toHaveAttribute("aria-pressed", "true");
  } finally {
    await harness.close();
  }
});
