import type { ReactNode } from "react";
import { LRUCache } from "lru-cache";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);
hljs.registerLanguage("bash", bash);

export const MAX_HIGHLIGHTED_LINES = 500;

interface HighlightToken {
  readonly className?: string;
  readonly children: HighlightLine;
}

export type HighlightTokenChild = string | HighlightToken;

export type HighlightLine = readonly HighlightTokenChild[];

// Keys are both file extensions and markdown fence language names; shell dialects
// collapse onto the "bash" grammar, the only shell grammar registered below.
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  typescript: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  json: "json",
  py: "python",
  python: "python",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  shell: "bash",
};

export function extensionToLanguage(filePath: string): string | undefined {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex < 0) return undefined;
  return LANGUAGE_ALIASES[filePath.slice(dotIndex + 1).toLowerCase()];
}

/** Maps a markdown fence language (or alias) to a registered highlight.js grammar. */
export function resolveHighlightLanguage(language: string | undefined): string | undefined {
  if (!language) return undefined;
  return LANGUAGE_ALIASES[language.toLowerCase().trim()];
}

export function renderHighlightTokens(tokens: HighlightLine): ReactNode {
  return tokens.map((token, index) =>
    typeof token === "string" ? (
      token
    ) : (
      <span className={token.className} key={index}>
        {renderHighlightTokens(token.children)}
      </span>
    ),
  );
}

const lineCache = new LRUCache<string, HighlightLine>({ max: 5000 });

export function highlightLine(line: string, language: string): HighlightLine {
  const cacheKey = `${language}\0${line}`;
  const cached = lineCache.get(cacheKey);
  if (cached) return cached;
  const html = hljs.highlight(line, { language, ignoreIllegals: true }).value;
  const tokens = parseHljsHtml(html);
  lineCache.set(cacheKey, tokens);
  return tokens;
}

function parseHljsHtml(html: string): HighlightLine {
  const parser = new HljsHtmlParser(html);
  return parser.parseChildren(null);
}

class HljsHtmlParser {
  private pos = 0;
  constructor(private readonly source: string) {}

  parseChildren(closingTag: string | null): readonly HighlightTokenChild[] {
    const out: HighlightTokenChild[] = [];
    let textStart = this.pos;

    const flushText = (end: number): void => {
      if (end > textStart) {
        out.push(decodeEntities(this.source.slice(textStart, end)));
      }
    };

    while (this.pos < this.source.length) {
      const ch = this.source.charCodeAt(this.pos);
      if (ch !== 0x3c) {
        this.pos += 1;
        continue;
      }
      if (closingTag !== null && this.matchClosingTag(closingTag)) {
        flushText(this.pos);
        this.pos += closingTag.length + 3;
        return out;
      }
      const open = this.tryConsumeOpenSpan();
      if (open !== null) {
        flushText(open.tagStart);
        const children = this.parseChildren("span");
        out.push({ className: open.className, children });
        textStart = this.pos;
        continue;
      }
      this.pos += 1;
    }
    flushText(this.pos);
    return out;
  }

  private matchClosingTag(tag: string): boolean {
    const expected = `</${tag}>`;
    return this.source.startsWith(expected, this.pos);
  }

  private tryConsumeOpenSpan(): { className?: string; tagStart: number } | null {
    const tagStart = this.pos;
    if (!this.source.startsWith("<span", this.pos)) return null;
    const closeIdx = this.source.indexOf(">", this.pos);
    if (closeIdx < 0) return null;
    const inner = this.source.slice(this.pos + 5, closeIdx);
    const classMatch = /\sclass="([^"]*)"/.exec(inner);
    this.pos = closeIdx + 1;
    return { className: classMatch?.[1], tagStart };
  }
}

function decodeEntities(s: string): string {
  if (s.indexOf("&") < 0) return s;
  // &amp; must be replaced last so &amp;lt; etc. survive intact.
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
