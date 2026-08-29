import { expect, test } from "@playwright/test";
import {
  buildFxBinaryCandidatePaths,
  isFxHelpOutputCompatible,
} from "../../electron/fx-binary-resolution";

test("discovers a user-installed fx.exe on Windows before the bundled fallback", () => {
  expect(
    buildFxBinaryCandidatePaths({
      platform: "win32",
      arch: "x64",
      pathValue: "C:\\Tools\\bin;D:\\Apps\\bin",
      homeDirectory: "C:\\Users\\developer",
      bundledRoot: "C:\\Program Files\\Pi-Deepseek\\resources\\fx",
      binaryPath: "",
    }),
  ).toEqual([
    "C:\\Tools\\bin\\fx.exe",
    "D:\\Apps\\bin\\fx.exe",
    "C:\\Users\\developer\\.fx\\bin\\fx.exe",
    "C:\\Users\\developer\\.local\\bin\\fx.exe",
    "C:\\Program Files\\Pi-Deepseek\\resources\\fx\\win32-x64\\fx.exe",
  ]);
});

test("does not mistake an unrelated fx executable for the ACP runtime", () => {
  expect(isFxHelpOutputCompatible("fx 1.0 - file effects utility")).toBe(false);
  expect(isFxHelpOutputCompatible(`fx
  acp  Start an ACP server over stdio
Docs: https://fx.sh/docs`)).toBe(true);
});
