import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { parse } from "yaml";

import { makeUserDataDir } from "../helpers/electron-app";
import { syncDshDeepSeekCredential } from "../../electron/dsh-web-service";

const VALID_KEY = "valid-pi-key";
const OTHER_VALID_KEY = "valid-dsh-key";
const testRoots: string[] = [];

test.afterEach(async () => {
  await Promise.all(testRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("syncs a valid Pi key into the DSH credential store", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, VALID_KEY);

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: null,
    fetchImpl: credentialFetch,
  });

  expect(result).toEqual({ status: "synced", source: "pi" });
  const credentialsPath = join(dshHome, ".credentials.yaml");
  expect(parse(await readFile(credentialsPath, "utf8"))).toEqual({ DEEPSEEK_API_KEY: VALID_KEY });
  expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
  expect((await stat(join(agentDir, "auth.json"))).mode & 0o777).toBe(0o600);
});

test("keeps a valid DSH key instead of replacing it", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-existing-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, VALID_KEY);
  await mkdir(dshHome, { recursive: true });
  await writeFile(join(dshHome, ".credentials.yaml"), `DEEPSEEK_API_KEY: ${OTHER_VALID_KEY}\n`, "utf8");

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: null,
    fetchImpl: credentialFetch,
  });

  expect(result).toEqual({ status: "unchanged", source: "dsh" });
  expect(parse(await readFile(join(dshHome, ".credentials.yaml"), "utf8"))).toEqual({
    DEEPSEEK_API_KEY: OTHER_VALID_KEY,
  });
  expect((await stat(join(dshHome, ".credentials.yaml"))).mode & 0o777).toBe(0o600);
});

test("validates a shared Pi and DSH key only once", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-shared-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, VALID_KEY);
  await mkdir(dshHome, { recursive: true });
  await writeFile(join(dshHome, ".credentials.yaml"), `DEEPSEEK_API_KEY: ${VALID_KEY}\n`, "utf8");
  let validationCount = 0;

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: null,
    fetchImpl: async (input, init) => {
      validationCount += 1;
      return credentialFetch(input, init);
    },
  });

  expect(result).toEqual({ status: "unchanged", source: "dsh" });
  expect(validationCount).toBe(1);
});

test("replaces an invalid DSH key with the valid Pi key", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-invalid-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, VALID_KEY);
  await mkdir(dshHome, { recursive: true });
  const credentialsPath = join(dshHome, ".credentials.yaml");
  await writeFile(credentialsPath, "# keep this comment\nDEEPSEEK_API_KEY: invalid-key\n", "utf8");
  await chmod(credentialsPath, 0o600);

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: null,
    fetchImpl: credentialFetch,
  });

  expect(result).toEqual({ status: "synced", source: "pi" });
  const text = await readFile(credentialsPath, "utf8");
  expect(text).toContain("# keep this comment");
  expect(parse(text)).toEqual({ DEEPSEEK_API_KEY: VALID_KEY });
});

test("preserves a DSH key when validation is temporarily unavailable", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-unavailable-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, VALID_KEY);
  await mkdir(dshHome, { recursive: true });
  const credentialsPath = join(dshHome, ".credentials.yaml");
  await writeFile(credentialsPath, `DEEPSEEK_API_KEY: ${OTHER_VALID_KEY}\n`, "utf8");

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: null,
    fetchImpl: async (_input, init) => {
      const key = new Headers(init?.headers).get("authorization")?.replace(/^Bearer\s+/i, "");
      return new Response(null, { status: key === OTHER_VALID_KEY ? 503 : 200 });
    },
  });

  expect(result).toEqual({ status: "unavailable", source: "dsh" });
  expect(parse(await readFile(credentialsPath, "utf8"))).toEqual({ DEEPSEEK_API_KEY: OTHER_VALID_KEY });
  expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
});

test("does not overwrite a DSH key changed during validation", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-concurrent-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, VALID_KEY);
  await mkdir(dshHome, { recursive: true });
  const credentialsPath = join(dshHome, ".credentials.yaml");
  await writeFile(credentialsPath, "DEEPSEEK_API_KEY: invalid-key\n", "utf8");

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: null,
    fetchImpl: async (_input, init) => {
      const key = new Headers(init?.headers).get("authorization")?.replace(/^Bearer\s+/i, "");
      if (key === VALID_KEY) {
        await writeFile(credentialsPath, `DEEPSEEK_API_KEY: ${OTHER_VALID_KEY}\n`, "utf8");
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 401 });
    },
  });

  expect(result).toEqual({ status: "unchanged", source: "dsh" });
  expect(parse(await readFile(credentialsPath, "utf8"))).toEqual({ DEEPSEEK_API_KEY: OTHER_VALID_KEY });
});

