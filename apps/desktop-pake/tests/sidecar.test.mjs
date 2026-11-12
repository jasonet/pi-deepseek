import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
test("packaged Node backend supports state, files, terminal, code execution and persistence", { timeout: 60_000 }, async () => {
  await mkdir(join(root, "build/verification"), { recursive: true });
  const profile = await mkdtemp(join(root, "build/verification/sidecar-"));
  const workspace = join(profile, "workspace");
  await mkdir(workspace);
  await writeFile(join(workspace, "hello.md"), "# Pake verification\n");
  const resources = join(root, "build/resources");
  const log = await import("node:fs").then((fs) => fs.openSync(join(profile, "stderr.log"), "a", 0o600));
  const child = spawn(join(resources, "sidecar/node"), [join(resources, "sidecar/server.mjs")], {
    env: { ...process.env, PI_SIDECAR_HOST: "pake", PI_APP_RESOURCES_DIR: resources,
      PI_APP_USER_DATA_DIR: join(profile, "state"), PI_CODING_AGENT_DIR: join(profile, "agent"),
      PI_APP_INITIAL_WORKSPACES: workspace, PI_APP_TEST_MODE: "background", PI_APP_VERSION: "3.0.21", IM_WEBHOOK_PORT: "18791" },
    stdio: ["pipe", "pipe", log],
  });
  let next = 0;
  const pending = new Map();
  const events = [];
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out; see ${profile}/stderr.log`)); }, 20_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, args }) + "\n");
  });
  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    const value = JSON.parse(line);
    if (value.kind === "response") {
      const request = pending.get(value.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(value.id);
      value.ok ? request.resolve(value.result) : request.reject(new Error(value.error));
    } else if (value.kind === "event") {
      events.push(value);
      if (value.sequence) void call("pi-gui:renderer-snapshot-acknowledged", value.event, value.sequence);
    } else if (value.kind === "host") {
      child.stdin.write(JSON.stringify({ kind: "host-response", id: value.id, ok: true, result: value.method === "theme" ? "light" : null }) + "\n");
    }
  });
  child.on("exit", (code) => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(`Backend exited ${code}; see ${profile}/stderr.log`)); }
    pending.clear();
  });
  try {
    const state = await call("pi-gui:state-request");
    assert.equal(state.workspaces.length, 1);
    const id = state.workspaces[0].id;
    const preview = await call("pi-gui:preview-workspace-file", id, "hello.md");
    assert.equal(preview.ok, true);
    assert.match(preview.content, /Pake verification/);
    const panel = await call("pi-gui:terminal-ensure-panel", id, "verification", { cols: 80, rows: 24 });
    assert.equal(panel.sessions.length, 1);
    assert.equal(panel.sessions[0].status, "running");
    await call("pi-gui:terminal-write", panel.activeSessionId, "printf 'PAKE_TERMINAL_%s\\n' VERIFIED\r");
    const codeRun = await call("pi-gui:run-code-block", "printf PAKE_CODE_VERIFIED", workspace);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && (!events.some((v) => v.event === "pi-gui:terminal-data" && /PAKE_TERMINAL_VERIFIED/.test(v.payload.data))
      || !events.some((v) => v.event === "pi-gui:run-code-block-output" && v.payload.runId === codeRun && v.payload.exitCode === 0))) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(events.some((v) => v.event === "pi-gui:terminal-data" && /PAKE_TERMINAL_VERIFIED/.test(v.payload.data)), "real PTY produced output");
    assert(events.some((v) => v.event === "pi-gui:run-code-block-output" && v.payload.runId === codeRun && v.payload.chunk === "PAKE_CODE_VERIFIED"));
    await call("pi-gui:terminal-close-session", panel.activeSessionId);
    const preferences = await call("pi-gui:set-trading-preferences", { example: "crypto", autoPrepareExample: false });
    assert.equal(preferences.example, "crypto");
    assert.equal((await call("pi-gui:get-trading-preferences")).autoPrepareExample, false);
    const update = await call("pi-gui:get-update-status");
    assert.equal(update.currentVersion, "3.0.21");
    assert.equal((await call("pi-gui:get-dsh-web-status", "trading")).mode, undefined);
    await assert.rejects(call("taosi:no-such-method"), /Unknown method/);
    assert.equal(JSON.parse(await readFile(join(profile, "state/dsh-trading/taosi-preferences.json"))).example, "crypto");
    console.log(`Verification artifacts: ${profile}`);
  } finally {
    child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    reader.close();
  }
});
