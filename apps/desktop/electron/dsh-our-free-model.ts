import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parseDocument } from "yaml";

import { withDshFileLock } from "./dsh-file-lock";

const execFileAsync = promisify(execFile);
const PROFILE = "taosi-harness";
const PACKAGE = "dsh-our-free-model";
const VERSION = "2.5.9";
export const DSH_FREE_MODEL_ARCHIVE = `dsh-our-free-model-${VERSION}.tgz`;
const ARCHIVE_SHA256 = "a0f36ccd8bae41138a9ea48927905a795b4dc3c9944dda977958c0810378a385";
const FREE_MODEL = "kilo-auto/free";
const OWNED_DEFAULT = { id: "agent-default-model", config: { provider: "our-free-model", model: FREE_MODEL } };
const OWNED_PLUGIN = { id: "our-free-model", config: { distribution: "managed" } };

export type DshFreeModelMode = "auto" | "free";

export interface DshFreeModelStatus {
  readonly available: boolean;
  readonly installed: boolean;
  readonly version?: string;
  readonly enabled: boolean;
  readonly mode: DshFreeModelMode;
  readonly effectiveDefault: "free" | "official" | "custom";
}

export interface DshFreeModelOptions {
  readonly dshHome?: string;
  readonly archivePath?: string;
}

interface Preference {
  readonly version: 1;
  readonly enabled: boolean;
  readonly mode: DshFreeModelMode;
}

const DEFAULT_PREFERENCE: Preference = { version: 1, enabled: false, mode: "auto" };

function profileDir(options: DshFreeModelOptions): string {
  const home = options.dshHome?.trim() || process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
  return join(resolve(home), "profiles", PROFILE);
}

function preferencePath(profile: string): string {
  return join(profile, "taosi-free-model.json");
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readPreference(profile: string): Promise<Preference> {
  const text = await readOptional(preferencePath(profile));
  if (!text) return DEFAULT_PREFERENCE;
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.version !== 1 || typeof value.enabled !== "boolean"
    || (value.mode !== "auto" && value.mode !== "free")) {
    throw new Error("Taosi 免费模型配置格式无效，请检查 taosi-free-model.json。");
  }
  return value as unknown as Preference;
}

async function writePrivateFile(path: string, text: string): Promise<void> {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function assertNotUserInstalled(profile: string): Promise<void> {
  const packageText = await readOptional(join(profile, "package.json"));
  const manifest: unknown = packageText ? JSON.parse(packageText) : undefined;
  const dependencies = isRecord(manifest) && isRecord(manifest.dependencies) ? manifest.dependencies : undefined;
  const bundles = isRecord(manifest) && isRecord(manifest.dsh) && isRecord(manifest.dsh.profile)
    ? manifest.dsh.profile.bundles : undefined;
  const patchText = await readOptional(join(profile, "cordis.patch.yml"));
  const rows = patchText ? parsePatch(patchText).toJS() as unknown[] : [];
  if (await installedVersion(profile) || dependencies?.[PACKAGE]
    || (Array.isArray(bundles) && bundles.includes(PACKAGE))
    || rows.some((row) => isRecord(row) && (row.id === "our-free-model"
      || (Array.isArray(row.insert) && row.insert.some((entry: unknown) => isRecord(entry) && entry.id === "our-free-model"))))) {
    throw new Error("Taosi Harness 已有手工安装的免费模型插件，不会接管或覆盖。请先检查该 profile。");
  }
}

async function archiveAvailable(path: string | undefined): Promise<boolean> {
  if (!path) return false;
  try {
    const bytes = await readFile(path);
    return createHash("sha256").update(bytes).digest("hex") === ARCHIVE_SHA256;
  } catch {
    return false;
  }
}

async function installedVersion(profile: string): Promise<string | undefined> {
  const text = await readOptional(join(profile, "node_modules", PACKAGE, "package.json"));
  if (!text) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) && value.name === PACKAGE && typeof value.version === "string"
      ? value.version
      : undefined;
  } catch {
    return undefined;
  }
}

