import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  writeProjectExtension,
} from "../helpers/electron-app";

const providerId = "custom-local-test";
const modelId = "gemma-local.gguf";

test("custom provider shows request progress and streams the final answer", async ({}, testInfo) => {
  test.setTimeout(60_000);
  let requestCount = 0;
  let requestPayload: Record<string, unknown> | undefined;
  const server = createServer((request, response) => {
    if (request.url !== "/v1/chat/completions" || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requestCount += 1;
      requestPayload = JSON.parse(body) as Record<string, unknown>;
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.flushHeaders();
        setTimeout(() => {
          response.write(`data: ${JSON.stringify({
            id: "local-success",
            object: "chat.completion.chunk",
            model: modelId,
            choices: [{ index: 0, delta: { content: "LOCAL_OK" }, finish_reason: null }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: "local-success",
            object: "chat.completion.chunk",
            model: modelId,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\n`);
          response.end("data: [DONE]\n\n");
        }, 400);
      }, 300);
    });
  });
  const port = await listen(server);
  const { agentDir, userDataDir, workspacePath } = await prepareCustomProvider(port);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Custom provider progress");
    await window.getByTestId("composer").fill("Reply with exactly LOCAL_OK.");
    await window.getByTestId("composer").press("Enter");
    await window.screenshot({ path: testInfo.outputPath("submitted.png") });

    const transcript = window.getByTestId("transcript");
    await expect(transcript).toContainText("Connecting to custom model...");
    await expect(transcript).toContainText("Generating response...");
    await expect(transcript).toContainText("LOCAL_OK");
    await expect.poll(async () => (await getDesktopState(window)).workspaces[0]?.sessions[0]?.status).toBe("idle");

    expect(requestPayload).toMatchObject({ model: modelId, stream: true });
    expect(requestPayload).toMatchObject({
      chat_template_kwargs: { enable_thinking: false, preserve_thinking: true },
    });
    expect(requestPayload).not.toHaveProperty("reasoning_effort");
    // Wait past the delayed title-generation window so a hidden second model
    // request cannot slip through after the visible answer has completed.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(requestCount).toBe(1);
  } finally {
    await harness.close();
    await close(server);
  }
});

test("custom provider timeout fails once instead of staying in Working", async () => {
  test.setTimeout(30_000);
  let requestCount = 0;
  const server = createServer((request) => {
    if (request.url === "/v1/chat/completions") {
      requestCount += 1;
      request.resume();
    }
  });
  const port = await listen(server);
  const { agentDir, userDataDir, workspacePath } = await prepareCustomProvider(port);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
    envOverrides: { PI_APP_CUSTOM_MODEL_TIMEOUT_MS: "500" },
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Custom provider timeout");
    await window.getByTestId("composer").fill("This request should time out.");
    await window.getByTestId("composer").press("Enter");

    await expect(window.getByTestId("transcript")).toContainText("Connecting to custom model...");
    await expect.poll(async () => (await getDesktopState(window)).workspaces[0]?.sessions[0]?.status, {
      timeout: 10_000,
    }).toBe("failed");
    await expect(window.locator(".timeline-activity--error")).toBeVisible();
    expect(requestCount).toBe(1);
  } finally {
    await harness.close();
    await close(server);
  }
});

