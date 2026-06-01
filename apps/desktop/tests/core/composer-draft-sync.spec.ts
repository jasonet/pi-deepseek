import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

test("ignores stale persisted draft acknowledgements while typing", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("composer-draft-sync");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Composer draft sync");

    const composer = window.getByTestId("composer");
    const expectedDraft = "forced-race-abcdef";
    const staleDraft = `${expectedDraft}x`;

    await composer.fill(staleDraft);
    await composer.press("Backspace");
    await expect(composer).toHaveValue(expectedDraft);

    await window.evaluate(({ stale }) => {
      window.setTimeout(() => {
        void window.piApp.updateComposerDraft(stale);
      }, 50);
    }, { stale: staleDraft });

    const sampledValues = await window.evaluate(async () => {
      const composer = document.querySelector<HTMLTextAreaElement>("[data-testid='composer']");
      if (!composer) {
        throw new Error("Composer textarea was unavailable");
      }

      const values: string[] = [];
      const started = performance.now();
      while (performance.now() - started < 900) {
        values.push(composer.value);
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      }
      return values;
    });

    expect(sampledValues).not.toContain(staleDraft);
    await expect(composer).toHaveValue(expectedDraft);
    await expect.poll(async () => (await getDesktopState(window)).composerDraft).toBe(expectedDraft);
  } finally {
    await harness.close();
  }
});

test("applies explicit editor text replacements from the session host", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("composer-editor-text-sync");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Editor text sync");

    const composer = window.getByTestId("composer");
    await composer.fill("local draft");
    await expect(composer).toHaveValue("local draft");

    const state = await getDesktopState(window);
    await emitTestSessionEvent(harness, {
      type: "hostUiRequest",
      sessionRef: {
        workspaceId: state.selectedWorkspaceId,
        sessionId: state.selectedSessionId,
      },
      timestamp: new Date().toISOString(),
      request: {
        kind: "editorText",
        requestId: "editor-text-sync",
        text: "remote replacement",
      },
    });

    await expect(composer).toHaveValue("remote replacement");
  } finally {
    await harness.close();
  }
});
