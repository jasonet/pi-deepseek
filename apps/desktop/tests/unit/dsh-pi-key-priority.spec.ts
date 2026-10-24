import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { parse } from "yaml";
import { dshEnvironment } from "../../electron/dsh-managed-runtime";
import { resolveActiveDeepSeekKey, syncDshDeepSeekCredential } from "../../electron/dsh-web-service";
import { makeUserDataDir } from "../helpers/electron-app";

test("only the selected Pi key reaches DSH; installers inherit no API key", () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  try {
    process.env.DEEPSEEK_API_KEY = "invalid-parent-key";
    expect(dshEnvironment(process.execPath).DEEPSEEK_API_KEY).toBeUndefined();
    expect(dshEnvironment(process.execPath, "pi-configured-key").DEEPSEEK_API_KEY).toBe("pi-configured-key");
    expect(process.env.DEEPSEEK_API_KEY).toBe("invalid-parent-key");
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});

test("reloads changed Pi settings for the next DSH launch without a cached key", async () => {
  const root = await makeUserDataDir("dsh-pi-key-refresh-");
  const agentDir = join(root, "agent");
  await mkdir(agentDir);
  const authPath = join(agentDir, "auth.json");
  for (const key of ["first-pi-key", "replacement-pi-key"]) {
    await writeFile(authPath, JSON.stringify({ deepseek: { type: "api_key", key } }));
    expect(await resolveActiveDeepSeekKey(root, agentDir, "invalid-env-key")).toBe(key);
  }
});

test("offline fallback never persists a Pi key that was explicitly rejected", async () => {
  const root = await makeUserDataDir("dsh-pi-rejected-key-");
  const agentDir = join(root, "agent");
  await mkdir(agentDir);
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({ deepseek: { type: "api_key", key: "rejected-pi-key" } }));
  await syncDshDeepSeekCredential({ agentDir, dshHome: root, environmentKey: "unreachable-env-key",
    fetchImpl: async (_input, init) => new Response(null, {
      status: new Headers(init?.headers).get("authorization") === "Bearer rejected-pi-key" ? 401 : 503,
    }) });
  const credentials = parse(await readFile(join(root, ".credentials.yaml"), "utf8"));
  expect(credentials.refs.DEEPSEEK_API_KEY).toBe("unreachable-env-key");
  expect(await resolveActiveDeepSeekKey(root, agentDir, "unreachable-env-key",
    async () => new Response(null, { status: 401 }))).toBe("unreachable-env-key");
});
