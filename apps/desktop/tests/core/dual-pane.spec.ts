import { expect, test } from "@playwright/test";
import {
  createSessionViaIpc,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSession,
} from "../helpers/electron-app";

test("submits the right pane composer to the secondary session", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("dual-pane-submit");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createSessionViaIpc(window, workspacePath, "Left primary session");
    await createSessionViaIpc(window, workspacePath, "Right secondary session");
    await selectSession(window, "Right secondary session");

    await expect(window.locator(".dual-pane")).toBeVisible({ timeout: 15_000 });
    await expect(window.locator(".dual-pane__col")).toHaveCount(2);

    const readPaneGeometry = () => window.locator(".dual-pane__col").evaluateAll((columns) =>
      columns.map((column) => {
        const timeline = column.querySelector<HTMLElement>(".timeline-pane");
        const composer = column.querySelector<HTMLElement>(".conversation--composer");
        if (!timeline || !composer) throw new Error("Dual-pane content is incomplete");
        const columnBox = column.getBoundingClientRect();
        const timelineBox = timeline.getBoundingClientRect();
        const composerBox = composer.getBoundingClientRect();
        return {
          columnWidth: columnBox.width,
          timelineLeft: timelineBox.left,
          timelineRight: timelineBox.right,
          composerLeft: composerBox.left,
          composerRight: composerBox.right,
          composerTop: composerBox.top,
          composerHeight: composerBox.height,
        };
      }),
    );
    const paneGeometry = await readPaneGeometry();
    const samplePaneGeometry = async (sampleCount: number) => {
      const samples = [];
      for (let index = 0; index < sampleCount; index += 1) {
        await window.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        samples.push(await readPaneGeometry());
      }
      return samples;
    };
    const matchesInitialGeometry = (sample: typeof paneGeometry) => sample.every((pane, index) => {
      const initial = paneGeometry[index];
      return Boolean(initial) && Object.keys(pane).every((key) =>
        Math.abs(pane[key as keyof typeof pane] - initial[key as keyof typeof initial]) < 1,
      );
    });

    expect(Math.abs(paneGeometry[0]!.columnWidth - paneGeometry[1]!.columnWidth)).toBeLessThan(1);
    expect(Math.abs(paneGeometry[0]!.composerTop - paneGeometry[1]!.composerTop)).toBeLessThan(1);
    expect(Math.abs(paneGeometry[0]!.composerHeight - paneGeometry[1]!.composerHeight)).toBeLessThan(1);
    for (const pane of paneGeometry) {
      expect(Math.abs(pane.timelineLeft - pane.composerLeft)).toBeLessThan(1);
      expect(Math.abs(pane.timelineRight - pane.composerRight)).toBeLessThan(1);
    }

    const stateBefore = await getDesktopState(window);
    const workspace = stateBefore.workspaces.find((entry) => entry.path === workspacePath);
    expect(workspace).toBeTruthy();
    const secondarySession = workspace?.sessions.find((entry) => entry.title === "Left primary session");
    const primarySession = workspace?.sessions.find((entry) => entry.title === "Right secondary session");
    expect(secondarySession).toBeTruthy();
    expect(primarySession).toBeTruthy();

    const rightPane = window.locator(".dual-pane__col").nth(1);
    const toolGeometrySamples = samplePaneGeometry(20);
    const toolEventBase = {
      sessionRef: { workspaceId: workspace!.id, sessionId: secondarySession!.id },
      timestamp: new Date().toISOString(),
      runId: "dual-pane-tool-run",
      callId: "dual-pane-tool-call",
    } as const;
    await emitTestSessionEvent(harness, {
      ...toolEventBase,
      type: "toolStarted",
      toolName: "read",
      input: { path: "README.md" },
    });
    await emitTestSessionEvent(harness, {
      ...toolEventBase,
      type: "toolFinished",
      success: true,
      output: "done",
    });
    await expect(rightPane.locator(".timeline-tool--success")).toBeVisible();
    expect((await toolGeometrySamples).every(matchesInitialGeometry)).toBe(true);

    const rightComposer = rightPane.getByTestId("composer");
    await expect(rightComposer).toBeVisible();
    await rightComposer.fill("Message sent from the right pane");
    const geometryDuringSubmit = samplePaneGeometry(20);
    await rightComposer.press("Enter");
    await expect(rightComposer).toHaveValue("");
    expect((await geometryDuringSubmit).every(matchesInitialGeometry)).toBe(true);

    await expect
      .poll(async () => {
        return window.evaluate(async ({ workspaceId, sessionId }) => {
          const transcript = await window.piApp?.getTranscriptFor({ workspaceId, sessionId });
          return transcript?.transcript.flatMap((item) =>
            item.kind === "message" && item.role === "user" ? [item.text] : [],
          ) ?? [];
        }, { workspaceId: workspace!.id, sessionId: secondarySession!.id });
      }, { timeout: 15_000 })
      .toContain("Message sent from the right pane");

    expect(matchesInitialGeometry(await readPaneGeometry())).toBe(true);

    const primaryMessages = await window.evaluate(async ({ workspaceId, sessionId }) => {
      const transcript = await window.piApp?.getTranscriptFor({ workspaceId, sessionId });
      return transcript?.transcript.flatMap((item) =>
        item.kind === "message" && item.role === "user" ? [item.text] : [],
      ) ?? [];
    }, { workspaceId: workspace!.id, sessionId: primarySession!.id });
    expect(primaryMessages).not.toContain("Message sent from the right pane");
  } finally {
    await harness.close();
  }
});
