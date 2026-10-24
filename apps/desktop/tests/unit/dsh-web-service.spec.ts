import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { parse } from "yaml";

import { makeUserDataDir } from "../helpers/electron-app";
import { checkDsBotInstalled, ensureHarnessProfile, resolveActiveDeepSeekKey, syncDshDeepSeekCredential } from "../../electron/dsh-web-service";

const VALID_KEY = "valid-pi-key";
const OTHER_VALID_KEY = "valid-dsh-key";
const testRoots: string[] = [];

test.afterEach(async () => {
  await Promise.all(testRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("detects whether ds-bot is installed in web profile", async () => {
  const root = await makeDshTestRoot("pi-gui-ds-bot-check-");
  const dshHome = join(root, "dsh");
  const webProfile = join(dshHome, "profiles", "web");

  expect(await checkDsBotInstalled({ dshHome })).toBe(false);

  await mkdir(join(webProfile, "node_modules", "ds-bot"), { recursive: true });
  await writeFile(
    join(webProfile, "package.json"),
    JSON.stringify({ dependencies: { "ds-bot": "^0.1.1" } }),
    "utf8",
  );
  await writeFile(
    join(webProfile, "node_modules", "ds-bot", "package.json"),
    JSON.stringify({ name: "ds-bot", version: "0.1.1" }),
    "utf8",
  );

  expect(await checkDsBotInstalled({ dshHome })).toBe(true);
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
  expect(parse(await readFile(credentialsPath, "utf8"))).toEqual({ version: 1, refs: { DEEPSEEK_API_KEY: VALID_KEY } });
  expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
  expect((await stat(join(agentDir, "auth.json"))).mode & 0o777).toBe(0o600);
});

test("prefers the configured Pi key over a different valid DSH key", async () => {
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

  expect(result).toEqual({ status: "synced", source: "pi" });
  expect(parse(await readFile(join(dshHome, ".credentials.yaml"), "utf8"))).toEqual({
    version: 1, refs: { DEEPSEEK_API_KEY: VALID_KEY },
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

  expect(result).toEqual({ status: "unchanged", source: "pi" });
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
  expect(parse(text)).toEqual({ version: 1, refs: { DEEPSEEK_API_KEY: VALID_KEY } });
});

test("uses valid Pi credentials even when DSH validation is unavailable", async () => {
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

  expect(result).toEqual({ status: "synced", source: "pi" });
  expect(parse(await readFile(credentialsPath, "utf8"))).toEqual({ version: 1, refs: { DEEPSEEK_API_KEY: VALID_KEY } });
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
  expect(parse(await readFile(credentialsPath, "utf8"))).toEqual({ version: 1, refs: { DEEPSEEK_API_KEY: VALID_KEY } });
});

test("imports a valid DSH key into Pi only when explicitly requested", async () => {
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
    importDshIntoPi: true,
  });

  expect(result).toEqual({ status: "synced", source: "dsh" });
  const authPath = join(agentDir, "auth.json");
  expect(JSON.parse(await readFile(authPath, "utf8"))).toEqual({
    openai: { type: "api_key", key: "keep-openai-key" },
    deepseek: { type: "api_key", key: VALID_KEY },
  });
  expect((await stat(authPath)).mode & 0o777).toBe(0o600);
});

test("does not restore Pi credentials from DSH after a provider logout", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-logged-out-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "auth.json"), "{}\n", "utf8");
  await mkdir(dshHome, { recursive: true });
  await writeFile(join(dshHome, ".credentials.yaml"), `version: 1\nrefs:\n  DEEPSEEK_API_KEY: ${VALID_KEY}\n`, "utf8");

  expect(await syncDshDeepSeekCredential({ agentDir, dshHome, environmentKey: null, fetchImpl: credentialFetch }))
    .toEqual({ status: "unchanged", source: "dsh" });
  expect(JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8"))).toEqual({});
  expect(await resolveActiveDeepSeekKey(dshHome, agentDir, null, credentialFetch, "dsh")).toBe(VALID_KEY);
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
    version: 1, refs: { DEEPSEEK_API_KEY: VALID_KEY },
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
    version: 1, refs: { DEEPSEEK_API_KEY: OTHER_VALID_KEY },
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
    importDshIntoPi: true,
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
    importDshIntoPi: true,
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
    version: 1, refs: { DEEPSEEK_API_KEY: VALID_KEY },
  });
  expect((await stat(authPath)).mode & 0o777).toBe(0o600);
});

test("repairs mixed v1 credentials offline, preserving refs, records and a private backup", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-mixed-v1-");
  const path = join(root, ".credentials.yaml");
  const original = "# account store\nversion: 1\nrefs:\n  DEEPSEEK_API_KEY: current-key\nrecords:\n  example/account:\n    kind: api-key\n    key: saved-account\nDEEPSEEK_API_KEY: legacy-key\n";
  await writeFile(path, original);
  const options = { dshHome: root, agentDir: join(root, "agent"), environmentKey: null,
    fetchImpl: async () => { throw new Error("offline"); } };
  await syncDshDeepSeekCredential(options);
  const migrated = await readFile(path, "utf8");
  expect(migrated).toContain("# account store");
  expect(parse(migrated)).toEqual({ version: 1, refs: { DEEPSEEK_API_KEY: "current-key" },
    records: { "example/account": { kind: "api-key", key: "saved-account" } } });
  const backups = (await readdir(root)).filter((name) => name.endsWith(".bak"));
  expect(backups).toHaveLength(1);
  expect(await readFile(join(root, backups[0]!), "utf8")).toBe(original);
  expect((await stat(join(root, backups[0]!))).mode & 0o777).toBe(0o600);
  await syncDshDeepSeekCredential(options);
  expect(await readFile(path, "utf8")).toBe(migrated);
  expect((await readdir(root)).filter((name) => name.endsWith(".bak"))).toEqual(backups);
});

