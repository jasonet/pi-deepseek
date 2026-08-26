import type {
  ProbeRuntimeCustomModelProviderInput,
  ProbeRuntimeCustomModelProviderResult,
  RuntimeCustomModelRecord,
  RuntimeCustomModelThinkingFormat,
} from "@pi-gui/session-driver/runtime-types";

const PROBE_TIMEOUT_MS = 15_000;
const COMPLETION_PROBE_TIMEOUT_MS = 15_000;
const COMPLETION_PROBE_TIMEOUT_SECONDS = COMPLETION_PROBE_TIMEOUT_MS / 1_000;

interface CompletionProbeFailure {
  readonly message: string;
  readonly timedOut: boolean;
}

export async function probeCustomModelProvider(
  input: ProbeRuntimeCustomModelProviderInput,
  fetcher: typeof fetch,
): Promise<ProbeRuntimeCustomModelProviderResult> {
  let modelsUrl: URL;
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(input.baseUrl);
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

    const thinkingFormat = await detectThinkingFormat(baseUrl, headers, fetcher);
    const recommendedModelId = selectRecommendedModelId(models);
    const completionFailure = await probeStreamingCompletion({
      baseUrl,
      modelId: recommendedModelId,
      headers,
      thinkingFormat,
      fetcher,
    });
    if (completionFailure && !completionFailure.timedOut) {
      return { ok: false, message: completionFailure.message };
    }
    return {
      ok: true,
      message: completionFailure
        ? `Connected. Found ${models.length} model${models.length === 1 ? "" : "s"}. Model generation did not start within ${COMPLETION_PROBE_TIMEOUT_SECONDS} seconds; you can still save this provider.`
        : `Connected. Found ${models.length} model${models.length === 1 ? "" : "s"} and verified streaming.`,
      thinkingFormat,
      models,
      recommendedModelId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: message.includes("timeout") ? "Connection timed out after 15 seconds." : `Connection failed: ${message}`,
    };
  }
}

async function probeStreamingCompletion(input: {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly thinkingFormat: RuntimeCustomModelThinkingFormat;
  readonly fetcher: typeof fetch;
}): Promise<CompletionProbeFailure | undefined> {
  try {
    const response = await input.fetcher(new URL(`${input.baseUrl}/chat/completions`), {
      method: "POST",
      headers: {
        ...input.headers,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: [{ role: "user", content: "Reply OK" }],
        stream: true,
        max_tokens: 1,
        ...(input.thinkingFormat === "qwen-chat-template"
          ? { chat_template_kwargs: { enable_thinking: false, preserve_thinking: true } }
          : {}),
      }),
      signal: AbortSignal.timeout(COMPLETION_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 300);
      return {
        message: `Chat completion returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`,
        timedOut: false,
      };
    }
    if (!response.body) {
      return { message: "Chat completion returned no response stream.", timedOut: false };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    try {
      while (pending.length < 64_000) {
        const chunk = await reader.read();
        pending += decoder.decode(chunk.value, { stream: !chunk.done });
        const events = pending.split(/\r?\n\r?\n/);
        pending = events.pop() ?? "";
        for (const event of events) {
          for (const line of event.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            const payload = JSON.parse(data) as unknown;
            if (isRecord(payload) && Array.isArray(payload.choices)) {
              return undefined;
            }
          }
        }
        if (chunk.done) break;
      }
      return {
        message: "Chat completion did not return an OpenAI-compatible SSE event.",
        timedOut: false,
      };
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = /timeout|timed out|aborted/i.test(message);
    return {
      message: timedOut
        ? `Chat completion timed out after ${COMPLETION_PROBE_TIMEOUT_SECONDS} seconds. Model discovery works, but generation did not start.`
        : `Chat completion failed: ${message}`,
      timedOut,
    };
  }
}

function selectRecommendedModelId(models: readonly RuntimeCustomModelRecord[]): string {
  const preferred = models.find((model) => {
    const searchable = `${model.id} ${model.name}`.toLowerCase();
    return /gemma[\s/_.-]*4/.test(searchable)
      && /(?:^|[^a-z0-9])26b(?:[^a-z0-9]|$)/.test(searchable)
      && /(?:^|[^a-z0-9])a4b(?:[^a-z0-9]|$)/.test(searchable);
  });
  return (preferred ?? models[0]!).id;
}

async function detectThinkingFormat(
  baseUrl: string,
  headers: Readonly<Record<string, string>>,
  fetcher: typeof fetch,
): Promise<RuntimeCustomModelThinkingFormat> {
  try {
    const base = new URL(baseUrl);
    base.pathname = `${base.pathname.replace(/\/(?:v1)\/?$/i, "").replace(/\/$/, "")}/props`;
    const response = await fetcher(base, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return "auto";
    }
    const payload = await response.json() as unknown;
    if (isRecord(payload) && readString(payload.chat_template)?.includes("enable_thinking")) {
      return "qwen-chat-template";
    }
  } catch {
    // /props is a llama.cpp extension; generic OpenAI-compatible servers may not expose it.
  }
  return "auto";
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