test("respects the DSH credentials writer lock", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-writer-lock-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, VALID_KEY);
  await mkdir(dshHome, { recursive: true });
  const credentialsPath = join(dshHome, ".credentials.yaml");
  const lockPath = `${credentialsPath}.lock`;
  await writeFile(lockPath, "external-writer\n", { mode: 0o600 });

  let validationComplete!: () => void;
  const validated = new Promise<void>((resolveValidation) => {
    validationComplete = resolveValidation;
  });
  let settled = false;
  const sync = syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: null,
    fetchImpl: async (input, init) => {
      const response = await credentialFetch(input, init);
      validationComplete();
      return response;
    },
  });
  void sync.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  await validated;
  await new Promise((resolveTurn) => setImmediate(resolveTurn));
  expect(settled).toBe(false);
  await expect(readFile(credentialsPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  await rm(lockPath);

  expect(await sync).toEqual({ status: "synced", source: "pi" });
  expect(parse(await readFile(credentialsPath, "utf8"))).toEqual({ DEEPSEEK_API_KEY: VALID_KEY });
});

test("syncs a valid DSH key into Pi when Pi has no valid key", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-to-pi-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "auth.json"),
    `${JSON.stringify({ openai: { type: "api_key", key: "keep-openai-key" } }, null, 2)}\n`,
    "utf8",
  );
  await mkdir(dshHome, { recursive: true });
  await writeFile(join(dshHome, ".credentials.yaml"), `DEEPSEEK_API_KEY: ${VALID_KEY}\n`, "utf8");

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: null,
    fetchImpl: credentialFetch,
  });

  expect(result).toEqual({ status: "synced", source: "dsh" });
  const authPath = join(agentDir, "auth.json");
  expect(JSON.parse(await readFile(authPath, "utf8"))).toEqual({
    openai: { type: "api_key", key: "keep-openai-key" },
    deepseek: { type: "api_key", key: VALID_KEY },
  });
  expect((await stat(authPath)).mode & 0o777).toBe(0o600);
});

test("syncs a valid environment key into DSH without bundling or persisting it in Pi", async () => {
  const root = await makeDshTestRoot("pi-gui-env-to-dsh-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: VALID_KEY,
    fetchImpl: credentialFetch,
  });

  expect(result).toEqual({ status: "synced", source: "pi" });
  expect(parse(await readFile(join(dshHome, ".credentials.yaml"), "utf8"))).toEqual({
    DEEPSEEK_API_KEY: VALID_KEY,
  });
  await expect(readFile(join(agentDir, "auth.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test("uses Pi stored credentials before an environment key", async () => {
  const root = await makeDshTestRoot("pi-gui-stored-before-env-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, OTHER_VALID_KEY);
  const validatedKeys: string[] = [];

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: VALID_KEY,
    fetchImpl: async (input, init) => {
      validatedKeys.push(new Headers(init?.headers).get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
      return credentialFetch(input, init);
    },
  });

  expect(result).toEqual({ status: "synced", source: "pi" });
  expect(validatedKeys).toEqual([OTHER_VALID_KEY]);
  expect(parse(await readFile(join(dshHome, ".credentials.yaml"), "utf8"))).toEqual({
    DEEPSEEK_API_KEY: OTHER_VALID_KEY,
  });
});

test("does not copy a DSH key that changes during validation into Pi", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-source-race-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await mkdir(agentDir, { recursive: true });
  const authPath = join(agentDir, "auth.json");
  await writeFile(authPath, "{}\n", "utf8");
  await mkdir(dshHome, { recursive: true });
  const credentialsPath = join(dshHome, ".credentials.yaml");
  await writeFile(credentialsPath, `DEEPSEEK_API_KEY: ${VALID_KEY}\n`, "utf8");

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: null,
    fetchImpl: async () => {
      await writeFile(credentialsPath, `DEEPSEEK_API_KEY: ${OTHER_VALID_KEY}\n`, "utf8");
      return new Response(null, { status: 200 });
    },
  });

  expect(result).toEqual({ status: "unchanged", source: "dsh" });
  expect(JSON.parse(await readFile(authPath, "utf8"))).toEqual({});
});