test("writes nested v1 credentials without losing other references or records", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-write-v1-");
  const path = join(root, ".credentials.yaml");
  await writeFile(path, "version: 1\nrefs:\n  OTHER_KEY: keep\nrecords: {}\n");
  await syncDshDeepSeekCredential({ dshHome: root, agentDir: join(root, "agent"),
    environmentKey: VALID_KEY, fetchImpl: credentialFetch });
  expect(parse(await readFile(path, "utf8"))).toEqual({ version: 1,
    refs: { OTHER_KEY: "keep", DEEPSEEK_API_KEY: VALID_KEY }, records: {} });
});

test("migrates all flat references without network access", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-flat-v1-");
  const path = join(root, ".credentials.yaml");
  await writeFile(path, "# retain\nOTHER_KEY: another-key\nDEEPSEEK_API_KEY: offline-key\n");
  await syncDshDeepSeekCredential({ dshHome: root, agentDir: join(root, "agent"), environmentKey: null,
    fetchImpl: async () => { throw new Error("offline"); } });
  expect(parse(await readFile(path, "utf8"))).toEqual({ version: 1,
    refs: { OTHER_KEY: "another-key", DEEPSEEK_API_KEY: "offline-key" } });
});

for (const original of ["version: 2\nDEEPSEEK_API_KEY: secret\n", "version: 1\nunknown: secret\n", "DEEPSEEK_API_KEY: [secret]\n", "version: 1\nrefs: []\nDEEPSEEK_API_KEY: secret\n"]) {
  test(`refuses an unsupported layout without rewriting it: ${JSON.stringify(original)}`, async () => {
    const root = await makeDshTestRoot("pi-gui-dsh-unsupported-");
    const path = join(root, ".credentials.yaml");
    await writeFile(path, original);
    await expect(syncDshDeepSeekCredential({ dshHome: root, agentDir: join(root, "agent"), environmentKey: null }))
      .rejects.toThrow("Unsupported DSH credentials layout");
    expect(await readFile(path, "utf8")).toBe(original);
    expect((await readdir(root)).filter((name) => name.endsWith(".bak"))).toHaveLength(0);
  });
}

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

test("ensureHarnessProfile creates clean standard DSH profile without ds-bot", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-harness-profile-");
  const harnessDir = await ensureHarnessProfile(root);
  const pkg = JSON.parse(await readFile(join(harnessDir, "package.json"), "utf8"));
  expect(pkg.name).toBe("dsh-profile-taosi-harness");
  expect(pkg.dsh.profile.bundles).toEqual(["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]);
  expect(pkg.dependencies?.["ds-bot"]).toBeUndefined();
  expect(await readFile(join(harnessDir, "cordis.yml"), "utf8")).toBe("[]\n");
});

test("ensures the Taosi profile without modifying a user-owned Harness profile", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-user-profile-");
  const userProfile = join(root, "profiles", "harness");
  await mkdir(userProfile, { recursive: true });
  const original = JSON.stringify({ name: "my-harness", dependencies: { "ds-bot": "1.0.0" } });
  await writeFile(join(userProfile, "package.json"), original, "utf8");
  const appProfile = await ensureHarnessProfile(root);
  expect(appProfile).toBe(join(root, "profiles", "taosi-harness"));
  expect(await readFile(join(userProfile, "package.json"), "utf8")).toBe(original);
});

test("resolveActiveDeepSeekKey resolves key from credentials, auth.json, or env", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-resolve-key-");
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });

  // 1. None
  expect(await resolveActiveDeepSeekKey(root, agentDir, null)).toBeUndefined();

  // 2. From env
  expect(await resolveActiveDeepSeekKey(root, agentDir, "env-key")).toBe("env-key");

  // 3. From auth.json
  await writePiAuth(agentDir, "pi-stored-key");
  expect(await resolveActiveDeepSeekKey(root, agentDir, null)).toBe("pi-stored-key");

  // Pi stays authoritative over both a stale DSH key and a stale environment.
  await writeFile(join(root, ".credentials.yaml"), "version: 1\nrefs:\n  DEEPSEEK_API_KEY: dsh-stored-key\n", "utf8");
  expect(await resolveActiveDeepSeekKey(root, agentDir, "invalid-env-key", async () => new Response(null, { status: 200 }))).toBe("pi-stored-key");
  await rm(join(agentDir, "auth.json"));
  expect(await resolveActiveDeepSeekKey(root, agentDir, "invalid-env-key")).toBe("dsh-stored-key");
});

test("syncs Pi key into empty DSH credentials when network probe is unavailable", async () => {
  const root = await makeDshTestRoot("pi-gui-dsh-sync-offline-");
  const agentDir = join(root, "agent");
  await writePiAuth(agentDir, VALID_KEY);

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome: root,
    environmentKey: null,
    fetchImpl: async () => { throw new Error("offline"); },
  });

  expect(result).toEqual({ status: "synced", source: "pi" });
  const credentialsPath = join(root, ".credentials.yaml");
  expect(parse(await readFile(credentialsPath, "utf8"))).toEqual({
    version: 1, refs: { DEEPSEEK_API_KEY: VALID_KEY },
  });
});
