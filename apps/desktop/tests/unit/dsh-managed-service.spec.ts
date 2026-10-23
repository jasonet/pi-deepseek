import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { parse } from "yaml";
import { DshWebService } from "../../electron/dsh-web-service";
import { dshOutputLines, sanitizeDshLog } from "../../electron/dsh-managed-runtime";
import { applyPojiaDsh, POJIA_PERSONA, verifyPojiaDsh } from "../../electron/pojia-dsh";
import { makeUserDataDir } from "../helpers/electron-app";

test("Pojia patches base and web overlay, keeps originals, and detects drift", async () => {
  const root = await makeUserDataDir("pojia-patch-");
  const base = join(root, "node_modules/@deepseek-ai");
  const instructionsPath = join(base, "dsh-agent-instructions/lib/index.js");
  const instructions = 'const AGENT_INSTRUCTIONS_INTRO = "original";\nconst REPLACEMENT_AGENT_INSTRUCTIONS_INTRO = "replacement";\nconst scope = "Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.";';
  const files = [
    [instructionsPath, instructions],
    [join(base, "dsh-base/cordis.patch.yml"), "- insert:\n    - id: system-prompt\n      config:\n        personaPrefix: ''\n    - id: tools\n      disabled: !!js '!ctx'\n"],
    [join(base, "dsh-web-app/cordis.patch.yml"), "- id: system-prompt\n  config:\n    personaPrefix: old web persona\n    personaSuffix: 'Working directory: {{cwd}}'\n"],
    [join(base, "dsh-client-connection/lib/index.js"), 'const attributes = "; HttpOnly; SameSite=Strict";'],
  ];
  for (const [path, content] of files) {
    await mkdir(dirname(path!), { recursive: true });
    await writeFile(path!, content!);
  }
  await applyPojiaDsh(root);
  expect(await verifyPojiaDsh(root)).toBe(true);
  expect(await readFile(`${instructionsPath}.pojia-original`, "utf8")).toBe(instructions);
  const config = parse(await readFile(files[2]![0]!, "utf8"));
  expect(config[0].config.personaPrefix).toBe(POJIA_PERSONA);
  expect(config[0].config.personaSuffix).toContain("{{cwd}}");
  expect(await readFile(files[3]![0]!, "utf8")).toContain("HttpOnly; SameSite=None; Secure; Partitioned");
  await writeFile(instructionsPath, "changed");
  expect(await verifyPojiaDsh(root)).toBe(false);
  await expect(applyPojiaDsh(root)).rejects.toThrow("不兼容");
  expect(await readFile(`${instructionsPath}.pojia-original`, "utf8")).toBe(instructions);
});

async function serviceFixture(hang = false) {
  const root = await makeUserDataDir("dsh-managed-service-");
  const cli = join(root, "dsh.cjs");
  await writeFile(cli, hang ? "setInterval(() => {}, 1000);" : `
const server = require('http').createServer((req, res) => {
  if (req.url === '/?token=private-token') {
    res.writeHead(303, {location: './', 'set-cookie': 'session=valid; HttpOnly'}); res.end();
  } else if (req.headers.cookie === 'session=valid') res.end('harness ready');
  else {res.writeHead(401); res.end('authentication required');}
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write('dsh web: http://127.0.0.1:' + server.address().port + '/?token=');
  setTimeout(() => console.log('private-token'), 20);
});
`);
  let installs = 0;
  const service = new DshWebService({
    runtimeRoot: root, externalUrl: "", launchTimeoutMs: hang ? 150 : 5000,
    syncCredentials: async () => ({ status: "unchanged" }),
    install: async (_root, _signal, report) => {
      installs++;
      report({ phase: "dependencies", line: "installing" });
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { node: process.execPath, cli };
    },
  });
  return { service, installs: () => installs };
}

test("single-flight start reports progress and restart replaces only the owned server", async () => {
  const { service, installs } = await serviceFixture();
  try {
    const first = service.start();
    expect(service.start()).toBe(first);
    expect((await service.getStatus()).state).toBe("installing");
    const running = await first;
    expect(running.state).toBe("running");
    expect(installs()).toBe(1);
    expect(running.logs?.join("\n")).not.toContain("private-token");
    expect(running.pid).toBeGreaterThan(0);
    const restart = service.restart();
    expect(service.restart()).toBe(restart);
    const restarted = await restart;
    expect(restarted.state).toBe("running");
    expect(restarted.pid).not.toBe(running.pid);
    expect(() => process.kill(running.pid!, 0)).toThrow();
  } finally { await service.stop(); }
  expect((await service.getStatus()).state).toBe("idle");
});

test("launch timeout terminates the server and permits retry", async () => {
  const { service } = await serviceFixture(true);
  try {
    const result = await service.start();
    expect(result.state).toBe("error");
    if (result.state === "error") expect(result.message).toContain("超时");
    expect((await service.start()).state).toBe("error");
  } finally { await service.stop(); }
});

test("stop aborts an installation and never launches after cancellation", async () => {
  let aborted = false;
  const service = new DshWebService({ runtimeRoot: "/unused", externalUrl: "", install: async (_root, signal) => {
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => {
      aborted = true;
      reject(new Error("aborted"));
    }, { once: true }));
    throw new Error("unreachable");
  } });
  const starting = service.start();
  expect((await service.stop()).state).toBe("idle");
  await starting;
  expect(aborted).toBe(true);
  expect((await service.getStatus()).state).toBe("idle");
});

test("diagnostics redact URL authentication and API credentials", () => {
  expect(sanitizeDshLog("dsh web: http://127.0.0.1:123/?token=secret sk-abcdef api_key=anything"))
    .toBe("dsh web: http://127.0.0.1:123/?token=[redacted] [redacted] api_key=[redacted]");
  expect(sanitizeDshLog("Authorization: Bearer private-token https://user:password@registry.example.org/pkg"))
    .toBe("Authorization: [redacted] https://[redacted]@registry.example.org/pkg");
});

test("output buffering never exposes partial tokens or broken UTF-8", () => {
  const logs: string[] = [];
  const read = dshOutputLines((line) => logs.push(sanitizeDshLog(line)));
  read(Buffer.from("dsh web: http://127.0.0.1/?tok"));
  read(Buffer.from("en=private-token\n"));
  const chinese = Buffer.from("安装完成\n");
  read(chinese.subarray(0, 2));
  read(chinese.subarray(2));
  expect(logs).toEqual(["dsh web: http://127.0.0.1/?token=[redacted]", "安装完成"]);
});

test("shutdown prevents a pending restart from resurrecting the process", async () => {
  const { service, installs } = await serviceFixture();
  const start = service.start();
  const restart = service.restart();
  await service.shutdown();
  await Promise.all([start, restart]);
  expect(installs()).toBe(1);
  expect((await service.getStatus()).state).toBe("idle");
  expect((await service.start()).state).toBe("idle");
});
