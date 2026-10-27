import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { DshWebService } from "../../electron/dsh-web-service";

test("Trading service uses its own home and strips unrelated credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "trading-isolation-"));
  const home = join(root, "dsh-trading");
  const research = join(home, "research");
  const agent = join(root, "agent");
  await mkdir(research, { recursive: true });
  await mkdir(agent, { recursive: true });
  const cli = join(root, "fixture.cjs");
  await writeFile(cli, `const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(join(root, "result.json"))}, JSON.stringify({home: process.env.DSH_HOME, cwd: process.cwd(), exchange: Boolean(process.env.BINANCE_API_KEY), aws: Boolean(process.env.AWS_ACCESS_KEY_ID)}));
require('node:http').createServer((req, res) => res.end('ok')).listen(0, '127.0.0.1', function() { console.log('dsh web: http://127.0.0.1:' + this.address().port + '/'); });\n`);
  const saved = { agent: process.env.PI_CODING_AGENT_DIR, binance: process.env.BINANCE_API_KEY, aws: process.env.AWS_ACCESS_KEY_ID };
  process.env.PI_CODING_AGENT_DIR = agent;
  process.env.BINANCE_API_KEY = "fixture-only";
  process.env.AWS_ACCESS_KEY_ID = "fixture-only";
  const service = new DshWebService({
    runtimeRoot: root, dshHome: home, workingDirectory: research, profile: "trading-web",
    externalUrl: "", isolateCredentials: true, launchTimeoutMs: 5000,
    install: async () => ({ node: process.execPath, cli }),
    syncCredentials: async () => ({ status: "unavailable" }),
  });
  try {
    expect((await service.start()).state).toBe("running");
    expect(JSON.parse(await readFile(join(root, "result.json"), "utf8"))).toEqual({ home, cwd: await realpath(research), exchange: false, aws: false });
  } finally {
    await service.shutdown();
    for (const [key, value] of [["PI_CODING_AGENT_DIR", saved.agent], ["BINANCE_API_KEY", saved.binance], ["AWS_ACCESS_KEY_ID", saved.aws]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("profile preparation never modifies an unowned profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "trading-unowned-"));
  const source = join(root, "source");
  const home = join(root, "dsh-trading");
  const profile = join(home, "profiles/trading-web");
  await mkdir(join(source, "desktop/src"), { recursive: true });
  await writeFile(join(source, "desktop/src/runtime.cjs"), "module.exports = {};\n");
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "package.json"), '{"name":"user-owned"}\n');
  const helper = join(process.cwd(), "apps/desktop/resources/trading/prepare-profile.cjs");
  await expect(promisify(execFile)(process.execPath, [helper, source, home, root])).rejects.toThrow("not Taosi-managed");
  expect(await readFile(join(profile, "package.json"), "utf8")).toBe('{"name":"user-owned"}\n');
  await expect(readFile(join(home, ".legacy-home-migrated.json"))).rejects.toMatchObject({ code: "ENOENT" });
});
