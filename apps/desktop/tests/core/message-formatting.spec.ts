import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
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
  "# Install dependencies",
  "pnpm install",
  "```",
  "",
  "See [the docs](https://example.com/docs).",
].join("\n");

/** Palette mirrors the `:root` / `:root.dark` tokens in src/styles/main.css. */
const PALETTE = {
  light: { inlineCode: "rgb(21, 128, 61)", link: "rgb(124, 58, 237)", quoteBorder: "rgb(59, 130, 246)" },
  dark: { inlineCode: "rgb(74, 222, 128)", link: "rgb(167, 139, 250)", quoteBorder: "rgb(96, 165, 250)" },
} as const;

async function resolvePalette(window: Page) {
  const isDark = await window.evaluate(() => document.documentElement.classList.contains("dark"));
  return isDark ? PALETTE.dark : PALETTE.light;
}

function colorOf(locator: Locator, property: "color" | "borderLeftColor") {
  return locator.evaluate((el, prop) => getComputedStyle(el)[prop as "color"], property);
}

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
    const palette = await resolvePalette(window);

    // 指令 — inline code renders as a green command chip.
    const inlineCode = assistantRow.locator("code.message-inline-code");
    await expect(inlineCode).toHaveText("pnpm install");
    expect(await colorOf(inlineCode, "color")).toBe(palette.inlineCode);

    // 链接 — anchors render purple and keep their target.
    const link = assistantRow.locator("a", { hasText: "the docs" });
    await expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(await colorOf(link, "color")).toBe(palette.link);

    // 引用 — blockquotes carry the blue accent border.
    const quote = assistantRow.locator("blockquote");
    await expect(quote).toContainText("Quoted guidance lives here.");
    expect(await colorOf(quote, "borderLeftColor")).toBe(palette.quoteBorder);

    // 数字 — prose numbers are bolded; unit-suffixed numbers and code are left alone.
    const boldNumbers = assistantRow.locator("p strong.markdown-num");
    await expect(boldNumbers).toHaveCount(3);
    await expect(boldNumbers).toHaveText(["42", "3", "100%"]);
    const firstWeight = await boldNumbers.first().evaluate((el) => getComputedStyle(el).fontWeight);
    expect(Number(firstWeight)).toBeGreaterThanOrEqual(700);
    // `3.14s` is a unit-suffixed value, so it stays plain text.
    await expect(assistantRow.locator("strong.markdown-num", { hasText: "3.14" })).toHaveCount(0);
    await expect(inlineCode.locator("strong.markdown-num")).toHaveCount(0);

    // 代码段 — fenced blocks start collapsed behind a header bar.
    const block = assistantRow.locator(".markdown-code-block");
    await expect(block).toHaveCount(1);
    await expect(block).toHaveClass(/markdown-code-block--collapsed/);
    await expect(block).toHaveClass(/markdown-code-block--command/);
    await expect(block.locator(".markdown-code-block__badge")).toHaveText("bash");
    // Unit label follows the UI locale ("2 lines" / "2 行").
    await expect(block.locator(".markdown-code-block__lines")).toHaveText(/^2\s*(lines|行)$/);
    await expect(block.locator(".markdown-code-block__body")).toHaveCount(0);

    // Expanding reveals line-numbered, syntax-highlighted source.
    await block.locator(".markdown-code-block__header").click();
    await expect(block).toHaveClass(/markdown-code-block--expanded/);
    const body = block.locator(".markdown-code-block__body");
    await expect(body).toBeVisible();
    await expect(body.locator(".markdown-code-block__line")).toHaveCount(2);
    await expect(body.locator(".markdown-code-block__line").first()).toContainText(
      "# Install dependencies",
    );
    await expect(body.locator(".hljs-comment").first()).toHaveText("# Install dependencies");

    // Copy works without collapsing the block.
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
