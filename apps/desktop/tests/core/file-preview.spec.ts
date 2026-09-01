import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedTranscriptMessages,
  stubNextSaveDialogResult,
} from "../helpers/electron-app";

test("previews workspace files from transcript links and saves from the context menu", async () => {
  test.setTimeout(45_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("file-preview-workspace");
  await writeFile(join(workspacePath, "preview.md"), "# Preview heading\n\n**Rendered Markdown**\n", "utf8");
  await writeFile(join(workspacePath, "example.ts"), "const answer: number = 42;\n", "utf8");
  const savedPath = join(workspacePath, "saved-preview.md");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "File preview test");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => "Files: [Markdown preview](preview.md) and [TypeScript preview](example.ts)",
    });

    const fileLinks = window.locator('[data-file-link="true"]');
    await expect(fileLinks).toHaveCount(2);

    await fileLinks.filter({ hasText: "Markdown preview" }).click();
    const panel = window.getByTestId("file-preview-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("preview.md");
    await expect(panel.locator(".message__content h1")).toContainText("Preview heading");
    await expect(panel.locator(".message__content strong")).toContainText("Rendered Markdown");

    await stubNextSaveDialogResult(harness, { canceled: false, filePath: savedPath });
    await panel.locator(".file-preview-panel__markdown").click({ button: "right" });
    await expect.poll(async () => readFile(savedPath, "utf8")).toContain("Rendered Markdown");

    await panel.getByRole("button", { name: "Close file preview" }).click();
    await fileLinks.filter({ hasText: "TypeScript preview" }).click();
    await expect(window.getByTestId("file-preview-panel")).toContainText("const answer");
    await expect(window.locator(".file-preview-panel__line-number").first()).toContainText("1");
  } finally {
    await harness.close();
  }
});
