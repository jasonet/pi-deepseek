import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import {
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  seedAgentDir,
  stubNextOpenDialog,
} from "../helpers/electron-app";

test("settings lets the user save an API key for a built-in provider", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("provider-settings-api-key-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["openai/gpt-5", "openai/gpt-4o"],
  });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Providers", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Providers");

    const allProviders = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "All providers" }),
    });
    await expect(allProviders.locator(".settings-disclosure")).toHaveAttribute("open", "");
    const openAiRow = allProviders.locator(".settings-row", {
      has: window.locator(".settings-row__title", { hasText: /^OpenAI$/ }),
    });
    await expect(openAiRow).toContainText("API key");
    await openAiRow.getByRole("button", { name: "Set API key" }).click();

    const dialog = window.getByTestId("provider-api-key-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("OpenAI API key").fill("test-openai-key");
    await dialog.getByRole("button", { name: "Set API key" }).click();
    await expect(dialog).toHaveCount(0);

    const connectedProviders = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: /^Connected$/ }),
    });
    await expect(connectedProviders).toContainText("OpenAI");
    await expect(connectedProviders).toContainText("API key");
    await expect(connectedProviders.getByRole("button", { name: "Manage" })).toBeVisible();

    await window.getByRole("button", { name: "Models", exact: true }).click();
    const enabledModels = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Enabled models" }),
    });
    await expect(enabledModels).toContainText("openai/gpt-5");
    await expect(enabledModels).toContainText("openai/gpt-4o");
  } finally {
    await harness.close();
  }
});

test("settings discovers and saves an OpenAI-compatible custom provider", async () => {
  test.setTimeout(90_000);
  const modelId = "/models/gemma-4-26B-A4B-it-mlx";
  const secondaryModelId = "local-coder.gguf";
  let completionBody: Record<string, unknown> | undefined;
  const server = createServer((request, response) => {
    if (request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        object: "list",
        data: [
          { id: secondaryModelId, object: "model", owned_by: "local" },
          { id: modelId, object: "model", owned_by: "local", meta: { n_ctx: 81_920 } },
        ],
        models: [{
          name: modelId,
          model: modelId,
          capabilities: ["completion", "multimodal"],
        }],
      }));
      return;
    }
    if (request.url === "/props") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ chat_template: "{% if enable_thinking %}think{% endif %}" }));
      return;
    }
    if (request.url === "/v1/chat/completions" && request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        completionBody = JSON.parse(body) as Record<string, unknown>;
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        response.write(`data: ${JSON.stringify({
          id: "probe-completion",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }],
        })}\n\n`);
        response.end("data: [DONE]\n\n");
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Custom provider test server did not bind.");

  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("custom-provider-settings-workspace");
  const secondaryWorkspacePath = await makeWorkspace("custom-provider-settings-secondary-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["openai/gpt-4o"],
  });
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify({
      providers: {
        "custom-lab-llama-cpp": {
          compat: { thinkingFormat: "qwen-chat-template", supportsStore: true },
          models: [],
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath, secondaryWorkspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await window.getByRole("button", { name: "Providers", exact: true }).click();
    await window.getByRole("button", { name: "Add provider", exact: true }).click();

    const dialog = window.getByTestId("custom-provider-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Provider name").fill("Lab llama.cpp");
    await dialog.getByLabel("Base URL").fill(`http://127.0.0.1:${address.port}/v1`);
    await dialog.getByRole("button", { name: "Test connection" }).click();
    await expect(dialog).toContainText("Connected. Found 2 models and verified streaming.");
    await expect(dialog).toContainText(modelId);
    const preferredModel = dialog.locator(".custom-provider-dialog__model", { hasText: modelId });
    const secondaryModel = dialog.locator(".custom-provider-dialog__model", { hasText: secondaryModelId });
    await expect(preferredModel.locator("input[type=checkbox]").first()).toBeChecked();
    await expect(secondaryModel.locator("input[type=checkbox]").first()).not.toBeChecked();
    await expect(preferredModel.getByLabel("Images")).toBeChecked();
    await preferredModel.getByLabel("Reasoning").check();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    const providerRow = window.getByTestId("custom-provider-custom-lab-llama-cpp");
    await expect(providerRow).toContainText("Lab llama.cpp");
    await expect(providerRow).toContainText(`http://127.0.0.1:${address.port}/v1`);

    const modelsConfig = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8"));
    const customProvider = modelsConfig.providers["custom-lab-llama-cpp"];
    expect(customProvider.api).toBe("openai-completions");
    expect(customProvider.compat).toEqual({
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
      thinkingFormat: "qwen-chat-template",
    });
    expect(customProvider.models[0]).toMatchObject({
      id: modelId,
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 81_920,
    });
    expect(customProvider.models).toHaveLength(1);
    expect(completionBody).toMatchObject({ model: modelId });
    const authConfig = JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8"));
    expect(authConfig["custom-lab-llama-cpp"]).toEqual({ type: "api_key", key: "pi-deepseek-local" });

    await window.getByRole("button", { name: "Models", exact: true }).click();
    await expect(window.getByText(`custom-lab-llama-cpp/${modelId}`, { exact: true })).toBeVisible();

    await window.getByRole("button", { name: "Providers", exact: true }).click();
    await providerRow.getByRole("button", { name: "Edit", exact: true }).click();
    await dialog.getByRole("button", { name: "Test connection" }).click();
    await expect(dialog).toContainText("Connected. Found 2 models and verified streaming.");
    await preferredModel.locator("input[type=checkbox]").first().uncheck();
    await secondaryModel.locator("input[type=checkbox]").first().check();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const workspaceIds = (await getDesktopState(window)).workspaces
      .filter((workspace) => workspace.path === workspacePath || workspace.path === secondaryWorkspacePath)
      .map((workspace) => workspace.id);
    expect(workspaceIds).toHaveLength(2);
    await expect.poll(async () => {
      const state = await getDesktopState(window);
      return workspaceIds.map((workspaceId) => state.runtimeByWorkspace[workspaceId]?.models
        .filter((model) => model.providerId === "custom-lab-llama-cpp")
        .map((model) => model.modelId));
    }).toEqual([[secondaryModelId], [secondaryModelId]]);

    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await openNewThread(window);
    const workspaceSelect = window.locator(".new-thread__workspace");
    const modelBadge = window.locator(".new-thread__hint .model-selector__badge").first();
    for (const workspaceId of workspaceIds) {
      await workspaceSelect.selectOption(workspaceId);
      await modelBadge.click();
      const dropdown = window.locator(".new-thread__hint .model-selector__dropdown").first();
      await expect(dropdown).toContainText(secondaryModelId);
      await expect(dropdown).not.toContainText(modelId);
      await window.keyboard.press("Escape");
    }
  } finally {
    await harness.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("settings shows environment-configured providers as managed externally", async () => {
  test.setTimeout(60_000);
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-env-key";

  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("provider-settings-env-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["openai/gpt-5"],
  });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Providers", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Providers");

    const connectedProviders = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: /^Connected$/ }),
    });
    const openAiRow = connectedProviders.locator(".settings-row", {
      has: window.locator(".settings-row__title", { hasText: /^OpenAI$/ }),
    });
    await expect(openAiRow).toContainText("Environment variable");
    await openAiRow.getByRole("button", { name: "Configure" }).click();
    await expect(window.getByText("External Configuration — OpenAI", { exact: true })).toBeVisible();
    await window.getByRole("button", { name: "Close", exact: true }).click();
  } finally {
    await harness.close();
    if (previousOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  }
});

