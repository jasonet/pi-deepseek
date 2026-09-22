import { expect, test } from "@playwright/test";
import { isCommandLanguage } from "../../src/markdown-code-block";
import {
  extractNumbersFromText,
  FILE_PATH_PROSE_REGEX,
  isFilePathString,
  isPreviewableFileLink,
  normalizeMarkdownText,
  NUMBER_REGEX,
} from "../../src/message-markdown";
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

  test.describe("normalizeMarkdownText", () => {
    test("normalizes plain text without alteration", () => {
      expect(normalizeMarkdownText("Hello world")).toBe("Hello world");
    });

    test("filters out literal [object Object] strings", () => {
      expect(normalizeMarkdownText("[object Object]")).toBe("");
      expect(normalizeMarkdownText("  [object Object]  ")).toBe("");
    });

    test("converts image object payloads into renderable markdown images", () => {
      const imagePayload = {
        type: "image",
        mimeType: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUg==",
        name: "diagram.png",
      };
      const result = normalizeMarkdownText(imagePayload);
      expect(result).toBe("![diagram.png](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==)");
    });

    test("extracts text and images from multipart content arrays", () => {
      const multiPart = {
        content: [
          { type: "text", text: "Here is the flowchart:" },
          { type: "image", mimeType: "image/jpeg", data: "/9j/4AAQSkZJRg==" },
        ],
      };
      const result = normalizeMarkdownText(multiPart);
      expect(result).toContain("Here is the flowchart:");
      expect(result).toContain("![image](data:image/jpeg;base64,/9j/4AAQSkZJRg==)");
    });

    test("parses JSON-stringified objects with image payloads", () => {
      const jsonStr = JSON.stringify({
        type: "image",
        mimeType: "image/png",
        data: "abc123==",
      });
      const result = normalizeMarkdownText(jsonStr);
      expect(result).toBe("![image](data:image/png;base64,abc123==)");
    });
  });

  test.describe("isFilePathString", () => {
    test("identifies project relative file paths accurately", () => {
      expect(isFilePathString("docs/site-hkez-to-qdaa-migration-plan.md")).toBe(true);
      expect(isFilePathString("docs/site-hkez-to-qdaa-migration-plan.md:42")).toBe(true);
      expect(isFilePathString("apps/desktop/src/App.tsx")).toBe(true);
      expect(isFilePathString("packages/pi-sdk-driver/src/session-supervisor.ts")).toBe(true);
      expect(isFilePathString("package.json")).toBe(true);
      expect(isFilePathString("README.md")).toBe(true);
      expect(isFilePathString("tsconfig.json")).toBe(true);
    });

    test("returns false for non-file commands, numbers and URLs", () => {
      expect(isFilePathString("npm install")).toBe(false);
      expect(isFilePathString("git status")).toBe(false);
      expect(isFilePathString("v3.0.5")).toBe(false);
      expect(isFilePathString("123.456")).toBe(false);
      expect(isFilePathString("https://example.com/docs/file.md")).toBe(false);
      expect(isFilePathString("")).toBe(false);
    });
  });

  test.describe("FILE_PATH_PROSE_REGEX", () => {
    test("extracts file paths from prose text including Chinese prefixes", () => {
      const text = "已沉淀至 docs/site-hkez-to-qdaa-migration-plan.md，共更新 3 个文件。";
      FILE_PATH_PROSE_REGEX.lastIndex = 0;
      const matches: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = FILE_PATH_PROSE_REGEX.exec(text)) !== null) {
        matches.push(m[1]!);
      }
      expect(matches).toEqual(["docs/site-hkez-to-qdaa-migration-plan.md"]);
    });

    test("extracts file paths with line number anchors", () => {
      const text = "详见 apps/desktop/src/App.tsx:1059 行代码说明。";
      FILE_PATH_PROSE_REGEX.lastIndex = 0;
      const m = FILE_PATH_PROSE_REGEX.exec(text);
      expect(m).not.toBeNull();
      expect(m?.[1]).toBe("apps/desktop/src/App.tsx");
      expect(m?.[2]).toBe("1059");
    });

    test("extracts multiple files from a single sentence", () => {
      const text = "修改了 package.json 和 README.md 文件配置。";
      FILE_PATH_PROSE_REGEX.lastIndex = 0;
      const matches: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = FILE_PATH_PROSE_REGEX.exec(text)) !== null) {
        matches.push(m[1]!);
      }
      expect(matches).toEqual(["package.json", "README.md"]);
    });
  });
});
