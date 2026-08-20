import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { seedBundledExtensionsFromPath } from "../../electron/seed-extensions-core";

test("atomically upgrades the app-managed Treg extension by package version", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-treg-upgrade-"));
  const bundledRoot = path.join(root, "bundled");
  const payloadRoot = path.join(root, "payload");
  const targetRoot = path.join(root, "target");
  await mkdir(path.join(payloadRoot, "pi-treg"), { recursive: true });
  await mkdir(path.join(targetRoot, "pi-treg"), { recursive: true });
  await mkdir(bundledRoot, { recursive: true });
  await writeFile(path.join(payloadRoot, "pi-treg", "package.json"), JSON.stringify({ name: "pi-treg", version: "0.1.1" }));
  await writeFile(path.join(payloadRoot, "pi-treg", "current.txt"), "current");
  await writeFile(path.join(targetRoot, "pi-treg", "package.json"), JSON.stringify({ name: "pi-treg", version: "0.1.0" }));
  await writeFile(path.join(targetRoot, "pi-treg", "stale.txt"), "stale");
  const archive = spawnSync("tar", ["-czf", path.join(bundledRoot, "pi-treg.tgz"), "-C", payloadRoot, "pi-treg"]);
  expect(archive.status).toBe(0);

  seedBundledExtensionsFromPath(bundledRoot, targetRoot);

  expect(JSON.parse(await readFile(path.join(targetRoot, "pi-treg", "package.json"), "utf8")).version).toBe("0.1.1");
  expect(await readFile(path.join(targetRoot, "pi-treg", "current.txt"), "utf8")).toBe("current");
  await expect(readFile(path.join(targetRoot, "pi-treg", "stale.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});
