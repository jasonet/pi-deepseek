import { expect, test } from "@playwright/test";
import { RendererPublisher } from "../../electron/renderer-publisher";
import { MAX_RENDERER_TRANSCRIPT_BYTES, rendererTranscript } from "../../electron/renderer-transcript";

test("backpressure keeps only the newest snapshot until the matching acknowledgement", async () => {
  const sent: { payload: number; sequence: number }[] = [];
  const publisher = new RendererPublisher<number>((payload, sequence) => sent.push({ payload, sequence }));
  try {
    publisher.push(() => 0);
    await expect.poll(() => sent.length).toBe(1);
    for (let index = 1; index <= 1000; index++) publisher.push(() => index);
    publisher.acknowledge(-1);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(sent).toHaveLength(1);
    publisher.acknowledge(sent[0]!.sequence);
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]!.payload).toBe(1000);
    publisher.reset();
    publisher.push(() => 1001);
    await expect.poll(() => sent.length).toBe(3);
    publisher.push(() => 1002);
    publisher.acknowledge(sent[1]!.sequence);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(sent).toHaveLength(3);
  } finally {
    publisher.reset();
  }
});

test("display records bound UTF-8 bytes and oversized latest items without changing history", () => {
  const latest = { kind: "message" as const, role: "assistant" as const, id: "latest", createdAt: "now", text: "中文".repeat(2_000_000) };
  const history = Array.from({ length: 200 }, (_, index) => ({ ...latest, id: String(index), text: "中文".repeat(20_000) }));
  history.push(latest);
  const display = rendererTranscript(history);
  expect(Buffer.byteLength(JSON.stringify(display))).toBeLessThanOrEqual(MAX_RENDERER_TRANSCRIPT_BYTES);
  expect(display.at(-1)?.id).toBe("latest");
  expect(JSON.stringify(display.at(-1))).toContain("Display preview shortened");
  expect(latest.text.length).toBe(4_000_000);
  expect(history).toHaveLength(201);
});
