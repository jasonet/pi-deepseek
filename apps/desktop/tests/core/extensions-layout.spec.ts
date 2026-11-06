import { expect, test } from "@playwright/test";
import { launchDesktop, launchDesktopByExecutable, makeUserDataDir, makeWorkspace, waitForWorkspaceByPath, writeProjectExtension } from "../helpers/electron-app";

test("separates extension selection, packages and prompt drafts", async ({}, testInfo) => {
  const workspace = await makeWorkspace("extensions-layout");
  await writeProjectExtension(workspace, "layout-extension.ts", `export default function(pi) {
    pi.registerCommand("layout-check", { description: "Layout fixture", handler: async () => {} });
  }`);
  await writeProjectExtension(workspace, "MCP-layout.ts", `export default function(pi) {
    pi.registerCommand("mcp-layout-check", { description: "MCP fixture", handler: async () => {} });
  }`);
  const userDataDir = await makeUserDataDir();
  const options = { initialWorkspaces: [workspace], testMode: "background" as const };
  const executable = process.env.TAOSI_EXTENSIONS_TEST_EXECUTABLE;
  const harness = executable
    ? await launchDesktopByExecutable(executable, userDataDir, options)
    : await launchDesktop(userDataDir, options);
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspace);
    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await expect(window.getByRole("tab", { name: "Installed", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(window.getByRole("heading", { name: "MCP integrations" })).toBeVisible();
    await expect(window.getByRole("heading", { name: "Runtime extensions" })).toBeVisible();
    const fixture = window.getByTestId("extensions-list").getByRole("button").filter({ hasText: "layout-extension" });
    await fixture.click();
    await expect(fixture).toHaveAttribute("aria-pressed", "true");
    await expect(window.getByRole("switch")).toBeChecked();
    await window.getByRole("switch").click();
    await expect(window.getByRole("switch")).not.toBeChecked();
    await window.getByRole("switch").click();
    await expect(window.getByRole("switch")).toBeChecked();
    await expect(window.locator(".extensions-source")).not.toHaveAttribute("open", "");
    await window.locator(".extensions-source summary").click();
    await expect(window.locator(".extensions-source")).toHaveAttribute("open", "");
    await window.getByRole("tab", { name: "Packages", exact: true }).click();
    await expect(window.getByTestId("extensions-list")).toBeHidden();
    await expect(window.locator(".packages-section__install")).toBeVisible();
    await window.getByRole("tab", { name: "System prompt", exact: true }).click();
    await window.locator("textarea").first().fill("Unsaved layout test draft");
    await window.getByRole("tab", { name: "Installed", exact: true }).click();
    await window.getByRole("tab", { name: "System prompt", exact: true }).click();
    await expect(window.locator("textarea").first()).toHaveValue("Unsaved layout test draft");
    await window.getByRole("tab", { name: "Installed", exact: true }).click();
    await window.getByRole("tab", { name: "Installed", exact: true }).press("ArrowRight");
    await expect(window.getByRole("tab", { name: "Packages", exact: true })).toBeFocused();
    await window.getByRole("tab", { name: "Packages", exact: true }).press("Home");
    await window.screenshot({ path: testInfo.outputPath("extensions-wide.png") });
    await window.setViewportSize({ width: 720, height: 900 });
    await expect(window.locator(".extensions-view .skills-layout")).toHaveCSS("grid-template-columns", /^(?!.* .*).*$/);
    const overflow = await window.locator(".extensions-view").evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(false);
    await window.screenshot({ path: testInfo.outputPath("extensions-narrow.png") });
  } finally {
    await harness.close();
  }
});
