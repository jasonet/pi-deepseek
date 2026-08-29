import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createSessionViaIpc,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("boots an existing workspace and starts a new thread through the real UI", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("core-smoke-workspace");
  const promptText = "Smoke test thread";
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    await waitForWorkspaceByPath(window, workspacePath);
    await expect(window.getByTestId("workspace-list")).toContainText(basename(workspacePath));
    await window.getByRole("complementary").getByRole("button", { name: "New thread" }).click();

    const prompt = window.getByLabel("New thread prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt).toBeFocused();
    await expect(window.getByRole("heading", { name: "Let's build" })).toBeVisible();
    await prompt.fill(promptText);

    await window.getByRole("button", { name: "Start thread" }).click();

    await expect(window.locator(".topbar__session")).toHaveText(/\S+/);
    await expect(window.getByTestId("composer")).toBeFocused();
    const activeSessionRow = window.locator(".session-row--active");
    const engineMark = activeSessionRow.locator('.session-row__engine-mark[data-engine="pi"]');
    await expect(engineMark).toBeVisible();
    await expect(activeSessionRow.locator(".agent-backend-badge")).toHaveText("pi");
    await expect(activeSessionRow.locator(".session-row__leading > :first-child")).toHaveAttribute("data-engine", "pi");
    await expect
      .poll(() => engineMark.locator("img").evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ))
      .toBe(true);
    await expect
      .poll(async () => {
        const transcript = await getSelectedTranscript(window);
        const userMessage = transcript?.transcript.find(
          (entry) => entry.kind === "message" && "role" in entry && entry.role === "user",
        );
        return userMessage?.text ?? "";
      }, { timeout: 15_000 })
      .toContain(promptText);
    await expect(window.getByTestId("transcript")).toContainText(promptText);
  } finally {
    await harness.close();
  }
});

test("aligns workspace names with session titles in the sidebar gutter", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("aligned-sidebar-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    await waitForWorkspaceByPath(window, workspacePath);
    await expect(window.getByTestId("workspace-list")).toContainText(basename(workspacePath));
    await createSessionViaIpc(window, workspacePath, "Aligned session");

    const workspaceGroup = window.locator(".workspace-group").first();
    const workspaceName = workspaceGroup.locator(".workspace-row__name");
    const sessionTitle = workspaceGroup.locator(".session-row__title", { hasText: "Aligned session" });
    const engineMark = workspaceGroup.locator('.session-row__engine-mark[data-engine="pi"]');

    await expect(workspaceName).toBeVisible();
    await expect(sessionTitle).toBeVisible();
    await expect(engineMark).toBeVisible();

    const [workspaceBox, sessionBox, engineBox] = await Promise.all([
      workspaceName.boundingBox(),
      sessionTitle.boundingBox(),
      engineMark.boundingBox(),
    ]);
    expect(workspaceBox).not.toBeNull();
    expect(sessionBox).not.toBeNull();
    expect(engineBox).not.toBeNull();
    expect(Math.abs((workspaceBox?.x ?? 0) - (sessionBox?.x ?? 0))).toBeLessThanOrEqual(1);
    expect((engineBox?.x ?? 0) + (engineBox?.width ?? 0)).toBeLessThanOrEqual(sessionBox?.x ?? 0);
    const sessionRow = workspaceGroup.locator('.session-row', { hasText: "Aligned session" });
    const sessionRowBox = await sessionRow.boundingBox();
    expect(sessionRowBox).not.toBeNull();
    expect(engineBox?.x ?? 0).toBeGreaterThanOrEqual(sessionRowBox?.x ?? 0);
    expect((engineBox?.x ?? 0) + (engineBox?.width ?? 0)).toBeLessThanOrEqual(
      (sessionRowBox?.x ?? 0) + (sessionRowBox?.width ?? 0),
    );
  } finally {
    await harness.close();
  }
});
