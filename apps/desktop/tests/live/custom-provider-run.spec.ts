import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";

const providerId = "custom-local-test";
const modelId = "gemma-local.gguf";

test("custom provider shows request progress and streams the final answer", async () => {
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

test("custom provider compaction timeout clears Working and restores the composer", async () => {
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
    envOverrides: { PI_APP_CUSTOM_MODEL_TIMEOUT_MS: "500" },
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Custom provider compaction timeout");
    await window.getByTestId("composer").fill(`Remember this context: ${"x".repeat(24_000)}`);
    await window.getByTestId("composer").press("Enter");

    const transcript = window.getByTestId("transcript");
    await expect(transcript).toContainText("BEFORE_COMPACTION");
    await expect(transcript).toContainText("Compacting conversation context...");
    await expect.poll(async () => (await getDesktopState(window)).workspaces[0]?.sessions[0]?.status, {
      timeout: 10_000,
    }).toBe("failed");
    await expect(transcript).toContainText("Conversation compaction timed out");
    await expect(transcript).not.toContainText("Working…");
    await expect(window.getByTestId("composer")).toBeEnabled();
    expect(requestCount).toBe(2);
  } finally {
    await harness.close();
    await close(server);
  }
});

async function prepareCustomProvider(
  port: number,
  options: {
    readonly contextWindow?: number;
    readonly compaction?: { readonly reserveTokens: number; readonly keepRecentTokens: number };
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
    defaultThinkingLevel: "off",
    enabledModels: [`${providerId}/${modelId}`],
    ...(options.compaction ? { compaction: { enabled: true, ...options.compaction } } : {}),
  }, null, 2)}\n`, "utf8");
  await writeFile(join(agentDir, "models.json"), `${JSON.stringify({
    providers: {
      [providerId]: {
        name: "Local test",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        api: "openai-completions",
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
