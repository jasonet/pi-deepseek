import { expect, test } from "@playwright/test";
import { createNamedThread, launchDesktop, makeUserDataDir, makeWorkspace } from "../helpers/electron-app";

test("searches the local MCP catalog without installing a server", async () => {
  const harness = await launchDesktop(await makeUserDataDir(), {
    initialWorkspaces: [await makeWorkspace("mcp-catalog")], testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "MCP catalog");
    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await window.getByRole("tab", { name: "MCP 目录" }).click();
    await window.getByRole("textbox", { name: "搜索 MCP 目录" }).fill("elasticsearch");
    await expect(window.getByRole("tabpanel", { name: "MCP 目录" })).toContainText("elasticsearch");
    await expect(window.getByRole("tabpanel", { name: "MCP 目录" })).toContainText("不会自动安装或启用");
  } finally { await harness.close(); }
});
