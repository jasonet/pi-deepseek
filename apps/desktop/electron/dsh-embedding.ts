const ORIGINAL = "; HttpOnly; SameSite=Strict";
const EMBEDDED = "; HttpOnly; SameSite=None; Secure; Partitioned";

export function patchDshEmbedding(connection: string, allowPatched = false): string {
  const originalCount = connection.split(ORIGINAL).length - 1;
  const embeddedCount = connection.split(EMBEDDED).length - 1;
  if (allowPatched && originalCount === 0 && embeddedCount === 1) return connection;
  if (originalCount !== 1 || embeddedCount !== 0) throw new Error("DSH 嵌入式登录模块不兼容。");
  return connection.replace(ORIGINAL, EMBEDDED);
}