test("merges concurrent Pi credential changes while syncing from DSH", async () => {
  const root = await makeDshTestRoot("pi-gui-pi-destination-race-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await mkdir(agentDir, { recursive: true });
  const authPath = join(agentDir, "auth.json");
  await writeFile(authPath, `${JSON.stringify({ openai: { type: "api_key", key: "openai-key" } })}\n`, "utf8");
  await mkdir(dshHome, { recursive: true });
  await writeFile(join(dshHome, ".credentials.yaml"), `DEEPSEEK_API_KEY: ${VALID_KEY}\n`, "utf8");

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: null,
    fetchImpl: async () => {
      await writeFile(
        authPath,
        `${JSON.stringify({ anthropic: { type: "api_key", key: "anthropic-key" } })}\n`,
        "utf8",
      );
      return new Response(null, { status: 200 });
    },
  });

  expect(result).toEqual({ status: "synced", source: "dsh" });
  expect(JSON.parse(await readFile(authPath, "utf8"))).toEqual({
    anthropic: { type: "api_key", key: "anthropic-key" },
    deepseek: { type: "api_key", key: VALID_KEY },
  });
});

test("does not copy a stale Pi key into DSH when Pi changes during validation", async () => {
  const root = await makeDshTestRoot("pi-gui-pi-source-race-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  const authPath = join(agentDir, "auth.json");
  await writePiAuth(agentDir, VALID_KEY);

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: null,
    fetchImpl: async () => {
      await writePiAuth(agentDir, OTHER_VALID_KEY);
      return new Response(null, { status: 200 });
    },
  });

  expect(result).toEqual({ status: "unchanged", source: "dsh" });
  expect(JSON.parse(await readFile(authPath, "utf8"))).toEqual({
    deepseek: { type: "api_key", key: OTHER_VALID_KEY },
  });
  await expect(readFile(join(dshHome, ".credentials.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test("does not replace a Pi key changed while validating the DSH source", async () => {
  const root = await makeDshTestRoot("pi-gui-pi-field-race-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, "invalid-key");
  const authPath = join(agentDir, "auth.json");
  await mkdir(dshHome, { recursive: true });
  await writeFile(join(dshHome, ".credentials.yaml"), `DEEPSEEK_API_KEY: ${VALID_KEY}\n`, "utf8");

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: null,
    fetchImpl: async (_input, init) => {
      const key = new Headers(init?.headers).get("authorization")?.replace(/^Bearer\s+/i, "");
      if (key === VALID_KEY) await writePiAuth(agentDir, OTHER_VALID_KEY);
      return new Response(null, { status: key === VALID_KEY ? 200 : 401 });
    },
  });

  expect(result).toEqual({ status: "unchanged", source: "dsh" });
  expect(JSON.parse(await readFile(authPath, "utf8"))).toEqual({
    deepseek: { type: "api_key", key: OTHER_VALID_KEY },
  });
});

test("uses a valid environment key without rewriting malformed Pi credentials", async () => {
  const root = await makeDshTestRoot("pi-gui-malformed-pi-env-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await mkdir(agentDir, { recursive: true });
  const authPath = join(agentDir, "auth.json");
  await writeFile(authPath, "{malformed", "utf8");

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    environmentKey: VALID_KEY,
    fetchImpl: credentialFetch,
  });

  expect(result).toEqual({ status: "synced", source: "pi" });
  expect(await readFile(authPath, "utf8")).toBe("{malformed");
  expect(parse(await readFile(join(dshHome, ".credentials.yaml"), "utf8"))).toEqual({
    DEEPSEEK_API_KEY: VALID_KEY,
  });
  expect((await stat(authPath)).mode & 0o777).toBe(0o600);
});

async function writePiAuth(agentDir: string, apiKey: string): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "auth.json"),
    `${JSON.stringify({ deepseek: { type: "api_key", key: apiKey } }, null, 2)}\n`,
    "utf8",
  );
}

async function makeDshTestRoot(prefix: string): Promise<string> {
  const root = await makeUserDataDir(prefix);
  testRoots.push(root);
  return root;
}

async function credentialFetch(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const authorization = new Headers(init?.headers).get("authorization");
  const key = authorization?.replace(/^Bearer\s+/i, "");
  return new Response(null, { status: key === VALID_KEY || key === OTHER_VALID_KEY ? 200 : 401 });
}
