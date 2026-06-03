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
  moonshotai: "kimi",
  minimax: "minimax",
  opencode: "opencode",
  "opencode-go": "opencode",
  "vercel-ai-gateway": "vercel",
  "amazon-bedrock": "aws",
  aws: "aws",
  "azure-openai-responses": "azure",
  azure: "azure",
  "kimi-coding": "kimi",
  kimi: "kimi",
  "google-vertex": "google",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "cloudflare",
  cloudflare: "cloudflare",
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
  moonshot: "kimi",
  stepfun: "stepfun",
  qwen: "qwen",
  gemini: "google",
  claude: "anthropic",
  meta: "meta",
  microsoft: "microsoft",
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
  // Special cases with direct PNG URLs
  const pngMap: Record<string, string> = {
    xiaomi: "https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/light/xiaomimimo.png",
    bedrock: "https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/light/bedrock-color.png",
    "amazon-bedrock": "https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/light/bedrock-color.png",
    azure: "https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/light/azureai-color.png",
    "azure-openai-responses": "https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/light/azureai-color.png",
  };
  if (pngMap[providerId]) return pngMap[providerId];
  // 1. Exact match
  if (PROVIDER_ICON_NAMES[providerId]) return `${LOBEHUB_CDN_BASE}/${PROVIDER_ICON_NAMES[providerId]}.svg`;
  // 2. Try prefix before first dash
  const prefix = providerId.split("-")[0];
  if (PROVIDER_ICON_NAMES[prefix]) return `${LOBEHUB_CDN_BASE}/${PROVIDER_ICON_NAMES[prefix]}.svg`;
  // 3. Try fuzzy: check if providerId contains known brand names
  for (const [key, icon] of Object.entries(PROVIDER_ICON_NAMES)) {
    if (key.length > 2 && providerId.includes(key)) return `${LOBEHUB_CDN_BASE}/${icon}.svg`;
  }
  // 4. Direct URL attempt
  return `${LOBEHUB_CDN_BASE}/${providerId}.svg`;
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
