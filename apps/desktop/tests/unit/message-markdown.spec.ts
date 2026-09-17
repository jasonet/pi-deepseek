import { expect, test } from "@playwright/test";
import { isCommandLanguage } from "../../src/markdown-code-block";
import { extractNumbersFromText, isPreviewableFileLink, NUMBER_REGEX } from "../../src/message-markdown";
import { extensionToLanguage, resolveHighlightLanguage } from "../../src/syntax-highlight";

test.describe("Markdown formatting utilities", () => {
  test.describe("isCommandLanguage", () => {
    test("identifies shell/command languages for green command badge styling", () => {
      expect(isCommandLanguage("bash")).toBe(true);
      expect(isCommandLanguage("sh")).toBe(true);
      expect(isCommandLanguage("zsh")).toBe(true);
      expect(isCommandLanguage("shell")).toBe(true);
      expect(isCommandLanguage("powershell")).toBe(true);
      expect(isCommandLanguage("cmd")).toBe(true);
      expect(isCommandLanguage("ps1")).toBe(true);
      expect(isCommandLanguage(" BASH ")).toBe(true);
    });

    test("returns false for non-command code languages", () => {
      expect(isCommandLanguage("typescript")).toBe(false);
      expect(isCommandLanguage("javascript")).toBe(false);
      expect(isCommandLanguage("python")).toBe(false);
      expect(isCommandLanguage("json")).toBe(false);
      expect(isCommandLanguage("css")).toBe(false);
      expect(isCommandLanguage(undefined)).toBe(false);
    });
  });

  test.describe("resolveHighlightLanguage", () => {
    test("maps extensions and fence aliases to highlight.js registered languages", () => {
      expect(resolveHighlightLanguage("ts")).toBe("typescript");
      expect(resolveHighlightLanguage("tsx")).toBe("typescript");
      expect(resolveHighlightLanguage("typescript")).toBe("typescript");
      expect(resolveHighlightLanguage("js")).toBe("javascript");
      expect(resolveHighlightLanguage("jsx")).toBe("javascript");
      expect(resolveHighlightLanguage("py")).toBe("python");
      expect(resolveHighlightLanguage("python")).toBe("python");
      expect(resolveHighlightLanguage("sh")).toBe("bash");
      expect(resolveHighlightLanguage("bash")).toBe("bash");
      expect(resolveHighlightLanguage("zsh")).toBe("bash");
      expect(resolveHighlightLanguage("json")).toBe("json");
    });

    test("returns undefined for unknown or undefined languages", () => {
      expect(resolveHighlightLanguage(undefined)).toBeUndefined();
      expect(resolveHighlightLanguage("unknown-lang")).toBeUndefined();
    });

    test("shares one alias table with extensionToLanguage", () => {
      expect(extensionToLanguage("src/app.tsx")).toBe("typescript");
      expect(extensionToLanguage("run.sh")).toBe("bash");
      expect(extensionToLanguage("Makefile")).toBeUndefined();
    });
  });

  test.describe("extractNumbersFromText & NUMBER_REGEX", () => {
    test("extracts standalone integers and formatted numbers for bold styling", () => {
      const text = "Found 42 items across 3 folders, taking 1,250 ms with 100% accuracy and 3.14 ratio.";
      const numbers = extractNumbersFromText(text);
      expect(numbers).toEqual(["42", "3", "1,250", "100%", "3.14"]);
    });

    test("does not match numbers inside code identifiers or units", () => {
      const text = "Variable var123 and property item_4 with width 12px should not match inside words.";
      const numbers = extractNumbersFromText(text);
      expect(numbers).toEqual([]);
    });

    test("matches numbers enclosed in parentheses or punctuation", () => {
      const text = "Scores: (98.5), [100%], -5, and +10.";
      const numbers = extractNumbersFromText(text);
      expect(numbers).toEqual(["98.5", "100%", "5", "10"]);
    });

    test("matches numbers at the start and end of string", () => {
      const text = "2026 is the year, ending with 99";
      const numbers = extractNumbersFromText(text);
      expect(numbers).toEqual(["2026", "99"]);
    });
  });

  test.describe("isPreviewableFileLink", () => {
    test("distinguishes external web links from previewable local file paths", () => {
      expect(isPreviewableFileLink("https://claude.ai")).toBe(false);
      expect(isPreviewableFileLink("http://localhost:3000")).toBe(false);
      expect(isPreviewableFileLink("mailto:test@example.com")).toBe(false);
      expect(isPreviewableFileLink("#section")).toBe(false);

      expect(isPreviewableFileLink("src/app.tsx")).toBe(true);
      expect(isPreviewableFileLink("package.json")).toBe(true);
      expect(isPreviewableFileLink("/Users/user/code/file.ts")).toBe(true);
    });
  });
});
