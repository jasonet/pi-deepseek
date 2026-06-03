import { useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";

const LOBEHUB_CDN_BASE = "https://unpkg.com/@lobehub/icons-static-svg@1.91.0/icons";

const PROVIDER_ICON_NAMES: Record<string, string> = {
  deepseek: "deepseek",
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  groq: "groq",
  mistral: "mistral",
  cerebras: "cerebras",
  openrouter: "openrouter",
  xai: "xai",
  zai: "zai",
  huggingface: "huggingface",
  fireworks: "fireworks",
  moonshotai: "moonshotai",
  minimax: "minimax",
  opencode: "opencode",
  "opencode-go": "opencode-go",
  "vercel-ai-gateway": "vercel",
  "amazon-bedrock": "amazon-bedrock",
  "azure-openai-responses": "azure-openai",
  "kimi-coding": "kimi",
  "google-vertex": "google-vertex",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "cloudflare-workers",
  xiaomi: "xiaomi",
  github: "github",
  codex: "codex",
  "github-copilot": "github",
  perplexity: "perplexity",
  cohere: "cohere",
  together: "together",
  novita: "novita",
  siliconflow: "siliconflow",
  "01-ai": "01ai",
  baichuan: "baichuan",
  deepbricks: "deepbricks",
  zhipu: "zhipu",
  moonshot: "moonshotai",
  stepfun: "stepfun",
  qwen: "qwen",
};

const PROVIDER_COLORS: Record<string, string> = {
  deepseek: "#4D6BFE",
  anthropic: "#D97757",
  openai: "#10A37F",
  google: "#4285F4",
  groq: "#F55036",
  mistral: "#FF6F00",
  cerebras: "#E4234F",
  openrouter: "#6C3BD4",
  xai: "#111111",
  zai: "#0066FF",
  huggingface: "#FFBD45",
  fireworks: "#F92672",
  moonshotai: "#00D4AA",
  minimax: "#7C3AED",
  opencode: "#059669",
  "opencode-go": "#059669",
  "vercel-ai-gateway": "#000000",
  "amazon-bedrock": "#FF9900",
  "azure-openai-responses": "#0078D4",
  "kimi-coding": "#0066FF",
  "google-vertex": "#4285F4",
  "cloudflare-ai-gateway": "#F38020",
  "cloudflare-workers-ai": "#F38020",
  xiaomi: "#FF6900",
};

export function providerColor(providerId: string): string {
  return PROVIDER_COLORS[providerId] ?? "#6b7280";
}

function providerIconUrl(providerId: string): string | null {
  const name = PROVIDER_ICON_NAMES[providerId];
  return name ? `${LOBEHUB_CDN_BASE}/${name}.svg` : null;
}

export function ProviderIcon({ provider, size = 32 }: {
  readonly provider: RuntimeSnapshot["providers"][number];
  readonly size?: number;
}) {
  const iconUrl = providerIconUrl(provider.id);
  const color = providerColor(provider.id);
  const [imgError, setImgError] = useState(false);

  if (iconUrl && !imgError) {
    return (
      <img
        src={iconUrl}
        alt={provider.name}
        width={size}
        height={size}
        style={{ width: size, height: size, flexShrink: 0, borderRadius: 6 }}
        onError={() => setImgError(true)}
      />
    );
  }

  // Fallback: colored initials
  const initials = (() => {
    if (provider.id === "deepseek") return "DS";
    const name = provider.name || provider.id;
    const words = name.split(/[\s-]+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  })();
  const fontSize = size < 24 ? 10 : size < 32 ? 12 : 14;

  return (
    <span style={{
      width: size, height: size, borderRadius: 8,
      background: color, color: "#fff",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize, fontWeight: 700, flexShrink: 0, lineHeight: 1,
    }} title={provider.name}>{initials}</span>
  );
}
