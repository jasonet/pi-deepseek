import { expect, test } from "@playwright/test";
import { stripWindowsExtendedPathPrefix } from "../../electron/worktree-manager";

test("stripWindowsExtendedPathPrefix removes \\\\?\\ drive-letter prefix", () => {
  expect(stripWindowsExtendedPathPrefix("\\\\?\\C:\\Users\\alice\\project")).toBe("C:\\Users\\alice\\project");
  expect(stripWindowsExtendedPathPrefix("\\\\?\\D:\\workspace\\code")).toBe("D:\\workspace\\code");
});

test("stripWindowsExtendedPathPrefix transforms \\\\?\\UNC\\ paths to standard UNC", () => {
  expect(stripWindowsExtendedPathPrefix("\\\\?\\UNC\\server\\share\\repo")).toBe("\\\\server\\share\\repo");
  expect(stripWindowsExtendedPathPrefix("\\\\?\\unc\\myserver\\myshare\\path")).toBe("\\\\myserver\\myshare\\path");
});

test("stripWindowsExtendedPathPrefix preserves standard POSIX and Windows paths", () => {
  expect(stripWindowsExtendedPathPrefix("/Users/alice/project")).toBe("/Users/alice/project");
  expect(stripWindowsExtendedPathPrefix("C:\\Users\\alice\\project")).toBe("C:\\Users\\alice\\project");
});
