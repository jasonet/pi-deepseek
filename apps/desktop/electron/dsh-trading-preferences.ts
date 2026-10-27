import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { withDshFileLock } from "./dsh-file-lock";
import type { TradingPreferences } from "../src/ipc";

export const DEFAULT_TRADING_PREFERENCES: TradingPreferences = {
  autoPrepareExample: true, example: "overview", examplePrepared: false,
};

function validate(input: unknown): Partial<TradingPreferences> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid Trading preferences");
  const value = input as Record<string, unknown>;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "example" ? typeof entry !== "string" || !["overview", "crypto", "us", "cn"].includes(entry)
      : !["autoPrepareExample", "examplePrepared"].includes(key) || typeof entry !== "boolean") {
      throw new Error(`Invalid Trading preference: ${key}`);
    }
  }
  return value as Partial<TradingPreferences>;
}

export async function readTradingPreferences(home: string): Promise<TradingPreferences> {
  try {
    return { ...DEFAULT_TRADING_PREFERENCES, ...validate(JSON.parse(await readFile(join(home, "taosi-preferences.json"), "utf8"))) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_TRADING_PREFERENCES;
    throw error;
  }
}

export async function saveTradingPreferences(home: string, input: unknown): Promise<TradingPreferences> {
  const patch = validate(input);
  await mkdir(home, { recursive: true, mode: 0o700 });
  const file = join(home, "taosi-preferences.json");
  return withDshFileLock(file, async () => {
    const next = { ...await readTradingPreferences(home), ...patch };
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, file);
    return next;
  });
}
