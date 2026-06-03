import { useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";

const LOBEHUB_PNG_BASE = "https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/light";
const LOBEHUB_SVG_BASE = "https://unpkg.com/@lobehub/icons-static-svg@1.91.0/icons";

const ICON_NAMES: Record<string, string> = {
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
  "amazon-bedrock": "bedrock",
  aws: "bedrock",
  "azure-openai-responses": "azureai",
  azure: "azureai",
  "kimi-coding": "kimi",
  kimi: "kimi",
  "google-vertex": "google",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "cloudflare",
  cloudflare: "cloudflare",
  xiaomi: "xiaomimimo",
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

export function providerColor(providerId: string): string {
  const colors: Record<string, string> = {
    deepseek: "#4D6BFE", anthropic: "#D97757", openai: "#10A37F",
    google: "#4285F4", groq: "#F55036", mistral: "#FF6F00",
    cerebras: "#E4234F", openrouter: "#6C3BD4", xai: "#111111", zai: "#0066FF",
    huggingface: "#FFBD45", fireworks: "#F92672",
  };
  return colors[providerId] ?? "#6b7280";
}

function providerIconUrl(providerId: string): string | null {
  // 1. Try PNG with -color suffix first, then without
  const name = ICON_NAMES[providerId] || providerId.split("-")[0];
  const finalName = ICON_NAMES[name] || name;
  // Return color PNG URL; fallback handled by onError in component
  return `${LOBEHUB_PNG_BASE}/${finalName}-color.png`;
}

export function ProviderIcon({ provider, size = 32 }: {
  readonly provider: RuntimeSnapshot["providers"][number];
  readonly size?: number;
}) {
  const name = ICON_NAMES[provider.id] || provider.id.split("-")[0];
  const finalName = ICON_NAMES[name] || name;
  // Fallback chain: color PNG → plain PNG → SVG → initials
  const urls = [
    `${LOBEHUB_PNG_BASE}/${finalName}-color.png`,
    `${LOBEHUB_PNG_BASE}/${finalName}.png`,
    `${LOBEHUB_SVG_BASE}/${finalName}.svg`,
  ];
  const [urlIndex, setUrlIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  if (!failed && urlIndex < urls.length) {
    return (
      <img
        src={urls[urlIndex]}
        alt={provider.name}
        width={size}
        height={size}
        style={{ width: size, height: size, flexShrink: 0, borderRadius: 6 }}
        onError={() => setUrlIndex(urlIndex + 1)}
      />
    );
  }

  // Final fallback: colored initials
  const color = providerColor(provider.id);
  const pname = provider.name || provider.id;
  const words = pname.split(/[\s-]+/);
  const initials = words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : pname.slice(0, 2).toUpperCase();
  const fontSize = size < 24 ? 10 : size < 32 ? 12 : 14;

  return (
    <span style={{
      width: size, height: size, borderRadius: 8, background: color, color: "#fff",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize, fontWeight: 700, flexShrink: 0, lineHeight: 1,
    }} title={provider.name}>{initials}</span>
  );
}
