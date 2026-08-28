import { expect, test } from "@playwright/test";
import { isUpdateVersionNewer } from "../../electron/update-version";

test("does not offer an older release as an update", () => {
  expect(isUpdateVersionNewer("2.7.1", "2.8.0")).toBe(false);
});

test("offers only a strictly newer release", () => {
  expect(isUpdateVersionNewer("2.8.1", "2.8.0")).toBe(true);
  expect(isUpdateVersionNewer("2.8.0", "2.8.0")).toBe(false);
});

test("offers 2.9.2 to every valid lower stable version", () => {
  for (const current of ["2.9.1", "2.9.0", "2.8.9", "2.0.0", "0.1.0"]) {
    expect(isUpdateVersionNewer("2.9.2", current)).toBe(true);
  }
});

test("normalizes release tags and follows prerelease ordering", () => {
  expect(isUpdateVersionNewer("v2.9.0", "2.8.0")).toBe(true);
  expect(isUpdateVersionNewer("2.8.0-beta.2", "2.8.0-beta.1")).toBe(true);
  expect(isUpdateVersionNewer("2.8.0-beta.1", "2.8.0")).toBe(false);
});

test("rejects malformed versions instead of prompting", () => {
  expect(isUpdateVersionNewer("latest", "2.8.0")).toBe(false);
  expect(isUpdateVersionNewer("2.8.1", "unknown")).toBe(false);
});
