import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { DshWebService, ensureHarnessProfile } from "../../electron/dsh-web-service";
import { DSH_FREE_MODEL_ARCHIVE, getDshFreeModelStatus, prepareDshFreeModel, setDshFreeModelConfig } from "../../electron/dsh-our-free-model";
import { makeUserDataDir } from "../helpers/electron-app";

const archivePath = resolve(__dirname, "../../resources/extensions", DSH_FREE_MODEL_ARCHIVE);

async function fixture() {
  const root = await makeUserDataDir("taosi-free-model-");
  const dshHome = join(root, "dsh");
  const profile = await ensureHarnessProfile(dshHome);
  const other = join(dshHome, "profiles", "web");
  await mkdir(other, { recursive: true });
  await writeFile(join(other, "cordis.patch.yml"), "# user web profile\n[]\n");
  return { profile, other, options: { dshHome, archivePath } };
}

async function config(profile: string) {
  return {
    manifest: JSON.parse(await readFile(join(profile, "package.json"), "utf8")),
    patch: parse(await readFile(join(profile, "cordis.patch.yml"), "utf8")) as Array<Record<string, any>>,
  };
}

test("opt-in bundle stays in Taosi and tracks free versus official default", async () => {
  const { profile, other, options } = await fixture();
  expect(await getDshFreeModelStatus(options)).toMatchObject({ available: true, installed: false, enabled: false, mode: "auto" });

  let status = await setDshFreeModelConfig({ enabled: true, mode: "auto" }, { ...options, hasDeepSeekKey: true });
  expect(status).toMatchObject({ installed: true, version: "2.5.9", enabled: true, effectiveDefault: "official" });
  let current = await config(profile);
  expect(current.manifest.dependencies["dsh-our-free-model"]).toBe(`file:./vendor/${DSH_FREE_MODEL_ARCHIVE}`);
  expect(current.manifest.dsh.profile.bundles.filter((name: string) => name === "dsh-our-free-model")).toHaveLength(1);
  expect(current.patch.filter((row) => row.id === "our-free-model")).toEqual([{ id: "our-free-model", config: { distribution: "managed" } }]);
  expect(current.patch.some((row) => row.insert)).toBe(false);

  status = await setDshFreeModelConfig({ enabled: true, mode: "free" }, { ...options, hasDeepSeekKey: true });
  expect(status.effectiveDefault).toBe("free");
  await prepareDshFreeModel({ ...options, hasDeepSeekKey: true });
  current = await config(profile);
  expect(current.patch.filter((row) => row.id === "agent-default-model")).toEqual([
    { id: "agent-default-model", config: { provider: "our-free-model", model: "kilo-auto/free" } },
  ]);

  status = await setDshFreeModelConfig({ enabled: true, mode: "auto" }, { ...options, hasDeepSeekKey: false });
  expect(status.effectiveDefault).toBe("free");
  status = await setDshFreeModelConfig({ enabled: false, mode: "auto" }, { ...options, hasDeepSeekKey: false });
  expect(status).toMatchObject({ enabled: false, effectiveDefault: "official" });
  current = await config(profile);
  expect(current.patch).toEqual([]);
  expect(current.manifest.dsh.profile.bundles).not.toContain("dsh-our-free-model");
  expect(await readFile(join(other, "cordis.patch.yml"), "utf8")).toBe("# user web profile\n[]\n");
});

test("missing archive and legacy duplicate loader leave profile unchanged", async () => {
  const { profile, options } = await fixture();
  const original = await readFile(join(profile, "package.json"), "utf8");
  await expect(setDshFreeModelConfig({ enabled: true, mode: "free" }, {
    ...options, archivePath: join(profile, "missing.tgz"), hasDeepSeekKey: false,
  })).rejects.toThrow("校验失败");
  expect(await readFile(join(profile, "package.json"), "utf8")).toBe(original);

  await writeFile(join(profile, "cordis.patch.yml"), "- insert:\n    - id: our-free-model\n      name: dsh-our-free-model\n");
  await expect(setDshFreeModelConfig({ enabled: true, mode: "free" }, { ...options, hasDeepSeekKey: false }))
    .rejects.toThrow("重复加载");
  expect(await readFile(join(profile, "package.json"), "utf8")).toBe(original);
});