export async function getDshFreeModelStatus(options: DshFreeModelOptions = {}): Promise<DshFreeModelStatus> {
  const profile = profileDir(options);
  const preference = await readPreference(profile);
  const version = await installedVersion(profile);
  const packageText = await readOptional(join(profile, "package.json"));
  const manifest: unknown = packageText ? JSON.parse(packageText) : undefined;
  const bundles = isRecord(manifest) && isRecord(manifest.dsh) && isRecord(manifest.dsh.profile)
    ? manifest.dsh.profile.bundles
    : undefined;
  const enabled = preference.enabled && Array.isArray(bundles) && bundles.includes(PACKAGE);
  const patchText = await readOptional(join(profile, "cordis.patch.yml"));
  const rows = patchText ? parsePatch(patchText).toJS() as unknown : [];
  const defaultRow = Array.isArray(rows) ? rows.find((row) => isRecord(row) && row.id === "agent-default-model") : undefined;
  const config = isRecord(defaultRow) && isRecord(defaultRow.config) ? defaultRow.config : undefined;
  const effectiveDefault = enabled && config?.provider === "our-free-model"
    ? "free"
    : config && config.provider !== "deepseek-official" ? "custom" : "official";
  return {
    available: await archiveAvailable(options.archivePath),
    installed: Boolean(version),
    version,
    enabled,
    mode: preference.mode,
    effectiveDefault,
  };
}

export async function setDshFreeModelConfig(
  input: { readonly enabled: boolean; readonly mode: DshFreeModelMode },
  options: DshFreeModelOptions & { readonly hasDeepSeekKey: boolean },
): Promise<DshFreeModelStatus> {
  if (typeof input.enabled !== "boolean" || (input.mode !== "auto" && input.mode !== "free")) {
    throw new Error("无效的免费模型设置。");
  }
  const profile = profileDir(options);
  const path = preferencePath(profile);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await withDshFileLock(path, async () => {
    if (!await readOptional(path)) {
      await assertNotUserInstalled(profile);
      await writePrivateFile(path, JSON.stringify(DEFAULT_PREFERENCE, null, 2) + "\n");
    }
    if (input.enabled) await ensureBundledPackage(profile, options.archivePath);
    await applyProfileConfig(profile, input.enabled, input.mode, options.hasDeepSeekKey);
    await writePrivateFile(path, JSON.stringify({ version: 1, ...input }, null, 2) + "\n");
  });
  return getDshFreeModelStatus(options);
}

export async function prepareDshFreeModel(
  options: DshFreeModelOptions & { readonly hasDeepSeekKey: boolean },
): Promise<DshFreeModelStatus> {
  const profile = profileDir(options);
  if (!await readOptional(preferencePath(profile))) return getDshFreeModelStatus(options);
  await withDshFileLock(preferencePath(profile), async () => {
    const preference = await readPreference(profile);
    if (!preference.enabled) return;
    await ensureBundledPackage(profile, options.archivePath);
    await applyProfileConfig(profile, true, preference.mode, options.hasDeepSeekKey);
  });
  return getDshFreeModelStatus(options);
}

