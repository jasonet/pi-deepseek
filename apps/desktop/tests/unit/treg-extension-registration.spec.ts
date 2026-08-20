import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

test("registers only five meta-tools and refuses non-interactive or mutating calls before connecting", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-treg-extension-"));
  const policyPath = path.join(root, "policy.json");
  await writeFile(policyPath, JSON.stringify({
    enabled: true,
    piEnabled: true,
    serviceUrl: "http://127.0.0.1:1/mcp",
    paidCalls: "ask",
    allowMutatingCalls: false,
    workspaceRoots: [root],
  }));

  const previousPolicy = process.env.PI_TREG_POLICY_PATH;
  const previousToken = process.env.TREG_TOKEN;
  process.env.PI_TREG_POLICY_PATH = policyPath;
  process.env.TREG_TOKEN = "test-token-never-sent";
  try {
    const extensionUrl = pathToFileURL(path.resolve(__dirname, "../../resources/extensions/pi-treg/index.ts"));
    extensionUrl.searchParams.set("registration", String(Date.now()));
    const { default: loadExtension } = await import(extensionUrl.href);
    const tools = new Map<string, any>();
    await loadExtension({
      registerTool: (tool: any) => tools.set(tool.name, tool),
      registerCommand: () => undefined,
      on: () => undefined,
    } as any);

    expect([...tools.keys()].sort()).toEqual([
      "treg_balance",
      "treg_call",
      "treg_catalog_get",
      "treg_catalog_search",
      "treg_my_tools",
    ]);

    const call = tools.get("treg_call");
    const headless = await call.execute("call-1", { endpoint_id: "team/status" }, undefined, undefined, {
      cwd: root,
      hasUI: false,
      ui: {},
    });
    expect(headless.isError).toBe(true);
    expect(headless.content[0].text).toContain("interactive Pi confirmation");

    const write = await call.execute("call-2", { endpoint_id: "team/update", method: "POST" }, undefined, undefined, {
      cwd: root,
      hasUI: true,
      ui: { confirm: () => Promise.resolve(true) },
    });
    expect(write.isError).toBe(true);
    expect(write.content[0].text).toContain("calls are blocked");

    let confirmations = 0;
    const cancelled = await call.execute("call-3", { endpoint_id: "team/status" }, undefined, undefined, {
      cwd: root,
      hasUI: true,
      ui: { confirm: async () => { confirmations += 1; return false; } },
    });
    expect(cancelled.isError).toBe(true);
    expect(cancelled.content[0].text).toContain("cancelled before any paid endpoint");
    expect(confirmations).toBe(1);
  } finally {
    if (previousPolicy === undefined) delete process.env.PI_TREG_POLICY_PATH;
    else process.env.PI_TREG_POLICY_PATH = previousPolicy;
    if (previousToken === undefined) delete process.env.TREG_TOKEN;
    else process.env.TREG_TOKEN = previousToken;
  }
});
