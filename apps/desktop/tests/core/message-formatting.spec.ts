import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedTranscriptMessages,
} from "../helpers/electron-app";

const MARKDOWN_BODY = [
  "Processed 42 files across 3 folders at 100% success in 3.14s.",
  "",
  "Run `pnpm install` first.",
  "",
  "> Quoted guidance lives here.",
  "",
  "```bash",
  "pnpm install",
  "pnpm test",
  "```",
  "",
  "See [the docs](https://example.com/docs).",
].join("\n");

test("renders Claude-style markdown formatting in assistant messages", async () => {
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("message-formatting-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Message formatting");
    await seedTranscriptMessages(harness, window, {
      count: 1,
      textFactory: () => MARKDOWN_BODY,
    });

    const assistantRow = window.locator(".timeline-item--assistant").last();
    await expect(assistantRow).toBeVisible();

    // 指令 — inline code renders with the green command chip class.
    const inlineCode = assistantRow.locator("code.message-inline-code");
    await expect(inlineCode).toHaveText("pnpm install");
    const inlineColor = await inlineCode.evaluate((el) => getComputedStyle(el).color);
    expect(inlineColor).toBe("rgb(21, 128, 61)");

    // 链接 — anchors render purple.
    const link = assistantRow.locator("a", { hasText: "the docs" });
    await expect(link).toHaveAttribute("href", "https://example.com/docs");
    const linkColor = await link.evaluate((el) => getComputedStyle(el).color);
    expect(linkColor).toBe("rgb(124, 58, 237)");

    // 引用 — blockquotes carry the blue accent border.
    const quote = assistantRow.locator("blockquote");
    await expect(quote).toContainText("Quoted guidance lives here.");
    const quoteBorder = await quote.evaluate((el) => getComputedStyle(el).borderLeftColor);
    expect(quoteBorder).toBe("rgb(59, 130, 246)");

    // 数字 — prose numbers are bolded, numbers inside code are not.
    const boldNumbers = assistantRow.locator("p strong.markdown-num");
    await expect(boldNumbers).toHaveCount(4);
    await expect(boldNumbers.first()).toHaveText("42");
    const boldWeight = await boldNumbers.first().evaluate((el) => getComputedStyle(el).fontWeight);
    expect(Number(boldWeight)).toBeGreaterThanOrEqual(700);
    await expect(inlineCode.locator("strong.markdown-num")).toHaveCount(0);

    // 代码段 — fenced blocks are collapsed by default behind a header bar.
    const block = assistantRow.locator(".markdown-code-block");
    await expect(block).toHaveCount(1);
    await expect(block).toHaveClass(/markdown-code-block--collapsed/);
    await expect(block).toHaveClass(/markdown-code-block--command/);
    await expect(block.locator(".markdown-code-block__badge")).toHaveText("bash");
    await expect(block.locator(".markdown-code-block__lines")).toHaveText("2 行");
    // Collapsed blocks keep the source hidden until expanded.
    await expect(block.locator(".markdown-code-block__body")).toHaveCount(0);

    // Expanding reveals line-numbered, syntax-highlighted source.
    await block.locator(".markdown-code-block__header").click();
    await expect(block).toHaveClass(/markdown-code-block--expanded/);
    const body = block.locator(".markdown-code-block__body");
    await expect(body).toBeVisible();
    await expect(body.locator(".markdown-code-block__line")).toHaveCount(2);
    await expect(body.locator(".markdown-code-block__line").first()).toContainText("pnpm install");
    await expect(body.locator(".hljs-built_in").first()).toHaveText("pnpm");

    // Copy button is available without expanding.
    await block.locator(".markdown-code-block__copy").click();
    await expect(block.locator(".markdown-code-block__copy")).toHaveClass(
      /markdown-code-block__copy--copied/,
    );

    // Collapsing again hides the body.
    await block.locator(".markdown-code-block__header").click();
    await expect(block).toHaveClass(/markdown-code-block--collapsed/);
    await expect(block.locator(".markdown-code-block__body")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
