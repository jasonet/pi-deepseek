import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { BUNDLED_EXTENSIONS, seedBundledExtensionsFromPath } from "../../electron/seed-extensions-core";

test.describe("System Permissions & Computer Use Extension", () => {
  test("registers pi-computer-use in BUNDLED_EXTENSIONS", () => {
    expect(BUNDLED_EXTENSIONS).toContain("pi-computer-use");
  });

  test("seeds pi-computer-use atomically from bundled tgz", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-cu-test-"));
    const bundledRoot = path.join(root, "bundled");
    const payloadRoot = path.join(root, "payload");
    const targetRoot = path.join(root, "target");

    await mkdir(path.join(payloadRoot, "pi-computer-use"), { recursive: true });
    await mkdir(bundledRoot, { recursive: true });
    await writeFile(
      path.join(payloadRoot, "pi-computer-use", "package.json"),
      JSON.stringify({ name: "pi-computer-use", version: "0.5.1" }),
    );
    await writeFile(path.join(payloadRoot, "pi-computer-use", "indicator.txt"), "ready");

    const archive = spawnSync("tar", ["-czf", path.join(bundledRoot, "pi-computer-use.tgz"), "-C", payloadRoot, "pi-computer-use"]);
    expect(archive.status).toBe(0);

    seedBundledExtensionsFromPath(bundledRoot, targetRoot);

    const installedPkg = JSON.parse(
      await readFile(path.join(targetRoot, "pi-computer-use", "package.json"), "utf8"),
    );
    expect(installedPkg.version).toBe("0.5.1");
    expect(await readFile(path.join(targetRoot, "pi-computer-use", "indicator.txt"), "utf8")).toBe("ready");
  });

  test("runs native permission helper --check and returns structured JSON on macOS", () => {
    if (process.platform !== "darwin") {
      test.skip();
      return;
    }

    const helperPath = path.resolve(__dirname, "../../build/native/pi-deepseek-permission-helper");
    if (!existsSync(helperPath)) {
      test.skip();
      return;
    }

    const output = execFileSync(helperPath, ["--check"], { encoding: "utf8" });
    const parsed = JSON.parse(output.trim());
    expect(parsed).toHaveProperty("accessibility");
    expect(parsed).toHaveProperty("screenRecording");
    expect(["granted", "denied", "unknown"]).toContain(parsed.accessibility);
    expect(["granted", "denied", "unknown"]).toContain(parsed.screenRecording);
  });
});
