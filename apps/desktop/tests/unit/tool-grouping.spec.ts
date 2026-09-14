import { expect, test } from "@playwright/test";
import { groupTranscript } from "../../src/conversation-timeline";
import type { TimelineActivity, TimelineSummary, TimelineToolCall, TranscriptMessage } from "../../src/timeline-types";

function makeTool(id: string, label: string, status: "running" | "success" | "error" = "success"): TimelineToolCall {
  return {
    kind: "tool",
    id,
    callId: `call-${id}`,
    toolName: "bash",
    status,
    label,
    createdAt: new Date().toISOString(),
  };
}

test.describe("tool grouping in conversation timeline", () => {
  test("groups multiple consecutive tool calls into a single tool-group", () => {
    const transcript: TranscriptMessage[] = [
      {
        kind: "message",
        id: "msg-1",
        role: "user",
        text: "Please inspect the project",
        createdAt: "2026-09-14T10:00:00Z",
      },
      makeTool("t-1", "Ran bash: ls -la"),
      makeTool("t-2", "Ran bash: head -n 100 README_zh.md"),
      makeTool("t-3", "Ran bash: grep -n 'start' README_zh.md"),
      makeTool("t-4", "Ran bash: sed -n '1,10p' README_zh.md"),
      makeTool("t-5", "Ran bash: which python3"),
      makeTool("t-6", "Ran bash: uv python list"),
      makeTool("t-7", "Ran bash: find . -maxdepth 2"),
      makeTool("t-8", "Ran bash: docker info"),
      makeTool("t-9", "Ran bash: head -n 30 package.json"),
      makeTool("t-10", "Ran bash: head -n 50 pyproject.toml"),
      {
        kind: "message",
        id: "msg-2",
        role: "assistant",
        text: "Here is the inspection summary.",
        createdAt: "2026-09-14T10:01:00Z",
      },
    ];

    const entries = groupTranscript(transcript);

    // Should have: user message, 1 tool-group (containing 10 tools), assistant message
    expect(entries).toHaveLength(3);
    expect(entries[0]!.kind).toBe("message");
    expect(entries[1]!.kind).toBe("tool-group");
    expect(entries[2]!.kind).toBe("message");

    const group = entries[1] as Extract<(typeof entries)[number], { kind: "tool-group" }>;
    expect(group.tools).toHaveLength(10);
    expect(group.tools[0]!.label).toBe("Ran bash: ls -la");
    expect(group.tools[9]!.label).toBe("Ran bash: head -n 50 pyproject.toml");
  });

  test("keeps a single tool call as an individual tool entry", () => {
    const transcript: TranscriptMessage[] = [
      {
        kind: "message",
        id: "msg-1",
        role: "user",
        text: "List files",
        createdAt: "2026-09-14T10:00:00Z",
      },
      makeTool("t-1", "Ran bash: ls -la"),
      {
        kind: "message",
        id: "msg-2",
        role: "assistant",
        text: "Listed files.",
        createdAt: "2026-09-14T10:01:00Z",
      },
    ];

    const entries = groupTranscript(transcript);
    expect(entries).toHaveLength(3);
    expect(entries[1]!.kind).toBe("tool");
  });

  test("suppresses redundant Working… activity immediately preceding tool calls", () => {
    const transcript: TranscriptMessage[] = [
      {
        kind: "activity",
        id: "act-1",
        label: "Working…",
        createdAt: "2026-09-14T10:00:00Z",
      } as TimelineActivity,
      makeTool("t-1", "Ran bash: ls -la"),
      makeTool("t-2", "Ran bash: pwd"),
    ];

    const entries = groupTranscript(transcript);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("tool-group");
  });

  test("suppresses redundant inline summary immediately following a tool group", () => {
    const transcript: TranscriptMessage[] = [
      makeTool("t-1", "Ran bash: ls -la"),
      makeTool("t-2", "Ran bash: pwd"),
      {
        kind: "summary",
        id: "sum-1",
        label: "Used 2 tools",
        presentation: "inline",
        createdAt: "2026-09-14T10:00:01Z",
      } as TimelineSummary,
      {
        kind: "summary",
        id: "sum-2",
        label: "Worked for 2s",
        presentation: "divider",
        createdAt: "2026-09-14T10:00:02Z",
      } as TimelineSummary,
    ];

    const entries = groupTranscript(transcript);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.kind).toBe("tool-group");
    expect(entries[1]!.kind).toBe("summary");
    expect((entries[1] as TimelineSummary).presentation).toBe("divider");
  });

  test("correctly groups multiple separate tool execution phases in a conversation", () => {
    const transcript: TranscriptMessage[] = [
      makeTool("t-1", "Ran bash: ls -la"),
      makeTool("t-2", "Ran bash: pwd"),
      {
        kind: "message",
        id: "msg-1",
        role: "assistant",
        text: "Phase 1 complete.",
        createdAt: "2026-09-14T10:00:00Z",
      },
      makeTool("t-3", "Ran bash: git status"),
      makeTool("t-4", "Ran bash: git diff"),
      makeTool("t-5", "Ran bash: git log"),
      {
        kind: "message",
        id: "msg-2",
        role: "assistant",
        text: "Phase 2 complete.",
        createdAt: "2026-09-14T10:01:00Z",
      },
    ];

    const entries = groupTranscript(transcript);
    expect(entries).toHaveLength(4);
    expect(entries[0]!.kind).toBe("tool-group");
    expect((entries[0] as any).tools).toHaveLength(2);
    expect(entries[1]!.kind).toBe("message");
    expect(entries[2]!.kind).toBe("tool-group");
    expect((entries[2] as any).tools).toHaveLength(3);
    expect(entries[3]!.kind).toBe("message");
  });
});
