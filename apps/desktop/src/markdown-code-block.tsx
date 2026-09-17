import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { CheckSmallIcon, ChevronRightIcon, CopyIcon, TerminalIcon } from "./icons";
import { useT } from "./i18n";
import {
  MAX_HIGHLIGHTED_LINES,
  highlightLine,
  renderHighlightTokens,
  resolveHighlightLanguage,
} from "./syntax-highlight";

export const COMMAND_LANGUAGES = new Set([
  "bash",
  "sh",
  "zsh",
  "shell",
  "console",
  "terminal",
  "cmd",
  "powershell",
  "ps1",
]);

export function isCommandLanguage(language?: string): boolean {
  return Boolean(language && COMMAND_LANGUAGES.has(language.toLowerCase().trim()));
}

/** Maps a markdown fence language (or alias) to a registered highlight.js grammar. */
export const resolveLanguage = resolveHighlightLanguage;

const PREVIEW_MAX_LENGTH = 42;

/** `undefined` when the block is too large to highlight without blocking the UI thread. */
function useHighlightLanguage(language: string | undefined, lineCount: number, isExpanded: boolean) {
  return useMemo(() => {
    if (!isExpanded || lineCount > MAX_HIGHLIGHTED_LINES) return undefined;
    return resolveHighlightLanguage(language);
  }, [language, lineCount, isExpanded]);
}

function MarkdownCodeBlockImpl({
  language,
  code,
}: {
  readonly language?: string;
  readonly code: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = useT();

  const isCommand = isCommandLanguage(language);

  // Line count and preview are derivable from `code` alone, so keep them off the
  // `split("\n")` path — a collapsed 10k-line block should not allocate 10k strings.
  const lineCount = useMemo(() => (code.match(/\n/g)?.length ?? 0) + 1, [code]);
  const previewSnippet = useMemo(() => {
    const firstNonEmpty = code.match(/^[ \t]*(\S[^\r\n]*)/m)?.[1] ?? "";
    return firstNonEmpty.length > PREVIEW_MAX_LENGTH
      ? `${firstNonEmpty.slice(0, PREVIEW_MAX_LENGTH)}…`
      : firstNonEmpty;
  }, [code]);

  const highlightLanguage = useHighlightLanguage(language, lineCount, isExpanded);
  const renderedLines = useMemo(() => {
    if (!isExpanded) return [];
    return code.split("\n").map((line) => ({
      text: line,
      tokens: highlightLanguage ? highlightLine(line, highlightLanguage) : undefined,
    }));
  }, [isExpanded, code, highlightLanguage]);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return;
    }
    setCopied(true);
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
  };

  const toggle = () => setIsExpanded((prev) => !prev);

  return (
    <div
      className={`markdown-code-block ${
        isExpanded ? "markdown-code-block--expanded" : "markdown-code-block--collapsed"
      } ${isCommand ? "markdown-code-block--command" : ""}`}
    >
      <div
        className="markdown-code-block__header"
        onClick={toggle}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <div className="markdown-code-block__header-left">
          <span
            className={`markdown-code-block__chevron ${
              isExpanded ? "markdown-code-block__chevron--expanded" : ""
            }`}
          >
            <ChevronRightIcon />
          </span>
          <span
            className={`markdown-code-block__badge ${
              isCommand ? "markdown-code-block__badge--command" : ""
            }`}
          >
            {isCommand && (
              <span className="markdown-code-block__badge-icon">
                <TerminalIcon />
              </span>
            )}
            <span>{language || (isCommand ? "bash" : "code")}</span>
          </span>
          <span className="markdown-code-block__lines">
            {t("markdown.lines", { count: String(lineCount) })}
          </span>
          {!isExpanded && previewSnippet && (
            <span className="markdown-code-block__preview" title={previewSnippet}>
              {previewSnippet}
            </span>
          )}
        </div>
        <div className="markdown-code-block__header-right">
          <button
            type="button"
            className={`markdown-code-block__copy ${
              copied ? "markdown-code-block__copy--copied" : ""
            }`}
            onClick={handleCopy}
            title={copied ? t("markdown.copied") : t("markdown.copy")}
            aria-label={copied ? t("markdown.copied") : t("markdown.copy")}
          >
            {copied ? <CheckSmallIcon /> : <CopyIcon />}
            <span>{copied ? t("markdown.copied") : t("markdown.copy")}</span>
          </button>
          <span className="markdown-code-block__toggle-text">
            {isExpanded ? t("markdown.collapseCode") : t("markdown.expandCode")}
          </span>
        </div>
      </div>
      {isExpanded && (
        <div className="markdown-code-block__body">
          <pre className="markdown-code-block__pre" data-language={language}>
            <code className={language ? `language-${language}` : undefined}>
              {renderedLines.map((line, index) => (
                <div className="markdown-code-block__line" key={index}>
                  <span className="markdown-code-block__line-num">{index + 1}</span>
                  <span className="markdown-code-block__line-content">
                    {line.tokens ? renderHighlightTokens(line.tokens) : line.text}
                  </span>
                </div>
              ))}
            </code>
          </pre>
        </div>
      )}
    </div>
  );
}

export const MarkdownCodeBlock = memo(MarkdownCodeBlockImpl);