test("first start does not take ownership of an existing user-installed plugin", async () => {
  const { profile, options } = await fixture();
  const path = join(profile, "package.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.dependencies["dsh-our-free-model"] = "file:./vendor/user-build.tgz";
  manifest.dsh.profile.bundles.push("dsh-our-free-model");
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
  const original = await readFile(path, "utf8");
  await prepareDshFreeModel({ ...options, hasDeepSeekKey: false });
  expect(await readFile(path, "utf8")).toBe(original);
  await expect(setDshFreeModelConfig({ enabled: true, mode: "free" }, { ...options, hasDeepSeekKey: false }))
    .rejects.toThrow("手工安装");
  expect(await readFile(path, "utf8")).toBe(original);
});

test("disable refuses to remove a dependency changed after opt-in", async () => {
  const { profile, options } = await fixture();
  await setDshFreeModelConfig({ enabled: true, mode: "auto" }, { ...options, hasDeepSeekKey: true });
  const path = join(profile, "package.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.dependencies["dsh-our-free-model"] = "file:./vendor/user-build.tgz";
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
  const original = await readFile(path, "utf8");
  await expect(setDshFreeModelConfig({ enabled: false, mode: "auto" }, { ...options, hasDeepSeekKey: true }))
    .rejects.toThrow("手动修改");
  expect(await readFile(path, "utf8")).toBe(original);
});

test("installed DSH composes one plugin entry and accepts the free default", async () => {
  const runtime = join(homedir(), "Library/Application Support/pi-deepseek/harness/dsh-0.2.1-alpha.1-pojia-1");
  const node = join(homedir(), "Library/Application Support/pi-deepseek/harness/node-v24.22.1-darwin-arm64/bin/node");
  const cli = join(runtime, "node_modules/@deepseek-ai/dsh/lib/bin.js");
  test.skip(!existsSync(node) || !existsSync(cli), "Local managed DSH runtime is unavailable");
  const { options } = await fixture();
  await setDshFreeModelConfig({ enabled: true, mode: "free" }, { ...options, hasDeepSeekKey: false });
  const output = execFileSync(node, [cli, "--profile", "taosi-harness", "--dump-config"], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, DSH_HOME: options.dshHome },
  });
  const tree = parse(output, { logLevel: "silent" }) as Array<Record<string, any>>;
  expect(tree.filter((row) => row.id === "our-free-model")).toHaveLength(1);
  expect(tree.find((row) => row.id === "our-free-model")?.config?.distribution).toBe("managed");
  expect(tree.find((row) => row.id === "agent-default-model")?.config).toMatchObject({
    provider: "our-free-model", model: "kilo-auto/free",
  });
});

test("managed Harness boots with the opted-in plugin without sending a prompt", async () => {
  test.setTimeout(90_000);
  const runtime = join(homedir(), "Library/Application Support/pi-deepseek/harness/dsh-0.2.1-alpha.1-pojia-1");
  const node = join(homedir(), "Library/Application Support/pi-deepseek/harness/node-v24.22.1-darwin-arm64/bin/node");
  const cli = join(runtime, "node_modules/@deepseek-ai/dsh/lib/bin.js");
  test.skip(!existsSync(node) || !existsSync(cli), "Local managed DSH runtime is unavailable");
  const { options } = await fixture();
  await setDshFreeModelConfig({ enabled: true, mode: "free" }, { ...options, hasDeepSeekKey: false });
  const previousHome = process.env.DSH_HOME;
  const previousAgent = process.env.PI_CODING_AGENT_DIR;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DSH_HOME = options.dshHome;
  process.env.PI_CODING_AGENT_DIR = join(options.dshHome, "empty-agent");
  delete process.env.DEEPSEEK_API_KEY;
  const service = new DshWebService({
    runtimeRoot: runtime, externalUrl: "", profile: "taosi-harness",
    freeModelArchivePath: archivePath,
    install: async () => ({ node, cli }),
    syncCredentials: async () => ({ status: "unchanged" }),
  });
  try {
    const status = await service.start();
    expect(status.state, status.message).toBe("running");
    expect(status.managed).toBe(true);
  } finally {
    await service.stop();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgent;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});
