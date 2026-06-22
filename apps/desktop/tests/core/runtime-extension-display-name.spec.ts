import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { RuntimeSupervisor } from "../../../../packages/pi-sdk-driver/src/index";

const extensionSource = String.raw`
export default function packageNamedExtension(pi) {
  pi.registerCommand("package-named-command", {
    description: "Command from a package-backed extension",
    handler: async (_args, ctx) => {
      ctx.ui.notify("package-backed extension", "info");
    },
  });
}
`;

async function seedAgentSettings(agentDir: string, settings: Record<string, unknown>) {
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "auth.json"), "{}\n", "utf8");
  await writeFile(join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function writePackageExtension(packagePath: string, displayName: string, nested: boolean) {
  const extensionDir = nested ? join(packagePath, "extension") : packagePath;
  await mkdir(extensionDir, { recursive: true });
  await writeFile(
    join(packagePath, "package.json"),
    `${JSON.stringify(
      {
        name: displayName.toLowerCase().replaceAll(" ", "-"),
        displayName,
        type: "module",
        ...(nested
          ? {
              pi: {
                extensions: ["./extension/index.ts"],
              },
            }
          : {}),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(join(extensionDir, "index.ts"), `${extensionSource}\n`, "utf8");
  return join(extensionDir, "index.ts");
}

test("labels direct index extension entrypoints from package display names", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-runtime-display-name-"));
  const workspacePath = join(root, "workspace");
  const packagePath = join(root, "package-extension");
  const directPath = join(root, "direct-extension");
  const packageAgentDir = join(root, "package-agent");
  const directAgentDir = join(root, "direct-agent");

  await mkdir(workspacePath, { recursive: true });
  await writePackageExtension(packagePath, "Package Bridge", true);
  const directEntry = await writePackageExtension(directPath, "MCP Collection Bridge", false);
  await seedAgentSettings(packageAgentDir, { packages: [packagePath] });
  await seedAgentSettings(directAgentDir, { extensions: [directEntry] });

  const packageSnapshot = await new RuntimeSupervisor({ agentDir: packageAgentDir }).getRuntimeSnapshot({
    workspaceId: "package",
    path: workspacePath,
    displayName: "package",
  });
  const directSnapshot = await new RuntimeSupervisor({ agentDir: directAgentDir }).getRuntimeSnapshot({
    workspaceId: "direct",
    path: workspacePath,
    displayName: "direct",
  });

  expect(packageSnapshot.extensions.map((entry) => entry.displayName)).toContain("Package Bridge");
  expect(directSnapshot.extensions.map((entry) => entry.displayName)).toContain("MCP Collection Bridge");
  expect(directSnapshot.extensions.map((entry) => entry.displayName)).not.toContain("index");
});
