import { useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";

// Local bundled provider icons
import anthropicPng from "../resources/providers/claude.png";
import azurePng from "../resources/providers/azureai.png";
import baichuanPng from "../resources/providers/baichuan.png";
import bedrockPng from "../resources/providers/bedrock.png";
import cerebrasPng from "../resources/providers/cerebras.png";
import cloudflarePng from "../resources/providers/cloudflare.png";
import codexPng from "../resources/providers/codex.png";
import coherePng from "../resources/providers/cohere.png";
import deepseekPng from "../resources/providers/deepseek.png";
import fireworksPng from "../resources/providers/fireworks.png";
import githubPng from "../resources/providers/github.png";
import googlePng from "../resources/providers/google.png";
import groqPng from "../resources/providers/groq.png";
import huggingfacePng from "../resources/providers/huggingface.png";
import kimiPng from "../resources/providers/kimi.png";
import metaPng from "../resources/providers/meta.png";
import microsoftPng from "../resources/providers/microsoft.png";
import minimaxPng from "../resources/providers/minimax.png";
import mistralPng from "../resources/providers/mistral.png";
import novitaPng from "../resources/providers/novita.png";
import openaiPng from "../resources/providers/openai.png";
import opencodePng from "../resources/providers/opencode.png";
import openrouterPng from "../resources/providers/openrouter.png";
import perplexityPng from "../resources/providers/perplexity.png";
import qwenPng from "../resources/providers/qwen.png";
import stepfunPng from "../resources/providers/stepfun.png";
import togetherPng from "../resources/providers/together.png";
import vercelPng from "../resources/providers/vercel.png";
import xaiPng from "../resources/providers/xai.png";
import xiaomiPng from "../resources/providers/xiaomi.png";
import zaiPng from "../resources/providers/zai.png";
import zhipuPng from "../resources/providers/zhipu.png";

const PROVIDER_PNG: Record<string, string> = {
  anthropic: anthropicPng,
  azure: azurePng,
  "azure-openai-responses": azurePng,
  baichuan: baichuanPng,
  bedrock: bedrockPng,
  "amazon-bedrock": bedrockPng,
  cerebras: cerebrasPng,
  cloudflare: cloudflarePng,
  "cloudflare-ai-gateway": cloudflarePng,
  "cloudflare-workers-ai": cloudflarePng,
  codex: codexPng,
  cohere: coherePng,
  deepseek: deepseekPng,
  fireworks: fireworksPng,
  github: githubPng,
  "github-copilot": githubPng,
  google: googlePng,
  "google-vertex": googlePng,
  groq: groqPng,
  huggingface: huggingfacePng,
  kimi: kimiPng,
  "kimi-coding": kimiPng,
  moonshotai: kimiPng,
  meta: metaPng,
  microsoft: microsoftPng,
  minimax: minimaxPng,
  "minimax-cn": minimaxPng,
  mistral: mistralPng,
  novita: novitaPng,
  openai: openaiPng,
  opencode: opencodePng,
  "opencode-go": opencodePng,
  openrouter: openrouterPng,
  perplexity: perplexityPng,
  qwen: qwenPng,
  stepfun: stepfunPng,
  together: togetherPng,
  vercel: vercelPng,
  "vercel-ai-gateway": vercelPng,
  xai: xaiPng,
  xiaomi: xiaomiPng,
  zai: zaiPng,
  zhipu: zhipuPng,
  claude: anthropicPng,
  gemini: googlePng,
};

export function providerColor(providerId: string): string {
  const colors: Record<string, string> = {
    deepseek: "#4D6BFE", anthropic: "#D97757", openai: "#10A37F",
    google: "#4285F4", groq: "#F55036", mistral: "#FF6F00",
  };
  return colors[providerId] ?? "#6b7280";
}

export function ProviderIcon({ provider, size = 32 }: {
  readonly provider: RuntimeSnapshot["providers"][number];
  readonly size?: number;
}) {
  const pngUrl = PROVIDER_PNG[provider.id] ?? 
    PROVIDER_PNG[provider.id.split("-")[0]];
  const [imgError, setImgError] = useState(false);

  if (pngUrl && !imgError) {
    return (
      <img
        src={pngUrl}
        alt={provider.name}
        width={size}
        height={size}
        style={{ width: size, height: size, flexShrink: 0, borderRadius: 6 }}
        onError={() => setImgError(true)}
      />
    );
  }

  // Fallback: colored initials
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
