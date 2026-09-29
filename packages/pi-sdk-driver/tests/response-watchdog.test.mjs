import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { withResponseWatchdog } from "../dist/response-watchdog.js";

const model = { id: "test", provider: "deepseek", api: "openai-completions" };
const context = { messages: [] };
const deadlines = { firstResponseMs: 80, idleMs: 80 };
function fixture() {
  const source = createAssistantMessageEventStream();
  const message = {
    role: "assistant", content: [], api: model.api, model: model.id, provider: model.provider,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: Date.now(),
  };
  let signal;
  const output = withResponseWatchdog((_model, _context, options) => {
    signal = options.signal;
    return source;
  }, deadlines)(model, context);
  const events = (async () => { const seen = []; for await (const event of output) seen.push(event); return seen; })();
  source.push({ type: "start", partial: message });
  return { source, message, output, events, signal };
}

test("response headers/start without content cannot keep a request alive", async () => {
  const { output, signal, events } = fixture();
  await delay(120);
  const result = await output.result();
  assert.equal(result.stopReason, "aborted");
  assert.match(result.errorMessage, /no initial content/);
  assert.equal(signal.aborted, true);
  assert.deepEqual((await events).map((event) => event.type), ["start", "error"]);
});

test("partial content survives a stall and late mutation cannot overwrite the failure", async () => {
  const { source, message, output, events } = fixture();
  message.content.push({ type: "text", text: "keep me" });
  source.push({ type: "text_delta", delta: "keep me", contentIndex: 0, partial: message });
  await delay(120);
  const result = await output.result();
  assert.match(result.errorMessage, /no new content/);
  message.content[0].text = "late mutation";
  source.push({ type: "done", reason: "stop", message });
  assert.equal(result.content[0].text, "keep me");
  assert.equal((await events).filter((event) => event.type === "error").length, 1);
  assert.equal((await output.result()).stopReason, "aborted");
});

test("cancelled tool calls do not persist duplicate streaming argument buffers", async () => {
  const { source, message, output } = fixture();
  const argumentsText = "x".repeat(1_000_000);
  message.content.push({
    type: "toolCall", id: "test-call", name: "test-tool", arguments: { text: argumentsText },
    index: 0, streamIndex: 0, partialArgs: argumentsText, partialJson: argumentsText,
  });
  source.push({ type: "toolcall_delta", contentIndex: 0, delta: argumentsText, partial: message });
  await delay(120);
  const result = await output.result();
  assert.deepEqual(result.content[0], {
    type: "toolCall", id: "test-call", name: "test-tool", arguments: { text: argumentsText },
  });
  assert.ok(JSON.stringify(result).length < 1_010_000);
  assert.equal(message.content[0].partialArgs.length, 1_000_000);
});

for (const type of ["text_delta", "thinking_delta", "toolcall_delta"]) {
  test(`${type} refreshes the deadline; completed calls leave no timer during tools`, async () => {
    const { source, message, output, signal, events } = fixture();
    for (let i = 0; i < 6; i += 1) {
      source.push({ type, delta: "x", contentIndex: 0, partial: message });
      await delay(25);
      assert.equal(signal.aborted, false);
    }
    source.push({ type: "done", reason: "stop", message });
    assert.equal((await output.result()).stopReason, "stop");
    await delay(120);
    assert.equal(signal.aborted, false);
    assert.equal((await events).at(-1).type, "done");
  });
}

test("empty deltas do not refresh the deadline and sessions stay isolated", async () => {
  const stalled = fixture();
  const active = fixture();
  for (let i = 0; i < 6; i += 1) {
    stalled.source.push({ type: "text_delta", delta: "", contentIndex: 0, partial: stalled.message });
    active.source.push({ type: "thinking_delta", delta: "x", contentIndex: 0, partial: active.message });
    await delay(25);
  }
  assert.equal((await stalled.output.result()).stopReason, "aborted");
  assert.equal(active.signal.aborted, false);
  active.source.push({ type: "done", reason: "stop", message: active.message });
  assert.equal((await active.output.result()).stopReason, "stop");
});

test("Stop settles an uncooperative asynchronous stream factory immediately", async () => {
  const stop = new AbortController();
  let resolveSource;
  let signal;
  const source = createAssistantMessageEventStream();
  const output = withResponseWatchdog((_m, _c, options) => {
    signal = options.signal;
    return new Promise((resolve) => { resolveSource = resolve; });
  }, deadlines)(model, context, { signal: stop.signal });
  stop.abort();
  assert.equal((await output.result()).stopReason, "aborted");
  assert.equal(signal.aborted, true);
  resolveSource(source);
  await delay(120);
  assert.match((await source.result()).errorMessage, /cancelled/);
});

test("a stream factory that never resolves is bounded too", async () => {
  const output = withResponseWatchdog(() => new Promise(() => {}), deadlines)(model, context);
  await delay(120);
  assert.match((await output.result()).errorMessage, /no initial content/);
});

test("first content switches from the longer first-response deadline to the idle deadline", async () => {
  const source = createAssistantMessageEventStream();
  let signal;
  const output = withResponseWatchdog((_m, _c, options) => {
    signal = options.signal;
    return source;
  }, { firstResponseMs: 1_000, idleMs: 80 })(model, context);
  await delay(120);
  assert.equal(signal.aborted, false);
  const partial = { role: "assistant", content: [{ type: "text", text: "x" }], stopReason: "stop" };
  source.push({ type: "text_delta", delta: "x", contentIndex: 0, partial });
  await delay(120);
  assert.equal(signal.aborted, true);
  assert.match((await output.result()).errorMessage, /no new content/);
});

test("upstream failures and malformed closure settle through the SDK protocol", async () => {
  const thrown = withResponseWatchdog(() => { throw new Error("test failure"); }, deadlines)(model, context);
  assert.equal((await thrown.result()).errorMessage, "test failure");
  const { source, output } = fixture();
  source.end();
  assert.match((await output.result()).errorMessage, /without a completion event/);
});
