import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { compactionResourceOptions, compactionTimeoutMs } from "../dist/compaction-policy.js";

function event(overrides = {}) {
  return {
    type: "session_before_compact", signal: new AbortController().signal, branchEntries: [],
    preparation: {
      firstKeptEntryId: "kept-message", messagesToSummarize: [{ role: "user", content: "Earlier task", timestamp: 1 }],
      turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 1000,
      fileOps: { read: new Set(["first.ts"]), edited: new Set(), written: new Set() },
      settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 512 },
    },
    ...overrides,
  };
}

async function fixture(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let summarize;
  const options = compactionResourceOptions();
  options.extensionFactories[0]({ on: (_, callback) => { summarize = callback; } });
  const warnings = [];
  const ctx = {
    model: {
      id: "test", name: "Test", api: "openai-completions", provider: "custom-test",
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, reasoning: true,
      input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_768, maxTokens: 8192,
      compat: { thinkingFormat: "qwen-chat-template", supportsDeveloperRole: false, maxTokensField: "max_tokens" },
    },
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key" }) },
    ui: { notify: (message) => warnings.push(message) },
  };
  return {
    summarize: (value) => summarize(value, ctx), options, callback: summarize, warnings,
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); },
  };
}

test("successive SDK summaries preserve file tracking through the hook boundary", async () => {
  const f = await fixture((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "SUMMARY" }, finish_reason: null }] })}\n\n`);
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  try {
    const firstEvent = event();
    const first = await f.summarize(firstEvent);
    assert.deepEqual(first.compaction.details.readFiles, ["first.ts"]);
    const secondEvent = event({ branchEntries: [{ type: "compaction", fromHook: true, details: first.compaction.details }] });
    secondEvent.preparation.fileOps.read.clear();
    secondEvent.preparation.fileOps.edited.add("second.ts");
    const second = await f.summarize(secondEvent);
    assert.deepEqual(second.compaction.details.readFiles, ["first.ts"]);
    assert.deepEqual(second.compaction.details.modifiedFiles, ["second.ts"]);
    assert.equal(secondEvent.preparation.fileOps.read.size, 0);
    assert.equal(firstEvent.preparation.settings.reserveTokens, 16_384);
    const own = { handlers: new Map([["session_before_compact", [f.callback]]]) };
    const custom = { handlers: new Map([["session_before_compact", [() => {}]]]) };
    assert.deepEqual(f.options.extensionsOverride({ extensions: [custom, own] }).extensions, [custom]);
  } finally { await f.close(); }
});

test("a failed split summary cancels its stalled sibling before retrying", async () => {
  let requests = 0;
  let stalledClosed = 0;
  let failedResponse;
  const f = await fixture((request, response) => {
    request.resume();
    requests += 1;
    if (requests % 2 === 1) failedResponse = response;
    else {
      response.on("close", () => { stalledClosed += 1; });
      failedResponse.writeHead(400, { "content-type": "application/json" });
      failedResponse.end(JSON.stringify({ error: { message: "Test summary rejection" } }));
    }
  });
  try {
    const input = event();
    input.preparation.isSplitTurn = true;
    input.preparation.turnPrefixMessages = [{ role: "user", content: "Current turn", timestamp: 2 }];
    assert.deepEqual(await f.summarize(input), { cancel: true });
    for (let count = 0; count < 100 && stalledClosed < 2; count += 1) await delay(10);
    assert.equal(requests, 4);
    assert.equal(stalledClosed, 2);
    assert.equal(f.warnings.length, 1);
  } finally { await f.close(); }
});

test("compaction deadline rejects invalid configuration", () => {
  const previous = process.env.PI_APP_COMPACTION_TIMEOUT_MS;
  try {
    for (const value of ["", "-1", "invalid", "Infinity"]) {
      process.env.PI_APP_COMPACTION_TIMEOUT_MS = value;
      assert.equal(compactionTimeoutMs(), 150_000);
    }
    process.env.PI_APP_COMPACTION_TIMEOUT_MS = "500";
    assert.equal(compactionTimeoutMs(), 500);
  } finally {
    if (previous === undefined) delete process.env.PI_APP_COMPACTION_TIMEOUT_MS;
    else process.env.PI_APP_COMPACTION_TIMEOUT_MS = previous;
  }
});
