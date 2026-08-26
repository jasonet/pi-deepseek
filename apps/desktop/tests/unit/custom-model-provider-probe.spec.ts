import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { probeCustomModelProvider } from "../../electron/custom-model-provider-probe";

test("probe verifies model discovery and an OpenAI-compatible SSE completion", async () => {
  const requests: string[] = [];
  let completionBody: Record<string, unknown> | undefined;
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    expect(request.headers.authorization).toBe("Bearer probe-key");
    if (request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "local-model", meta: { n_ctx: 4_096 } }] }));
      return;
    }
    if (request.url === "/props") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ chat_template: "{% if enable_thinking %}think{% endif %}" }));
      return;
    }
    if (request.url === "/v1/chat/completions") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        completionBody = JSON.parse(body) as Record<string, unknown>;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(`data: ${JSON.stringify({
          choices: [{ index: 0, delta: { content: "O" }, finish_reason: null }],
        })}\n\ndata: [DONE]\n\n`);
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Probe test server did not bind.");

  try {
    const result = await probeCustomModelProvider({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: "probe-key",
    }, fetch);

    expect(result).toMatchObject({
      ok: true,
      message: "Connected. Found 1 model and verified streaming.",
      thinkingFormat: "qwen-chat-template",
      recommendedModelId: "local-model",
      models: [{ id: "local-model", contextWindow: 4_096 }],
    });
    expect(completionBody).toMatchObject({
      chat_template_kwargs: { enable_thinking: false, preserve_thinking: true },
    });
    expect(requests).toEqual(["GET /v1/models", "GET /props", "POST /v1/chat/completions"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("probe recommends Gemma 4 26B A4B and allows saving when generation is slow", async () => {
  let completionBody: Record<string, unknown> | undefined;
  const preferredModelId = "/models/gemma-4-26B-A4B-it-mlx";
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname === "/v1/models") {
      return new Response(JSON.stringify({
        data: [
          { id: "other-model" },
          { id: "mlx-community/diffusiongemma-26B-A4B-it-5bit" },
          { id: preferredModelId },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/props") {
      return new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/v1/chat/completions") {
      completionBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      throw new DOMException("The operation timed out", "TimeoutError");
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const result = await probeCustomModelProvider({
    baseUrl: "http://127.0.0.1:8080/v1",
  }, fetcher);

  expect(result).toMatchObject({
    ok: true,
    recommendedModelId: preferredModelId,
    message: "Connected. Found 3 models. Model generation did not start within 15 seconds; you can still save this provider.",
  });
  expect(completionBody).toMatchObject({ model: preferredModelId });
});
