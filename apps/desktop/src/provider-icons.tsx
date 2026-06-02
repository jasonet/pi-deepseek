import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";

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
  kimi: "#0066FF",
  minimax: "#7C3AED",
  opencode: "#059669",
  "opencode-go": "#059669",
  "vercel-ai-gateway": "#000000",
  "amazon-bedrock": "#FF9900",
  "azure-openai-responses": "#0078D4",
  "cloudflare-ai-gateway": "#F38020",
  "cloudflare-workers-ai": "#F38020",
  "google-vertex": "#4285F4",
  "kimi-coding": "#0066FF",
  "minimax-cn": "#7C3AED",
  "moonshotai-cn": "#00D4AA",
  xiaomi: "#FF6900",
};

const PROVIDER_INITIALS: Record<string, string> = {
  deepseek: "DS",
  anthropic: "AN",
  openai: "OA",
  google: "GG",
  groq: "GQ",
  mistral: "MI",
  cerebras: "CB",
  openrouter: "OR",
  xai: "XA",
  zai: "ZA",
  huggingface: "HF",
  fireworks: "FW",
  moonshotai: "MO",
  minimax: "MM",
  opencode: "OC",
  "opencode-go": "OG",
  "vercel-ai-gateway": "VG",
  "amazon-bedrock": "AB",
  "azure-openai-responses": "AZ",
  "kimi-coding": "KC",
  "google-vertex": "GV",
  "kimi": "KI",
  "minimax-cn": "MC",
  "moonshotai-cn": "MC",
  "cloudflare-ai-gateway": "CF",
  "cloudflare-workers-ai": "CW",
  xiaomi: "XM",
};

export function providerColor(providerId: string): string {
  return PROVIDER_COLORS[providerId] ?? "#6b7280";
}

export function providerInitials(provider: RuntimeSnapshot["providers"][number]): string {
  if (PROVIDER_INITIALS[provider.id]) return PROVIDER_INITIALS[provider.id];
  const name = provider.name || provider.id;
  const words = name.split(/[\s-]+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function ProviderIcon({ provider, size = 32 }: {
  readonly provider: RuntimeSnapshot["providers"][number];
  readonly size?: number;
}) {
  const color = providerColor(provider.id);
  const initials = providerInitials(provider);
  const fontSize = size < 24 ? 10 : size < 32 ? 12 : 14;

  return (
    <span
      className="provider-icon"
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: color,
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize,
        fontWeight: 700,
        flexShrink: 0,
        lineHeight: 1,
        letterSpacing: "-0.5px",
      }}
      title={provider.name}
    >
      {initials}
    </span>
  );
}
