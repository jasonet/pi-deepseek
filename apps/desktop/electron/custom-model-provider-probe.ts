import type {
  ProbeRuntimeCustomModelProviderInput,
  ProbeRuntimeCustomModelProviderResult,
  RuntimeCustomModelRecord,
} from "@pi-gui/session-driver/runtime-types";

const PROBE_TIMEOUT_MS = 15_000;

export async function probeCustomModelProvider(
  input: ProbeRuntimeCustomModelProviderInput,
  fetcher: typeof fetch,
): Promise<ProbeRuntimeCustomModelProviderResult> {
  let modelsUrl: URL;
  try {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    modelsUrl = new URL(`${baseUrl}/models`);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  try {
    const headers: Record<string, string> = { accept: "application/json" };
    const apiKey = input.apiKey?.trim();
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    const response = await fetcher(modelsUrl, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 300);
      return {
        ok: false,
        message: `Model discovery returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`,
      };
    }

    const payload = await response.json() as unknown;
    const models = readModels(payload);
    if (models.length === 0) {
      return { ok: false, message: "Connected, but the server returned no models." };
    }
    return {
      ok: true,
      message: `Connected. Found ${models.length} model${models.length === 1 ? "" : "s"}.`,
      models,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: message.includes("timeout") ? "Connection timed out after 15 seconds." : `Connection failed: ${message}`,
    };
  }
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  const url = new URL(normalized);
  if (!normalized || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error("Base URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Base URL must not contain embedded credentials.");
  }
  return normalized;
}

function readModels(payload: unknown): RuntimeCustomModelRecord[] {
  if (!isRecord(payload)) {
    return [];
  }
  const data = [
    ...(Array.isArray(payload.data) ? payload.data : []),
    ...(Array.isArray(payload.models) ? payload.models : []),
  ];
  const models = new Map<string, RuntimeCustomModelRecord>();
  for (const candidate of data) {
    if (!isRecord(candidate)) {
      continue;
    }
    const id = readString(candidate.id) ?? readString(candidate.model) ?? readString(candidate.name);
    if (!id) {
      continue;
    }
    const capabilities = Array.isArray(candidate.capabilities)
      ? candidate.capabilities.filter((value): value is string => typeof value === "string")
      : [];
    const meta = isRecord(candidate.meta) ? candidate.meta : {};
    const existing = models.get(id);
    const contextWindow = readPositiveInteger(candidate.context_window)
      ?? readPositiveInteger(candidate.contextWindow)
      ?? readPositiveInteger(meta.n_ctx)
      ?? existing?.contextWindow
      ?? 128_000;
    models.set(id, {
      id,
      name: readString(candidate.display_name) ?? readString(candidate.name) ?? existing?.name ?? id,
      reasoning: existing?.reasoning === true || candidate.reasoning === true || /reason|thinking/i.test(id),
      supportsImages: existing?.supportsImages === true
        || capabilities.some((capability) => /image|vision|multimodal/i.test(capability)),
      contextWindow,
      maxTokens: Math.min(16_384, contextWindow),
    });
  }
  return [...models.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