async function ensureBundledPackage(profile: string, archivePath: string | undefined): Promise<void> {
  if (!archivePath || !await archiveAvailable(archivePath)) {
    throw new Error("内置免费模型包缺失或校验失败，请重新安装 Taosi。");
  }
  const vendor = join(profile, "vendor");
  const target = join(profile, "node_modules", PACKAGE);
  const existing = await installedVersion(profile);
  if (existing && existing !== VERSION) throw new Error(`已有 ${PACKAGE} v${existing}，不会覆盖这份现存安装。`);
  await mkdir(vendor, { recursive: true, mode: 0o700 });
  if (!await archiveAvailable(join(vendor, DSH_FREE_MODEL_ARCHIVE))) {
    await copyFile(archivePath, join(vendor, DSH_FREE_MODEL_ARCHIVE));
  }
  if (existing === VERSION) return;
  const staging = await mkdtemp(join(profile, ".free-model-stage-"));
  try {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", staging], { windowsHide: true });
    const candidate = join(staging, "package");
    const packageJson: unknown = JSON.parse(await readFile(join(candidate, "package.json"), "utf8"));
    if (!isRecord(packageJson) || packageJson.name !== PACKAGE || packageJson.version !== VERSION) {
      throw new Error("内置免费模型包内容与固定版本不符。");
    }
    await mkdir(join(profile, "node_modules"), { recursive: true, mode: 0o700 });
    try {
      await rename(candidate, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST"
        || (error as NodeJS.ErrnoException).code === "ENOTEMPTY") {
        throw new Error(`已有无法识别的 ${PACKAGE} 安装，不会覆盖。`);
      }
      throw error;
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function applyProfileConfig(
  profile: string,
  enabled: boolean,
  mode: DshFreeModelMode,
  hasDeepSeekKey: boolean,
): Promise<void> {
  const packagePath = join(profile, "package.json");
  const patchPath = join(profile, "cordis.patch.yml");
  const packageText = await readOptional(packagePath);
  if (!packageText) throw new Error("Taosi Harness profile 尚未初始化。");
  const manifest: unknown = JSON.parse(packageText);
  if (!isRecord(manifest) || !isRecord(manifest.dsh) || !isRecord(manifest.dsh.profile)
    || !Array.isArray(manifest.dsh.profile.bundles)) {
    throw new Error("Taosi Harness profile 格式无效。");
  }
  const dependencies = isRecord(manifest.dependencies) ? { ...manifest.dependencies } : {};
  const ownedDependency = `file:./vendor/${DSH_FREE_MODEL_ARCHIVE}`;
  if (dependencies[PACKAGE] !== undefined && dependencies[PACKAGE] !== ownedDependency) {
    throw new Error("免费模型依赖已被手动修改，不会覆盖该配置。");
  }
  if (manifest.dsh.profile.bundles.includes(PACKAGE) && dependencies[PACKAGE] === undefined) {
    throw new Error("免费模型 bundle 已被手动修改，不会覆盖该配置。");
  }
  const bundles = (manifest.dsh.profile.bundles as unknown[]).filter((name) => name !== PACKAGE);
  if (enabled) {
    dependencies[PACKAGE] = ownedDependency;
    bundles.push(PACKAGE);
  } else {
    delete dependencies[PACKAGE];
  }
  manifest.dependencies = dependencies;
  manifest.dsh.profile.bundles = bundles;

  const doc = parsePatch((await readOptional(patchPath)) ?? "[]\n");
  const rows = doc.toJS() as unknown[];
  const legacyInsert = rows.some((row) => isRecord(row) && Array.isArray(row.insert)
    && row.insert.some((entry: unknown) => isRecord(entry) && entry.id === "our-free-model"));
  if (legacyInsert) throw new Error("Taosi Harness 存在旧版重复加载配置，请先检查 cordis.patch.yml。");
  const pluginIndex = rows.findIndex((row) => isRecord(row) && row.id === "our-free-model");
  const defaultIndex = rows.findIndex((row) => isRecord(row) && row.id === "agent-default-model");
  const freeDefault = enabled && (mode === "free" || !hasDeepSeekKey);

  if (pluginIndex >= 0) {
    const existing = rows[pluginIndex];
    if (!isRecord(existing) || !isRecord(existing.config) || existing.config.distribution !== "managed"
      || Object.keys(existing.config).length !== 1 || Object.keys(existing).length !== 2) {
      throw new Error("免费模型的 DSH patch 已被手动修改，请先检查该配置。");
    }
  }

  const currentDefault = defaultIndex >= 0 ? rows[defaultIndex] : undefined;
  const ownedDefault = isRecord(currentDefault) && isRecord(currentDefault.config)
    && currentDefault.config.provider === "our-free-model"
    && currentDefault.config.model === FREE_MODEL
    && Object.keys(currentDefault.config).length === 2 && Object.keys(currentDefault).length === 2;
  if (freeDefault && currentDefault && !ownedDefault) {
    if (mode === "free") throw new Error("DSH 已有自定义默认模型，请先在 DSH 中清除它。");
  }

  const deletions = [
    !enabled ? pluginIndex : -1,
    ownedDefault && !freeDefault ? defaultIndex : -1,
  ].filter((index) => index >= 0).sort((a, b) => b - a);
  for (const index of deletions) doc.deleteIn([index]);
  if (enabled && pluginIndex < 0) doc.add(OWNED_PLUGIN);
  if (freeDefault && !currentDefault) doc.add(OWNED_DEFAULT);

  const nextPatch = doc.toString();
  const nextPackage = JSON.stringify(manifest, null, 2) + "\n";
  if (nextPatch !== (await readOptional(patchPath))) {
    await writePrivateFile(patchPath, nextPatch);
  }
  if (nextPackage !== packageText) {
    await writePrivateFile(packagePath, nextPackage);
  }
}

function parsePatch(text: string) {
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || !Array.isArray(doc.toJS())) {
    throw new Error("Taosi Harness 的 cordis.patch.yml 格式无效，不会覆盖。");
  }
  return doc;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
