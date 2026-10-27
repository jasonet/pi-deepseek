import { expect, test } from "@playwright/test";
import type { ComposerModelOption } from "../../src/composer-commands";

function pickPreferredCustomModel(options: readonly ComposerModelOption[]): ComposerModelOption | undefined {
  const customModels = options.filter((model) => model.providerId.startsWith("custom-"));
  if (customModels.length === 0) return undefined;
  const gemini38 = customModels.find(
    (m) =>
      m.modelId.toLowerCase().includes("gemini-3.8") ||
      m.modelId.toLowerCase().includes("gemini 3.8") ||
      m.label.toLowerCase().includes("gemini-3.8") ||
      m.label.toLowerCase().includes("gemini 3.8"),
  );
  if (gemini38) return gemini38;
  const anyGemini = customModels.find(
    (m) => m.modelId.toLowerCase().includes("gemini") || m.label.toLowerCase().includes("gemini"),
  );
  return anyGemini ?? customModels[0];
}

test("prefers gemini-3.8 among custom models and sets xhigh thinking effort", () => {
  const options: ComposerModelOption[] = [
    {
      value: "claude-opus-5-5-high",
      label: "CLI96G · claude-opus-5-5-high",
      description: "claude-opus-5-5-high",
      providerId: "custom-api",
      modelId: "claude-opus-5-5-high",
    },
    {
      value: "gemini-3.8-flash-high",
      label: "CLI96G · gemini-3.8-flash-high",
      description: "gemini-3.8-flash-high",
      providerId: "custom-api",
      modelId: "gemini-3.8-flash-high",
    },
    {
      value: "deepseek-v4-pro",
      label: "CLI96G · deepseek-v4-pro",
      description: "deepseek-v4-pro",
      providerId: "custom-api",
      modelId: "deepseek-v4-pro",
    },
  ];

  const preferred = pickPreferredCustomModel(options);
  expect(preferred).toBeDefined();
  expect(preferred?.modelId).toBe("gemini-3.8-flash-high");
});

test("falls back to generic gemini if gemini-3.8 is not present", () => {
  const options: ComposerModelOption[] = [
    {
      value: "claude-opus-5-5-high",
      label: "CLI96G · claude-opus-5-5-high",
      description: "claude-opus-5-5-high",
      providerId: "custom-api",
      modelId: "claude-opus-5-5-high",
    },
    {
      value: "gemini-2.5-pro",
      label: "CLI96G · gemini-2.5-pro",
      description: "gemini-2.5-pro",
      providerId: "custom-api",
      modelId: "gemini-2.5-pro",
    },
  ];

  const preferred = pickPreferredCustomModel(options);
  expect(preferred?.modelId).toBe("gemini-2.5-pro");
});

test("falls back to first custom model when no gemini models exist", () => {
  const options: ComposerModelOption[] = [
    {
      value: "qwen-2.5-coder",
      label: "LM Studio · qwen-2.5-coder",
      description: "qwen-2.5-coder",
      providerId: "custom-lm",
      modelId: "qwen-2.5-coder",
    },
  ];

  const preferred = pickPreferredCustomModel(options);
  expect(preferred?.modelId).toBe("qwen-2.5-coder");
});
