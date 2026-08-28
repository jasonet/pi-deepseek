export const FX_AUTH_PROVIDERS = ["vercel", "codex", "grok"] as const;

export type FxAuthProvider = (typeof FX_AUTH_PROVIDERS)[number];

export const FX_RUNTIME_PROVIDERS = ["gateway", "codex", "grok"] as const;

export type FxRuntimeProvider = (typeof FX_RUNTIME_PROVIDERS)[number];

export function isFxAuthProvider(value: unknown): value is FxAuthProvider {
  return typeof value === "string" && FX_AUTH_PROVIDERS.some((provider) => provider === value);
}

export function isFxRuntimeProvider(value: unknown): value is FxRuntimeProvider {
  return typeof value === "string" && FX_RUNTIME_PROVIDERS.some((provider) => provider === value);
}

export function toFxRuntimeProvider(provider: FxAuthProvider): FxRuntimeProvider {
  return provider === "vercel" ? "gateway" : provider;
}

export interface FxAuthStatus {
  readonly state: "ready" | "unavailable" | "error";
  readonly connectedProviders: readonly FxAuthProvider[];
  readonly connectionsKnown?: boolean;
  readonly activeProvider?: FxAuthProvider;
  readonly models: readonly string[];
  readonly model?: string;
  readonly authLabel?: string;
  readonly message?: string;
}

export function parseFxAuthStatus(raw: string): FxAuthStatus {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("fx status returned invalid JSON.");
  }
  if (!isRecord(value) || value.kind !== "status") {
    throw new Error("fx status returned an unsupported response.");
  }

  const rawConnectedProviders = Array.isArray(value.connected_providers) ? value.connected_providers : undefined;
  const connected = rawConnectedProviders
    ? rawConnectedProviders.flatMap((provider) => mapConnectedProvider(provider))
    : [];
  const connectedProviders = [...new Set(connected)];
  const authLabel = stringValue(value.auth);
  const modelSource = stringValue(value.model_source);
  const activeProvider = inferActiveProvider(authLabel, modelSource, connectedProviders);

  return {
    state: "ready",
    connectedProviders,
    connectionsKnown: Boolean(rawConnectedProviders),
    models: [],
    ...(activeProvider ? { activeProvider } : {}),
    ...(stringValue(value.model) ? { model: stringValue(value.model) } : {}),
    ...(authLabel ? { authLabel } : {}),
  };
}

export function withFxModels(status: FxAuthStatus, raw: string): FxAuthStatus {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return status;
  }
  if (!isRecord(value) || !Array.isArray(value.ids)) return status;
  return {
    ...status,
    models: [...new Set(value.ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))],
  };
}

function mapConnectedProvider(value: unknown): FxAuthProvider[] {
  if (typeof value !== "string") return [];
  switch (value.toLowerCase()) {
    case "vercel":
    case "gateway":
    case "vercel-ai-gateway":
      return ["vercel"];
    case "codex":
      return ["codex"];
    case "grok":
      return ["grok"];
    default:
      return [];
  }
}

function inferActiveProvider(
  authLabel: string | undefined,
  modelSource: string | undefined,
  connectedProviders: readonly FxAuthProvider[],
): FxAuthProvider | undefined {
  const description = `${authLabel ?? ""} ${modelSource ?? ""}`.toLowerCase();
  if (description.includes("codex") || description.includes("chatgpt")) return "codex";
  if (description.includes("grok") || description.includes("xai") || description.includes("x.ai")) return "grok";
  if (description.includes("gateway") || description.includes("vercel")) return "vercel";
  return connectedProviders.length === 1 ? connectedProviders[0] : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
