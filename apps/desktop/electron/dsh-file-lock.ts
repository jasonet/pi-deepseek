import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const LOCK_TIMEOUT_MS = 2_000;
const LOCK_RETRY_INITIAL_MS = 20;
const LOCK_RETRY_MAX_MS = 200;

// Mirrors @deepseek-ai/dsh-atomic-write@0.1.0-rc.6 without importing its
// ESM-only package into the CommonJS Electron main bundle.
export async function withDshFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let delay = LOCK_RETRY_INITIAL_MS;
  for (;;) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for the DSH credentials writer lock at ${lockPath}.`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS);
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
