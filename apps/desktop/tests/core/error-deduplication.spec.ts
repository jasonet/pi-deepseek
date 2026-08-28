import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";

test("shows a failed run once in the timeline while keeping retry", async () => {
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("error-deduplication-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Error deduplication");
    const composer = window.getByTestId("composer");
    await composer.fill("Retry this request");
    await composer.press("Enter");
    await expect(window.getByTestId("transcript")).toContainText("Retry this request");

    const state = await getDesktopState(window);
    const workspace = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId);
    const session = workspace?.sessions.find((entry) => entry.id === state.selectedSessionId);
    expect(workspace).toBeTruthy();
    expect(session).toBeTruthy();

    const errorMessage = "400 User location is not supported for the API use.";
    await emitTestSessionEvent(harness, {
      type: "runFailed",
      sessionRef: { workspaceId: workspace!.id, sessionId: session!.id },
      timestamp: new Date().toISOString(),
      runId: "error-deduplication-run",
      error: { message: errorMessage, code: "HTTP_400" },
    });

    await expect(window.getByTestId("transcript")).toContainText(errorMessage);
    await expect(window.getByText(errorMessage, { exact: true })).toHaveCount(1);
    await expect(window.getByTestId("composer-error-banner")).toHaveCount(0);
    await expect(window.getByRole("button", { name: "重试", exact: true })).toBeVisible();

    await window.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(async () =>
      window.getByTestId("transcript").locator(".timeline-item--user", { hasText: "Retry this request" }).count(),
    ).toBe(2);
  } finally {
    await harness.close();
  }
});
