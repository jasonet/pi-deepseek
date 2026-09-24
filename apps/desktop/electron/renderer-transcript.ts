import type { TranscriptMessage } from "../src/desktop-state";

export const MAX_RENDERER_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_ITEM_BYTES = 1024 * 1024;
const PREVIEW_CHARS = 48 * 1024;
const NOTICE = "\n[Display preview shortened; complete content is preserved in session history.]";

// Bound display copies only. Never mutate the cache or persisted history.
export function rendererTranscript(items: readonly TranscriptMessage[]): TranscriptMessage[] {
  const result: TranscriptMessage[] = [];
  let bytes = 2;
  for (let index = items.length - 1; index >= 0; index--) {
    let item = items[index]!;
    // Avoid materializing a huge JSON string for the common oversized message.
    let size = item.kind === "message" && item.text.length > MAX_ITEM_BYTES
      ? MAX_ITEM_BYTES + 1
      : Buffer.byteLength(JSON.stringify(item), "utf8") + 1;
    if (size > MAX_ITEM_BYTES) {
      const base = { id: item.id, createdAt: item.createdAt };
      if (item.kind === "message") {
        item = { ...base, kind: "message", role: item.role, text: item.text.slice(0, PREVIEW_CHARS) + NOTICE };
      } else if (item.kind === "tool") {
        item = { ...base, kind: "tool", callId: item.callId, toolName: item.toolName,
          status: item.status, label: item.label.slice(0, 512),
          detail: (item.detail ?? "").slice(0, PREVIEW_CHARS) + NOTICE };
      } else {
        item = { ...base, kind: "activity", label: item.label.slice(0, PREVIEW_CHARS) + NOTICE };
      }
      size = Buffer.byteLength(JSON.stringify(item), "utf8") + 1;
    }
    if (bytes + size > MAX_RENDERER_TRANSCRIPT_BYTES) break;
    result.push(item);
    bytes += size;
  }
  return result.reverse();
}
