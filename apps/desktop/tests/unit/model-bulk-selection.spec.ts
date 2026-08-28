import { expect, test } from "@playwright/test";
import type { RuntimeModelRecord } from "@pi-gui/session-driver/runtime-types";
import {
  buildProviderBulkSelection,
  NO_ENABLED_MODELS_PATTERN,
  selectLatestModelPatterns,
} from "../../src/model-bulk-selection";

test("smart selection keeps the highest latest OpenRouter release in each model family", () => {
  const models = [
    model("anthropic/claude-opus-4.5", "Anthropic: Claude Opus 4.5"),
    model("anthropic/claude-opus-4.7", "Anthropic: Claude Opus 4.7"),
    model("anthropic/claude-opus-4.9", "Anthropic: Claude Opus 4.9"),
    model("anthropic/claude-opus-4.10", "Anthropic: Claude Opus 4.10"),
    model("google/gemma-4-26b-it", "Google: Gemma 4 26B"),
    model("google/gemma-4-31b-it", "Google: Gemma 4 31B"),
    model("meta-llama/llama-3.3-70b-instruct", "Meta: Llama 3.3 70B Instruct"),
    model("meta-llama/llama-4-8b-instruct", "Meta: Llama 4 8B Instruct"),
    model("minimax/minimax-m2.5", "MiniMax: MiniMax M2.5"),
    model("minimax/minimax-m2.5:free", "MiniMax: MiniMax M2.5 (free)"),
    model("google/gemini-2.5-pro-preview-05-06", "Google: Gemini 2.5 Pro Preview 05-06"),
    model("google/gemini-2.5-pro-preview", "Google: Gemini 2.5 Pro Preview 06-05"),
  ];

  expect(selectLatestModelPatterns(models)).toEqual([
    "openrouter/anthropic/claude-opus-4.10",
    "openrouter/google/gemini-2.5-pro-preview",
    "openrouter/google/gemma-4-31b-it",
    "openrouter/meta-llama/llama-4-8b-instruct",
    "openrouter/minimax/minimax-m2.5",
  ]);
});

test("OpenRouter bulk actions preserve selections from other providers", () => {
  const models = [
    model("anthropic/claude-opus-4.5", "Anthropic: Claude Opus 4.5"),
    model("anthropic/claude-opus-4.7", "Anthropic: Claude Opus 4.7"),
    model("gpt-5", "GPT-5", "openai"),
  ];
  const active = models.map((entry) => `${entry.providerId}/${entry.modelId}`);

  expect(buildProviderBulkSelection(models, active, "openrouter", "none")).toEqual(["openai/gpt-5"]);
  expect(buildProviderBulkSelection(models, active, "openrouter", "smart")).toEqual([
    "openai/gpt-5",
    "openrouter/anthropic/claude-opus-4.7",
  ]);
});

test("OpenRouter bulk actions remove stale provider patterns that are no longer in the catalog", () => {
  const models = [model("anthropic/claude-opus-4.7", "Anthropic: Claude Opus 4.7")];
  expect(buildProviderBulkSelection(
    models,
    ["openrouter/retired/model", "openai/gpt-5"],
    "openrouter",
    "none",
  )).toEqual(["openai/gpt-5"]);
});

test("select none uses an explicit marker instead of the empty-array means all convention", () => {
  const models = [model("anthropic/claude-opus-4.7", "Anthropic: Claude Opus 4.7")];
  expect(buildProviderBulkSelection(models, ["openrouter/anthropic/claude-opus-4.7"], "openrouter", "none"))
    .toEqual([NO_ENABLED_MODELS_PATTERN]);
});

function model(modelId: string, label: string, providerId = "openrouter"): RuntimeModelRecord {
  return {
    providerId,
    providerName: providerId === "openrouter" ? "OpenRouter" : "OpenAI",
    modelId,
    label,
    available: true,
    authType: "api_key",
    reasoning: true,
    supportsImages: false,
  };
}
