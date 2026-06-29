import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";

const packageExtensionSource = String.raw`
export default function packagesUiExtension(pi) {
  pi.registerCommand("packages-ui-command", {
    description: "Command from a package-backed extension",
    handler: async (_args, ctx) => {
      ctx.ui.notify("packages-ui extension", "info");
    },
  });
}
`;

async function writePackageBackedExtension(packagePath: string) {
  const extensionDir = join(packagePath, "extension");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(
    join(packagePath, "package.json"),
    `${JSON.stringify(
      { name: "packages-ui-extension", type: "module", pi: { extensions: ["./extension/index.ts"] } },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(extensionDir, "index.ts"), `${packageExtensionSource}\n`);
}

async function configurePackage(agentDir: string, packagePath: string) {
  await writePackageBackedExtension(packagePath);
  const settingsPath = join(agentDir, "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
  settings.packages = [packagePath];
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

test("packages section lists configured packages and removes them", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("packages-ui-workspace");
  const packagePath = await makeWorkspace("packages-ui-local-package");

  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  await configurePackage(agentDir, packagePath);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await expect(window.getByTestId("extensions-surface")).toBeVisible();

    // Packages section renders.
    const packagesSection = window.locator(".packages-section");
    await expect(packagesSection).toBeVisible();
    await expect(packagesSection.getByRole("heading", { name: "Packages" })).toBeVisible();

    // The configured local package appears in the list.
    const row = packagesSection.locator(".packages-row", { hasText: packagePath });
    await expect(row).toBeVisible();

    // Check-for-updates is operable and does not crash the surface.
    await packagesSection.getByRole("button", { name: "Check for updates" }).click();
    await expect(packagesSection).toBeVisible();

    // Remove the package; the row disappears.
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(packagesSection.locator(".packages-row", { hasText: packagePath })).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
