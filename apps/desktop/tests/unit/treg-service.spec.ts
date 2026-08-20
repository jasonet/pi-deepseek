import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { DEFAULT_TREG_SETTINGS, normalizeSettings, TregService } from "../../electron/treg-service";

test("Treg is off by default and never returns a credential", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "pi-treg-default-"));
  const token = "treg-secret-not-for-renderer";
  const service = new TregService({ homeDir: home, env: { TREG_TOKEN: token } });

  const status = await service.getStatus(false);

  expect(status.settings).toEqual(DEFAULT_TREG_SETTINGS);
  expect(status.tokenConfigured).toBe(true);
  expect(status.tokenSource).toBe("env");
  expect(JSON.stringify(status)).not.toContain(token);
});

test("settings are normalized and written as a private policy file", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "pi-treg-policy-"));
  const policyPath = path.join(home, ".pi", "agent", "treg.json");
  const workspace = path.join(home, "workspace");
  const service = new TregService({ homeDir: home, policyPath, env: {} });

  const status = await service.saveSettings({
    enabled: true,
    piEnabled: true,
    harnessEnabled: false,
    serviceUrl: "http://127.0.0.1:4123/mcp",
    paidCalls: "disabled",
    allowMutatingCalls: false,
    workspaceRoots: [workspace, `${workspace}/../workspace`],
  });

  expect(status.settings.workspaceRoots).toEqual([workspace]);
  expect(status.settings.serviceUrl).toBe("http://127.0.0.1:4123/mcp");
  expect(JSON.parse(await readFile(policyPath, "utf8"))).toEqual(status.settings);
  if (process.platform !== "win32") expect((await stat(policyPath)).mode & 0o777).toBe(0o600);
});

test("official Treg config is detected and hardened without exposing its token", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "pi-treg-config-"));
  const configPath = path.join(home, ".treg", "config.json");
  const token = "config-token-private";
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({ token, active_org: "test" }), { mode: 0o644 });
  await chmod(configPath, 0o644);
  const service = new TregService({ homeDir: home, tregConfigPath: configPath, env: {} });

  const status = await service.getStatus(false);

  expect(status.tokenConfigured).toBe(true);
  expect(status.tokenSource).toBe("config");
  expect(JSON.stringify(status)).not.toContain(token);
  if (process.platform !== "win32") expect((await stat(configPath)).mode & 0o777).toBe(0o600);
});

test("non-loopback plain HTTP endpoints are rejected", () => {
  expect(() => normalizeSettings({ serviceUrl: "http://example.com/mcp" })).toThrow(/HTTPS/);
});

test("does not send a config-file token to a different Treg origin", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "pi-treg-origin-"));
  const configPath = path.join(home, ".treg", "config.json");
  const policyPath = path.join(home, ".pi", "agent", "treg.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  await mkdir(path.dirname(policyPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({ token: "self-hosted-private", base_url: "https://treg.internal.example" }));
  await writeFile(policyPath, JSON.stringify({ ...DEFAULT_TREG_SETTINGS, enabled: true }));
  const service = new TregService({ homeDir: home, tregConfigPath: configPath, policyPath, env: {} });

  const status = await service.getStatus();

  expect(status.connected).toBe(false);
  expect(status.message).toContain("different service URL");
});

test("disabling Harness removes the app-managed token without touching other DSH credentials", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "pi-treg-harness-"));
  const policyPath = path.join(home, "treg.json");
  const credentialsPath = path.join(home, ".credentials.yaml");
  const markerPath = path.join(home, "managed");
  await writeFile(policyPath, JSON.stringify({ ...DEFAULT_TREG_SETTINGS, enabled: true, harnessEnabled: true }));
  const token = "app-managed-treg-token";
  await writeFile(credentialsPath, `DEEPSEEK_API_KEY: ds-existing\nTREG_TOKEN: ${token}\n`);
  await writeFile(markerPath, `${createHash("sha256").update(token).digest("hex")}\n`);
  const service = new TregService({
    homeDir: home,
    policyPath,
    dshCredentialsPath: credentialsPath,
    dshManagedMarkerPath: markerPath,
    env: {},
  });

  await service.saveSettings({ ...DEFAULT_TREG_SETTINGS, enabled: true, harnessEnabled: false });

  const credentials = await readFile(credentialsPath, "utf8");
  expect(credentials).toContain("DEEPSEEK_API_KEY: ds-existing");
  expect(credentials).not.toContain("TREG_TOKEN");
});
