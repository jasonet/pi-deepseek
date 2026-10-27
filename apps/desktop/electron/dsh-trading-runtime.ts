import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import lockfile from "proper-lockfile";
import { ensureDshNodeRuntime, isCredentialEnvironmentName, runInstaller, type DshInstallReporter, type DshRuntime } from "./dsh-managed-runtime";
import { patchDshEmbedding } from "./dsh-embedding";

export const TRADING_REVISION = "36cc7afe1ccd2fba4d76142873ef6ea400b4128b";
export const TRADING_ARCHIVE = "dsh-trading-36cc7afe.tar.gz";
const SOURCE_SHA256 = "0382193c9adddf953137cd8da943ceab5aa18301618742a7c2a447e056508645";
const INSTALL_REVISION = 1;

export interface TradingRuntimeOptions {
  readonly resources: string;
  readonly nodeRoot: string;
  readonly dshHome: string;
  readonly parentOrigin?: string;
}

function installEnvironment(node: string, toolchain: string, root: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !isCredentialEnvironmentName(name) && !/^(?:NODE_OPTIONS|ELECTRON_RUN_AS_NODE|PI_CODING_AGENT_DIR)$/i.test(name)));
  return {
    ...env,
    PATH: [join(toolchain, "node_modules", ".bin"), dirname(node), env.PATH ?? ""].join(delimiter),
    CI: "1", npm_config_cache: join(root, "npm-cache"),
    npm_config_update_notifier: "false",
  };
}

export async function ensureTradingRuntime(
  root: string, signal: AbortSignal, report: DshInstallReporter, options: TradingRuntimeOptions,
): Promise<DshRuntime> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lockController = new AbortController();
  const bounded = AbortSignal.any([signal, lockController.signal, AbortSignal.timeout(30 * 60_000)]);
  const release = await lockfile.lock(root, { stale: 60_000, retries: { retries: 0 }, onCompromised: (error) => lockController.abort(error) }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") throw new Error("交易运行时正在另一个窗口安装，请稍后重试。");
    throw error;
  });
  try {
    const { node, npm } = await ensureDshNodeRuntime(options.nodeRoot, bounded, report);
    const runtime = join(root, `runtime-${TRADING_REVISION.slice(0, 8)}-${INSTALL_REVISION}`);
    const source = join(runtime, "source");
    const host = join(source, "desktop/resources/runtime/host");
    const cli = join(host, "node_modules/@deepseek-ai/dsh/lib/bin.js");
    const receiptPath = join(runtime, "taosi-trading.json");
    const receipt = await readFile(receiptPath, "utf8").catch(() => "");
    const required = [cli, join(source, "desktop/resources/runtime/VERSION.json"),
      join(source, "desktop/resources/runtime/profile-trading/package.json"), join(source, "desktop/src/runtime.cjs")];
    const ready = receipt === SOURCE_SHA256 && (await Promise.all(required.map((file) => access(file).then(() => true, () => false)))).every(Boolean);
    if (!ready) {
      const archive = join(options.resources, TRADING_ARCHIVE);
      const hash = createHash("sha256").update(await readFile(archive)).digest("hex");
      if (hash !== SOURCE_SHA256) throw new Error("内置交易源码校验失败，请重新安装 Taosi。");
      const staging = join(root, `install-${randomUUID()}`);
      const stagingSource = join(staging, "source");
      const toolchain = join(staging, "toolchain");
      await mkdir(stagingSource, { recursive: true, mode: 0o700 });
      const env = installEnvironment(node, toolchain, root);
      report({ phase: "dependencies", progress: undefined, line: "校验通过，展开固定版本 dsh-trading 源码" });
      await runInstaller("tar", ["-xzf", archive, "-C", stagingSource], bounded, report, env);
      report({ phase: "dependencies", line: "安装独立构建工具 pnpm 11.9.0" });
      await runInstaller(node, [npm, "install", "--prefix", toolchain, "--ignore-scripts", "--no-audit", "--no-fund", "pnpm@11.9.0"], bounded, report, env);
      const pnpm = join(toolchain, "node_modules/pnpm/bin/pnpm.cjs");
      report({ phase: "dependencies", line: "安装交易组件依赖（首次需要网络，后续直接复用）" });
      await runInstaller(node, [pnpm, "install", "--frozen-lockfile"], bounded, report, env, stagingSource);
      report({ phase: "dependencies", line: "构建市场插件及独立 DSH 0.2.1-rc.2 宿主" });
      await runInstaller(node, [join(stagingSource, "desktop/scripts/build-runtime.mjs")], bounded, report, env, stagingSource);
      await patchEmbedding(join(stagingSource, "desktop/resources/runtime/host"));
      await writeFile(join(staging, "taosi-trading.json"), SOURCE_SHA256, { mode: 0o600 });
      bounded.throwIfAborted();
      if (await access(runtime).then(() => true, () => false)) await rename(runtime, `${runtime}-backup-${randomUUID()}`);
      await rename(staging, runtime);
    }
    report({ phase: "pojia", progress: undefined, line: "初始化 Taosi 独立交易工作区，保留模拟交易与人工审批闸门" });
    await mkdir(join(options.dshHome, "research"), { recursive: true, mode: 0o700 });
    await runInstaller(node, [join(options.resources, "prepare-profile.cjs"), source, options.dshHome, options.resources, options.parentOrigin ?? "file"],
      bounded, report, installEnvironment(node, join(runtime, "toolchain"), root));
    return {
      node, cli,
      nodeArgs: ["--max-http-header-size=65536", ...["host-symbol-normalizer.mjs", "host-exit-tracer.mjs", "host-orphan-guard.mjs"]
        .flatMap((file) => ["--import", pathToFileURL(join(source, "desktop/src", file)).href])],
    };
  } finally {
    await release();
  }
}

async function patchEmbedding(host: string): Promise<void> {
  const path = join(host, "node_modules/@deepseek-ai/dsh-client-connection/lib/index.js");
  const text = await readFile(path, "utf8");
  const patched = patchDshEmbedding(text, true);
  if (patched !== text) await writeFile(path, patched);
}