test("settings keeps models.json provider overrides in the external-config state", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("provider-settings-models-json-workspace");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["openai/gpt-5"],
  });
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          openai: {
            apiKey: "test-openai-models-json-key",
            baseUrl: "https://api.openai.com/v1",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "Providers", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Providers");

    const connectedProviders = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: /^Connected$/ }),
    });
    const openAiRow = connectedProviders.locator(".settings-row", {
      has: window.locator(".settings-row__title", { hasText: /^OpenAI$/ }),
    });
    await expect(openAiRow).toContainText("Configured externally");
    await openAiRow.getByRole("button", { name: "Configure" }).click();
    await expect(window.getByText("External Configuration — OpenAI", { exact: true })).toBeVisible();
    await window.getByRole("button", { name: "Close", exact: true }).click();
  } finally {
    await harness.close();
  }
});

test("opening the first workspace from the empty state hydrates provider and model settings without refresh", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("provider-settings-first-workspace");
  await seedAgentDir(agentDir, {
    enabledModels: ["openai/gpt-5", "openai/gpt-4o"],
  });

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const emptyState = window.getByTestId("empty-state");
    await expect(emptyState).toBeVisible();

    await stubNextOpenDialog(harness, [workspacePath]);
    await emptyState.getByRole("button", { name: "Open first folder" }).click();

    await expect(emptyState).toHaveCount(0);
    await expect(window.getByTestId("workspace-list")).toContainText("provider-settings-first-workspace");
    await expect(window.getByTestId("new-thread-composer")).toBeVisible();

    await window.keyboard.press(desktopShortcut(","));
    const settingsSurface = window.getByTestId("settings-surface");
    await expect(settingsSurface).toBeVisible();
    await expect(settingsSurface.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);

    await window.getByRole("button", { name: "Providers", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Providers");

    const connectedProviders = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: /^Connected$/ }),
    });
    await expect(connectedProviders).toContainText("OpenAI");
    await expect(connectedProviders).toContainText("API key");

    await window.getByRole("button", { name: "Models", exact: true }).click();
    await expect(window.locator(".view-header__title")).toHaveText("Models");

    const enabledModels = window.locator(".settings-section", {
      has: window.locator(".settings-section__title", { hasText: "Enabled models" }),
    });
    await expect(enabledModels).toContainText("openai/gpt-5");
    await expect(enabledModels).toContainText("openai/gpt-4o");
  } finally {
    await harness.close();
  }
});
