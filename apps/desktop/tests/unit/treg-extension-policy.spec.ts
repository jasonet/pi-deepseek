import { expect, test } from "@playwright/test";
import { catalogContractFromResult, isWorkspaceAllowed, redact } from "../../resources/extensions/pi-treg/index";

test("workspace authorization includes descendants but not similarly prefixed paths", () => {
  expect(isWorkspaceAllowed("/repo", ["/repo"])).toBe(true);
  expect(isWorkspaceAllowed("/repo/packages/app", ["/repo"])).toBe(true);
  expect(isWorkspaceAllowed("/repo-private", ["/repo"])).toBe(false);
  expect(isWorkspaceAllowed("/repo", [])).toBe(false);
});

test("confirmation previews redact nested credentials", () => {
  const value = redact({
    query: { q: "hello" },
    headers: { Authorization: "Bearer secret", "X-Api-Key": "secret-key" },
    body: { password: "secret", visible: "ok" },
  });
  expect(value).toEqual({
    query: { q: "hello" },
    headers: { Authorization: "<redacted>", "X-Api-Key": "<redacted>" },
    body: { password: "<redacted>", visible: "ok" },
  });
});

test("catalog contracts use the endpoint's real method and nested exact price", () => {
  expect(catalogContractFromResult({
    structuredContent: {
      endpoint: { method: "post", cost: { usd: 0.1248 } },
    },
  })).toEqual({ method: "POST", price: "$0.124800 per call" });

  expect(() => catalogContractFromResult({ structuredContent: { endpoint: { method: "POST" } } }))
    .toThrow(/publish this endpoint's price/);
});
