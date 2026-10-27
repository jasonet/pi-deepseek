import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { DEFAULT_TRADING_PREFERENCES, readTradingPreferences, saveTradingPreferences } from "../../electron/dsh-trading-preferences";
import { isCredentialEnvironmentName } from "../../electron/dsh-managed-runtime";
import { patchDshEmbedding } from "../../electron/dsh-embedding";

test("Trading defaults prepare a research draft and persist independent preferences", async () => {
  const home = await mkdtemp(join(tmpdir(), "trading-preferences-"));
  expect(await readTradingPreferences(home)).toEqual(DEFAULT_TRADING_PREFERENCES);
  await saveTradingPreferences(home, { example: "crypto" });
  await saveTradingPreferences(home, { examplePrepared: true });
  expect(await readTradingPreferences(home)).toEqual({ autoPrepareExample: true, example: "crypto", examplePrepared: true });
  expect(await readFile(join(home, "taosi-preferences.json"), "utf8")).not.toContain("key");
});

test("Trading filters ambient provider and exchange credentials", () => {
  for (const name of ["BINANCE_API_KEY", "BINANCE_APIKEY", "BINANCE_SECRET", "AWS_ACCESS_KEY_ID", "AWS_SESSION_TOKEN", "DSH_HOME", "PRIVATE_KEY"]) {
    expect(isCredentialEnvironmentName(name), name).toBe(true);
  }
  for (const name of ["HOME", "PATH", "LANG", "TMPDIR"]) expect(isCredentialEnvironmentName(name), name).toBe(false);
});

test("embedding cookie patch rejects drift and permits verified reuse", () => {
  const source = "cookie; HttpOnly; SameSite=Strict";
  const result = patchDshEmbedding(source);
  expect(result).toContain("SameSite=None; Secure; Partitioned");
  expect(patchDshEmbedding(result, true)).toBe(result);
  expect(() => patchDshEmbedding(source + source, true)).toThrow("不兼容");
  expect(() => patchDshEmbedding(result + source, true)).toThrow("不兼容");
});

test("Trading rejects unknown fields and invalid preferences", async () => {
  const home = await mkdtemp(join(tmpdir(), "trading-preferences-invalid-"));
  for (const value of [null, [], { example: "live" }, { example: ["crypto"] }, { apiKey: "secret" }, { autoPrepareExample: "true" }]) {
    await expect(saveTradingPreferences(home, value)).rejects.toThrow("Invalid Trading");
  }
});
