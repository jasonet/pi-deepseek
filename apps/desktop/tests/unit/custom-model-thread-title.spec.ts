import { expect, test } from "@playwright/test";
import { generateThreadTitle } from "../../../../packages/pi-sdk-driver/src/thread-title-generator";

test("custom models keep the instant local title without a second inference", async () => {
  const unusedDependencies = new Proxy({}, {
    get() {
      throw new Error("Custom title generation should not access runtime dependencies.");
    },
  });

  const title = await generateThreadTitle({
    workspaceId: "/tmp/custom-title-workspace",
    path: "/tmp/custom-title-workspace",
  }, {
    prompt: "Investigate the local model",
    model: { provider: "custom-local", modelId: "gemma-local.gguf" },
  }, unusedDependencies as never);

  expect(title).toBeNull();
});
