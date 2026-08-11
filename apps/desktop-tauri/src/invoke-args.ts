export function normalizeInvokeArgs(args: readonly unknown[]): unknown[] {
  const normalized = [...args];
  while (normalized.length > 0 && normalized.at(-1) === undefined) {
    normalized.pop();
  }
  return normalized;
}
