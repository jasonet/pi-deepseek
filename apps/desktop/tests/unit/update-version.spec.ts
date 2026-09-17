import { expect, test } from "@playwright/test";
import { humanizeUpdateError, isUpdateVersionNewer } from "../../electron/update-version";

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

test.describe("humanizeUpdateError", () => {
  test("humanizes missing macOS update feed errors clearly", () => {
    const error = "Cannot find latest-mac.yml in the latest release artifacts (https://github.com/jasonet/pi-deepseek/releases/download/v3.0.5/latest-mac.yml): 404";
    expect(humanizeUpdateError(error)).toBe("macOS update feed is temporarily unavailable on the release server. Please try again later.");
  });

  test("humanizes missing Windows update feed errors clearly", () => {
    const error = "Cannot find latest.yml in the latest release artifacts: 404";
    expect(humanizeUpdateError(error)).toBe("Windows update feed is temporarily unavailable on the release server. Please try again later.");
  });

  test("humanizes network and socket timeout errors", () => {
    expect(humanizeUpdateError("getaddrinfo ENOTFOUND github.com")).toBe("Network error. Check your connection and try again.");
    expect(humanizeUpdateError("net::ERR_CONNECTION_RESET")).toBe("Download failed due to a network issue. Check your connection and try again.");
  });

  test("returns original error when no pattern matches", () => {
    expect(humanizeUpdateError("Unknown error occurred")).toBe("Unknown error occurred");
  });
});

