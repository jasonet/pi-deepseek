import { expect, test } from "@playwright/test";
import { parseFxAuthStatus, withFxModels } from "../../src/fx-auth";

test("normalizes fx connections and identifies the active Codex subscription", () => {
  const status = parseFxAuthStatus(JSON.stringify({
    kind: "status",
    model: "gpt-5.6-sol",
    model_source: "Codex subscription",
    auth: "ChatGPT account",
    connected_providers: ["vercel-ai-gateway", "codex", "unknown"],
  }));

  expect(status).toEqual({
    state: "ready",
    connectedProviders: ["vercel", "codex"],
    connectionsKnown: true,
    activeProvider: "codex",
    models: [],
    model: "gpt-5.6-sol",
    authLabel: "ChatGPT account",
  });
});

test("attaches a deduplicated active-provider model catalog", () => {
  const status = parseFxAuthStatus(JSON.stringify({
    kind: "status",
    model_source: "Grok subscription",
    connected_providers: ["grok"],
  }));

  expect(withFxModels(status, JSON.stringify({
    kind: "models",
    ids: ["grok-4", "grok-4", "", 42],
  })).models).toEqual(["grok-4"]);
});

test("rejects unsupported fx status output without accepting partial state", () => {
  expect(() => parseFxAuthStatus("not json")).toThrow("invalid JSON");
  expect(() => parseFxAuthStatus(JSON.stringify({ kind: "models" }))).toThrow("unsupported response");
});
