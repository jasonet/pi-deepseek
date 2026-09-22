import { expect, test } from "@playwright/test";
import { TRANSIENT_WORKING_LABELS } from "../../electron/transient-labels";
import type { TimelineActivity, TranscriptMessage } from "../../src/timeline-types";

test.describe("Session Compaction & Transient Working Labels", () => {
  test("TRANSIENT_WORKING_LABELS includes compaction and working labels", () => {
    expect(TRANSIENT_WORKING_LABELS.has("Compacting conversation context...")).toBe(true);
    expect(TRANSIENT_WORKING_LABELS.has("Working…")).toBe(true);
    expect(TRANSIENT_WORKING_LABELS.has("Connecting to custom model...")).toBe(true);
    expect(TRANSIENT_WORKING_LABELS.has("Generating response...")).toBe(true);
  });

  test("filters transient activities from transcript arrays", () => {
    const transcript: TranscriptMessage[] = [
      {
        kind: "message",
        id: "msg-1",
        role: "user",
        text: "Hello",
        createdAt: "2026-09-22T10:00:00Z",
      },
      {
        kind: "message",
        id: "msg-2",
        role: "assistant",
        text: "Hi there!",
        createdAt: "2026-09-22T10:00:05Z",
      },
      {
        kind: "activity",
        id: "act-compaction",
        label: "Compacting conversation context...",
        createdAt: "2026-09-22T10:00:06Z",
      } as TimelineActivity,
      {
        kind: "activity",
        id: "act-working",
        label: "Working…",
        createdAt: "2026-09-22T10:00:07Z",
      } as TimelineActivity,
    ];

    const filtered = transcript.filter(
      (item) => !(item.kind === "activity" && TRANSIENT_WORKING_LABELS.has(item.label)),
    );

    expect(filtered).toHaveLength(2);
    expect(filtered[0]?.id).toBe("msg-1");
    expect(filtered[1]?.id).toBe("msg-2");
    expect(filtered.some((item) => item.kind === "activity" && item.label === "Compacting conversation context...")).toBe(false);
  });

  test("preserves non-transient activities (errors, notifications, summaries)", () => {
    const transcript: TranscriptMessage[] = [
      {
        kind: "activity",
        id: "act-error",
        label: "Context window exceeded",
        tone: "error",
        createdAt: "2026-09-22T10:00:00Z",
      } as TimelineActivity,
      {
        kind: "activity",
        id: "act-compaction",
        label: "Compacting conversation context...",
        createdAt: "2026-09-22T10:00:01Z",
      } as TimelineActivity,
    ];

    const filtered = transcript.filter(
      (item) => !(item.kind === "activity" && TRANSIENT_WORKING_LABELS.has(item.label)),
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("act-error");
  });
});
