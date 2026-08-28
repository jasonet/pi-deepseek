import {
  NO_ENABLED_MODELS_PATTERN,
  type RuntimeModelRecord,
} from "@pi-gui/session-driver/runtime-types";

export { NO_ENABLED_MODELS_PATTERN } from "@pi-gui/session-driver/runtime-types";

export type ModelBulkSelectionMode = "none" | "all" | "smart";

const RELEASE_QUALIFIERS = new Set(["free", "preview", "experimental", "exp", "latest"]);

export function buildProviderBulkSelection(
  models: readonly RuntimeModelRecord[],
  activePatterns: readonly string[],
  providerId: string,
  mode: ModelBulkSelectionMode,
): readonly string[] {
  const providerModels = models.filter((model) => model.providerId === providerId);
  const retainedPatterns = activePatterns.filter(
    (pattern) => pattern !== NO_ENABLED_MODELS_PATTERN && !pattern.startsWith(`${providerId}/`),
  );
  const selectedProviderPatterns = mode === "none"
    ? []
    : mode === "all"
      ? providerModels.map(runtimeModelPattern)
      : selectLatestModelPatterns(providerModels);
  const nextPatterns = [...new Set([...retainedPatterns, ...selectedProviderPatterns])];
  return nextPatterns.length > 0 ? nextPatterns : [NO_ENABLED_MODELS_PATTERN];
}

export function normalizeEnabledModelPatterns(patterns: readonly string[]): readonly string[] {
  const normalized = [...new Set(patterns.filter((pattern) => pattern !== NO_ENABLED_MODELS_PATTERN))];
  return normalized.length > 0 ? normalized : [NO_ENABLED_MODELS_PATTERN];
}

export function selectLatestModelPatterns(models: readonly RuntimeModelRecord[]): readonly string[] {
  const latestByFamily = new Map<string, RuntimeModelRecord>();
  for (const model of models) {
    const family = modelFamily(model);
    const current = latestByFamily.get(family);
    if (!current || compareModelReleases(model, current) > 0) {
      latestByFamily.set(family, model);
    }
  }
  return [...latestByFamily.values()].map(runtimeModelPattern).sort((left, right) => left.localeCompare(right));
}

export function runtimeModelPattern(model: RuntimeModelRecord): string {
  return `${model.providerId}/${model.modelId}`;
}

function modelFamily(model: RuntimeModelRecord): string {
  const [publisher = "", ...modelParts] = model.modelId.toLowerCase().split("/");
  const modelName = modelParts.join("/") || publisher;
  const familyTokens = modelName
    .replace(/:[a-z0-9-]+$/i, "")
    .split(/[^a-z0-9.]+/)
    .filter(Boolean)
    .filter((token) => !RELEASE_QUALIFIERS.has(token))
    .filter((token) => !isReleaseToken(token));
  return `${publisher}/${familyTokens.join("-") || modelName}`;
}

function isReleaseToken(token: string): boolean {
  return (
    /^v?\d+(?:\.\d+)*$/.test(token) ||
    /^\d+(?:\.\d+)?[bt]$/.test(token) ||
    /^a\d+b$/.test(token) ||
    /^\d{4,8}$/.test(token)
  );
}

function compareModelReleases(left: RuntimeModelRecord, right: RuntimeModelRecord): number {
  const leftNumbers = releaseNumbers(left);
  const rightNumbers = releaseNumbers(right);
  const length = Math.max(leftNumbers.length, rightNumbers.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftNumbers[index] ?? 0) - (rightNumbers[index] ?? 0);
    if (difference !== 0) return difference;
  }

  const stabilityDifference = stabilityScore(left) - stabilityScore(right);
  if (stabilityDifference !== 0) return stabilityDifference;
  return left.modelId.localeCompare(right.modelId, undefined, { numeric: true });
}

function releaseNumbers(model: RuntimeModelRecord): readonly number[] {
  const source = model.label || model.modelId;
  return [...source.matchAll(/\d+(?:\.\d+)?/g)]
    .flatMap((match) => match[0].split(".").map(Number));
}

function stabilityScore(model: RuntimeModelRecord): number {
  const source = `${model.modelId} ${model.label}`.toLowerCase();
  if (/\bfree\b|:free\b/.test(source)) return -3;
  if (/\bexperimental\b|\bexp\b/.test(source)) return -2;
  if (/\bpreview\b/.test(source)) return -1;
  return 0;
}
