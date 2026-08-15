import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { parse } from "yaml";

import { makeUserDataDir } from "../helpers/electron-app";
import { syncDshDeepSeekCredential } from "../../electron/dsh-web-service";

const VALID_KEY = "valid-pi-key";
const OTHER_VALID_KEY = "valid-dsh-key";

test("syncs a valid Pi key into the DSH credential store", async () => {
  const root = await makeUserDataDir("pi-gui-dsh-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, VALID_KEY);

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    fetchImpl: credentialFetch,
  });

  expect(result).toEqual({ status: "synced", source: "pi" });
  const credentialsPath = join(dshHome, ".credentials.yaml");
  expect(parse(await readFile(credentialsPath, "utf8"))).toEqual({ DEEPSEEK_API_KEY: VALID_KEY });
  expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
});

test("keeps a valid DSH key instead of replacing it", async () => {
  const root = await makeUserDataDir("pi-gui-dsh-existing-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, VALID_KEY);
  await mkdir(dshHome, { recursive: true });
  await writeFile(join(dshHome, ".credentials.yaml"), `DEEPSEEK_API_KEY: ${OTHER_VALID_KEY}\n`, "utf8");

  const result = await syncDshDeepSeekCredential({ agentDir, dshHome, fetchImpl: credentialFetch });

  expect(result).toEqual({ status: "unchanged", source: "dsh" });
  expect(parse(await readFile(join(dshHome, ".credentials.yaml"), "utf8"))).toEqual({
    DEEPSEEK_API_KEY: OTHER_VALID_KEY,
  });
  expect((await stat(join(dshHome, ".credentials.yaml"))).mode & 0o777).toBe(0o600);
});

test("validates a shared Pi and DSH key only once", async () => {
  const root = await makeUserDataDir("pi-gui-dsh-shared-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, VALID_KEY);
  await mkdir(dshHome, { recursive: true });
  await writeFile(join(dshHome, ".credentials.yaml"), `DEEPSEEK_API_KEY: ${VALID_KEY}\n`, "utf8");
  let validationCount = 0;

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
    fetchImpl: async (input, init) => {
      validationCount += 1;
      return credentialFetch(input, init);
    },
  });

  expect(result).toEqual({ status: "unchanged", source: "dsh" });
  expect(validationCount).toBe(1);
});

test("replaces an invalid DSH key with the valid Pi key", async () => {
  const root = await makeUserDataDir("pi-gui-dsh-invalid-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, VALID_KEY);
  await mkdir(dshHome, { recursive: true });
  const credentialsPath = join(dshHome, ".credentials.yaml");
  await writeFile(credentialsPath, "# keep this comment\nDEEPSEEK_API_KEY: invalid-key\n", "utf8");
  await chmod(credentialsPath, 0o600);

  const result = await syncDshDeepSeekCredential({ agentDir, dshHome, fetchImpl: credentialFetch });

  expect(result).toEqual({ status: "synced", source: "pi" });
  const text = await readFile(credentialsPath, "utf8");
  expect(text).toContain("# keep this comment");
  expect(parse(text)).toEqual({ DEEPSEEK_API_KEY: VALID_KEY });
});

test("preserves a DSH key when validation is temporarily unavailable", async () => {
  const root = await makeUserDataDir("pi-gui-dsh-unavailable-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, VALID_KEY);
  await mkdir(dshHome, { recursive: true });
  const credentialsPath = join(dshHome, ".credentials.yaml");
  await writeFile(credentialsPath, `DEEPSEEK_API_KEY: ${OTHER_VALID_KEY}\n`, "utf8");

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
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
  const root = await makeUserDataDir("pi-gui-dsh-concurrent-credentials-");
  const agentDir = join(root, "agent");
  const dshHome = join(root, "dsh");
  await writePiAuth(agentDir, VALID_KEY);
  await mkdir(dshHome, { recursive: true });
  const credentialsPath = join(dshHome, ".credentials.yaml");
  await writeFile(credentialsPath, "DEEPSEEK_API_KEY: invalid-key\n", "utf8");

  const result = await syncDshDeepSeekCredential({
    agentDir,
    dshHome,
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

async function writePiAuth(agentDir: string, apiKey: string): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "auth.json"),
    `${JSON.stringify({ deepseek: { type: "api_key", key: apiKey } }, null, 2)}\n`,
    "utf8",
  );
}

async function credentialFetch(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const authorization = new Headers(init?.headers).get("authorization");
  const key = authorization?.replace(/^Bearer\s+/i, "");
  return new Response(null, { status: key === VALID_KEY || key === OTHER_VALID_KEY ? 200 : 401 });
}