test("failed compaction attempts preserve the answer and restore the composer", async () => {
  test.setTimeout(30_000);
  let requestCount = 0;
  const server = createServer((request, response) => {
    if (request.url !== "/v1/chat/completions" || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }

    request.resume();
    requestCount += 1;
    if (requestCount > 1) {
      return;
    }

    response.writeHead(200, { "content-type": "text/event-stream" });
    response.flushHeaders();
    response.write(`data: ${JSON.stringify({
      id: "local-compaction",
      object: "chat.completion.chunk",
      model: modelId,
      choices: [{ index: 0, delta: { content: "BEFORE_COMPACTION" }, finish_reason: null }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      id: "local-compaction",
      object: "chat.completion.chunk",
      model: modelId,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 5_000, completion_tokens: 1, total_tokens: 5_001 },
    })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  const port = await listen(server);
  const { agentDir, userDataDir, workspacePath } = await prepareCustomProvider(port, {
    contextWindow: 4_096,
    compaction: { reserveTokens: 512, keepRecentTokens: 512 },
  });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
    envOverrides: { PI_APP_COMPACTION_TIMEOUT_MS: "1500" },
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Custom provider compaction timeout");
    await window.getByTestId("composer").fill(`Remember this context: ${"x".repeat(24_000)}`);
    await window.getByTestId("composer").press("Enter");

    const transcript = window.getByTestId("transcript");
    await expect(transcript).toContainText("BEFORE_COMPACTION");
    await expect(transcript).toContainText("Compacting conversation context...");
    await window.getByTestId("composer").fill("Keep this queued message for later.");
    await window.getByTestId("composer").press("Enter");
    await expect.poll(async () => (await getDesktopState(window)).workspaces[0]?.sessions[0]?.status, {
      timeout: 10_000,
    }).toBe("failed");
    await expect(transcript).toContainText("Context summary could not be completed after two attempts");
    await expect(transcript).toContainText("Queued messages are preserved");
    await expect(window.getByTestId("queued-composer-message")).toHaveCount(1);
    await expect(transcript).not.toContainText("Working…");
    await expect(window.getByTestId("composer")).toBeEnabled();
    expect(requestCount).toBe(3);
  } finally {
    await harness.close();
    await close(server);
  }
});

for (const retry of [false, true]) {
  test(`automatic compaction persists a summary with reasoning off${retry ? " after a stalled attempt" : ""}`, async ({}, testInfo) => {
    const summaryRequests: Record<string, any>[] = [];
    const agentRequests: Record<string, any>[] = [];
    let stalledRequestClosed = false;
    const server = createServer((request, response) => {
      if (request.url !== "/v1/chat/completions") { response.writeHead(404).end(); return; }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const payload = JSON.parse(body);
        const isSummary = JSON.stringify(payload.messages[0]).includes("context summarization assistant");
        if (isSummary) {
          summaryRequests.push(payload);
          if (retry && summaryRequests.length === 1) {
            response.on("close", () => { stalledRequestClosed = true; });
            return;
          }
        } else agentRequests.push(payload);
        writeCompletion(response, isSummary ? "PERSISTED_COMPACTION_SUMMARY" : "COMPACTION_CHAT_OK",
          !isSummary && agentRequests.length === 1 ? 20_000 : 100);
      });
    });
    const port = await listen(server);
    let harness: Awaited<ReturnType<typeof launchDesktop>> | undefined;
    try {
      // No enabled flag: exercise the SDK default rather than explicitly opting in.
      const { agentDir, userDataDir, workspacePath } = await prepareCustomProvider(port, {
        contextWindow: 32_768, thinkingLevel: "high",
        compaction: { reserveTokens: 16_384, keepRecentTokens: 512 },
      });
      harness = await launchDesktop(userDataDir, {
        agentDir, initialWorkspaces: [workspacePath], scrubProviderEnv: true, testMode: "background",
        envOverrides: { PI_APP_COMPACTION_TIMEOUT_MS: "5000" },
      });
      const window = await harness.firstWindow();
      await createNamedThread(window, "Automatic summary completion");
      await window.getByTestId("composer").fill(`Remember this context: ${"x".repeat(24_000)}`);
      await window.getByTestId("composer").press("Enter");
      const summaries = async () => {
        const root = join(agentDir, "sessions");
        const names = await readdir(root, { recursive: true });
        const entries = [];
        for (const name of names.filter((name) => name.endsWith(".jsonl"))) {
          const lines = (await readFile(join(root, name), "utf8")).trim().split("\n");
          entries.push(...lines.filter(Boolean).map((line) => JSON.parse(line)));
        }
        return entries.filter((entry) => entry.type === "compaction");
      };
      await expect.poll(async () => (await summaries()).length, { timeout: 15_000 }).toBe(1);
      expect((await summaries())[0].summary).toContain("PERSISTED_COMPACTION_SUMMARY");
      await expect.poll(async () => (await getDesktopState(window)).workspaces[0]?.sessions[0]?.status).toBe("idle");
      expect(summaryRequests).toHaveLength(retry ? 2 : 1);
      for (const request of summaryRequests) {
        expect(request.chat_template_kwargs.enable_thinking).toBe(false);
        expect(request).not.toHaveProperty("reasoning_effort");
        expect(request.max_tokens).toBeLessThanOrEqual(3_276);
      }
      if (retry) await expect.poll(() => stalledRequestClosed).toBe(true);
      expect(agentRequests[0].chat_template_kwargs.enable_thinking).toBe(true);
      await window.getByTestId("composer").fill("Continue after the saved summary.");
      await window.getByTestId("composer").press("Enter");
      await expect.poll(() => agentRequests.length).toBe(2);
      await expect.poll(async () => (await getDesktopState(window)).workspaces[0]?.sessions[0]?.status).toBe("idle");
      expect(JSON.stringify(agentRequests[1].messages)).toContain("PERSISTED_COMPACTION_SUMMARY");
      expect(agentRequests[1].chat_template_kwargs.enable_thinking).toBe(true);
      await expect(window.getByTestId("transcript")).not.toContainText("Compacting conversation context...");
      await window.screenshot({ path: testInfo.outputPath("compaction-completed.png") });
    } finally {
      try { await harness?.close(); } finally { await close(server); }
    }
  });
}

function writeCompletion(response: ServerResponse, content: string, promptTokens: number) {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({
    id: "summary-test", object: "chat.completion.chunk", model: modelId,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`);
  response.write(`data: ${JSON.stringify({
    id: "summary-test", object: "chat.completion.chunk", model: modelId,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: promptTokens, completion_tokens: 1, total_tokens: promptTokens + 1 },
  })}\n\n`);
  response.end("data: [DONE]\n\n");
}

for (const action of ["timeout", "stop", "queue"] as const) {
  test(`compaction ${action} handles an extension that delays cancellation`, async ({}, testInfo) => {
    let requestCount = 0;
    let compactionCount = 0;
    let released = false;
    const gates: ServerResponse[] = [];
    const release = () => {
      released = true;
      for (const response of gates.splice(0)) response.end("ready");
    };
    const server = createServer((request, response) => {
      request.resume();
      if (request.url === "/compaction-gate") {
        compactionCount += 1;
        if (released) response.end("ready");
        else gates.push(response);
        return;
      }
      if (request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      requestCount += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const content = requestCount === 1 ? "ANSWER_BEFORE_COMPACTION" : "ANSWER_AFTER_COMPACTION";
      response.write(`data: ${JSON.stringify({
        id: `compaction-${requestCount}`, object: "chat.completion.chunk", model: modelId,
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        id: `compaction-${requestCount}`, object: "chat.completion.chunk", model: modelId,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: requestCount === 1 ? 5_000 : 100, completion_tokens: 1 },
      })}\n\n`);
      response.end("data: [DONE]\n\n");
    });
    const port = await listen(server);
    const { agentDir, userDataDir, workspacePath } = await prepareCustomProvider(port, {
      contextWindow: 4_096,
      compaction: { reserveTokens: 512, keepRecentTokens: 512 },
    });
    await writeProjectExtension(workspacePath, "compaction-gate.ts", `
      export default function(pi) {
        pi.on("session_before_compact", async (event, ctx) => {
          // Intentionally ignore the abort signal until the test releases the gate.
          await fetch("http://127.0.0.1:${port}/compaction-gate");
          setTimeout(() => ctx.ui.notify("Compaction hook returned"), 0);
          return { compaction: {
            summary: "Earlier context summarized for the test.",
            firstKeptEntryId: event.preparation.firstKeptEntryId,
            tokensBefore: event.preparation.tokensBefore,
          } };
        });
      }
    `);
    const harness = await launchDesktop(userDataDir, {
      agentDir, initialWorkspaces: [workspacePath], scrubProviderEnv: true, testMode: "background",
      envOverrides: {
        PI_APP_CUSTOM_MODEL_TIMEOUT_MS: "30000",
        PI_APP_COMPACTION_TIMEOUT_MS: action === "timeout" ? "1000" : "15000",
      },
    });
    try {
      const window = await harness.firstWindow();
      await createNamedThread(window, `Compaction ${action}`);
      const composer = window.getByTestId("composer");
      const transcript = window.getByTestId("transcript");
      const status = async () => (await getDesktopState(window)).workspaces[0]?.sessions[0]?.status;
      await composer.fill(`Remember this context: ${"x".repeat(24_000)}`);
      await composer.press("Enter");
      await expect(transcript).toContainText("ANSWER_BEFORE_COMPACTION");
      await expect.poll(() => compactionCount).toBe(1);
      await expect(transcript).toContainText("Compacting conversation context...");

      if (action === "timeout") {
        // Terminal UI must not depend on the extension returning compaction_end.
        await expect.poll(status, { timeout: 5_000 }).toBe("failed");
        await expect(transcript).toContainText("Conversation compaction timed out");
      } else if (action === "stop") {
        await window.getByRole("button", { name: "Stop run", exact: true }).click();
        await expect.poll(status).toBe("idle");
      } else {
        await composer.fill("Continue with a short answer.");
        await composer.press("Enter");
        await expect(window.getByTestId("queued-composer-message")).toHaveCount(1);
        expect(requestCount).toBe(1);
        expect(compactionCount).toBe(1);
      }
      await window.screenshot({ path: testInfo.outputPath(`compaction-${action}.png`) });
      release();
      if (action !== "queue") {
        // Let the late SDK event arrive: Stop must stay idle, timeout must stay failed.
        await expect(transcript).toContainText("Compaction hook returned");
        await expect.poll(status).toBe(action === "timeout" ? "failed" : "idle");
        await expect(window.locator(".timeline-activity--error")).toHaveCount(action === "timeout" ? 1 : 0);
        await composer.fill("Continue after the stopped compaction.");
        await composer.press("Enter");
      }
      await expect(transcript).toContainText("ANSWER_AFTER_COMPACTION");
      await expect.poll(status).toBe("idle");
      await expect(transcript).not.toContainText("Compacting conversation context...");
      await expect(composer).toBeEnabled();
      expect(requestCount).toBe(2);
    } finally {
      release();
      await harness.close();
      await close(server);
    }
  });
}

async function prepareCustomProvider(
  port: number,
  options: {
    readonly contextWindow?: number;
    readonly compaction?: { readonly enabled?: boolean; readonly reserveTokens: number; readonly keepRecentTokens: number };
    readonly thinkingLevel?: string;
  } = {},
) {
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("custom-provider-run-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    enabledModels: [`${providerId}/${modelId}`],
  });
  await writeFile(join(agentDir, "auth.json"), `${JSON.stringify({
    [providerId]: { type: "api_key", key: "test-custom-key" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(agentDir, "settings.json"), `${JSON.stringify({
    defaultProvider: providerId,
    defaultModel: modelId,
    defaultThinkingLevel: options.thinkingLevel ?? "off",
    enabledModels: [`${providerId}/${modelId}`],
    ...(options.compaction ? { compaction: options.compaction } : {}),
  }, null, 2)}\n`, "utf8");
  await writeFile(join(agentDir, "models.json"), `${JSON.stringify({
    providers: {
      [providerId]: {
        name: "Local test",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        api: "openai-completions",
        apiKey: "test-custom-key",
        authHeader: true,
        compat: {
          thinkingFormat: "qwen-chat-template",
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
        },
        models: [{
          id: modelId,
          name: "Local Gemma",
          reasoning: true,
          input: ["text"],
          contextWindow: options.contextWindow ?? 81_920,
          maxTokens: 128,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }],
      },
    },
  }, null, 2)}\n`, "utf8");
  return { agentDir, userDataDir, workspacePath };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
