import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { CheckSmallIcon, ChevronRightIcon, CopyIcon, TerminalIcon } from "./icons";
import { useT } from "./i18n";
import {
  MAX_HIGHLIGHTED_LINES,
  highlightLine,
  renderHighlightTokens,
  resolveHighlightLanguage,
} from "./syntax-highlight";
import type { CodeRunContext } from "./message-markdown";

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

/** Languages that can be executed inline (run button shown) */
const RUNNABLE_LANGUAGES = new Set([
  "bash", "sh", "zsh", "shell", "console", "terminal",
  "python", "python3", "py",
  "node", "nodejs", "javascript", "js",
  "typescript", "ts",
  "ruby", "rb",
  "perl",
  "php",
]);

const LANG_RUNNER: Record<string, string[]> = {
  python: ["python3"],
  python3: ["python3"],
  py: ["python3"],
  node: ["node"],
  nodejs: ["node"],
  javascript: ["node"],
  js: ["node"],
  typescript: ["npx", "ts-node", "--esm"],
  ts: ["npx", "ts-node", "--esm"],
  ruby: ["ruby"],
  rb: ["ruby"],
  perl: ["perl"],
  php: ["php"],
};

function isRunnableLanguage(language?: string): boolean {
  return Boolean(language && RUNNABLE_LANGUAGES.has(language.toLowerCase().trim()));
}

export function isCommandLanguage(language?: string): boolean {
  return Boolean(language && COMMAND_LANGUAGES.has(language.toLowerCase().trim()));
}

const PREVIEW_MAX_LENGTH = 42;

/** `undefined` when the block is too large to highlight without blocking the UI thread. */
function useHighlightLanguage(language: string | undefined, lineCount: number, isExpanded: boolean) {
  return useMemo(() => {
    if (!isExpanded || lineCount > MAX_HIGHLIGHTED_LINES) return undefined;
    return resolveHighlightLanguage(language);
  }, [language, lineCount, isExpanded]);
}

function buildRunScript(language: string, code: string): { cmd: string; args: string[] } | null {
  const lang = language.toLowerCase().trim();
  const isShell = COMMAND_LANGUAGES.has(lang);
  if (isShell) return { cmd: "bash", args: ["-c", code] };
  const runner = LANG_RUNNER[lang];
  if (!runner) return null;
  // For interpreted languages, write code to a temp file via bash -c
  // Use a heredoc approach to avoid escaping issues
  const escaped = code.replace(/'/g, `'\\''`);
  const ext = lang === "python" || lang === "python3" || lang === "py" ? "py"
    : lang === "ruby" || lang === "rb" ? "rb"
    : lang === "perl" ? "pl"
    : lang === "php" ? "php"
    : "js";
  const runnerCmd = runner.join(" ");
  return {
    cmd: "bash",
    args: ["-c", `f=$(mktemp /tmp/run_XXXXXX.${ext}); printf '%s' '${escaped}' > "$f"; ${runnerCmd} "$f"; r=$?; rm -f "$f"; exit $r`],
  };
}

interface RunState {
  readonly status: "idle" | "running" | "done" | "error";
  readonly output: string;
  readonly exitCode?: number;
  readonly runId?: string;
  readonly errorMessage?: string;
}

function MarkdownCodeBlockImpl({
  language,
  code,
  codeRunContext,
}: {
  readonly language?: string;
  readonly code: string;
  readonly codeRunContext?: CodeRunContext;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [runState, setRunState] = useState<RunState>({ status: "idle", output: "" });
  const outputRef = useRef<HTMLPreElement | null>(null);
  const t = useT();

  const isCommand = isCommandLanguage(language);
  const canRun = isRunnableLanguage(language) && Boolean(codeRunContext);

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

  // Subscribe to code block output events once on mount
  useEffect(() => {
    if (!codeRunContext) return undefined;
    return codeRunContext.api.onCodeBlockOutput((event) => {
      setRunState((prev) => {
        if (prev.runId !== event.runId) return prev;
        if (event.error !== undefined) {
          return { ...prev, status: "error", errorMessage: event.error };
        }
        if (event.exitCode !== undefined) {
          return { ...prev, status: "done", exitCode: event.exitCode };
        }
        if (event.chunk !== undefined) {
          return { ...prev, output: prev.output + event.chunk };
        }
        return prev;
      });
    });
  }, [codeRunContext]);

  // Auto-scroll output
  useEffect(() => {
    const el = outputRef.current;
    if (el && runState.status === "running") {
      el.scrollTop = el.scrollHeight;
    }
  }, [runState.output, runState.status]);

  const handleRun = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!codeRunContext || !language) return;
    const script = buildRunScript(language, code);
    if (!script) return;

    // Reset and expand
    setRunState({ status: "running", output: "", runId: undefined });
    setIsExpanded(true);

    try {
      const runId = await codeRunContext.api.runCodeBlock(script.args[1] ?? code, codeRunContext.workspacePath);
      setRunState((prev) => ({ ...prev, runId }));
    } catch (err) {
      setRunState({ status: "error", output: "", errorMessage: err instanceof Error ? err.message : String(err) });
    }
  }, [codeRunContext, language, code]);

  const handleAbort = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!codeRunContext || !runState.runId) return;
    await codeRunContext.api.abortCodeBlock(runState.runId).catch(() => {});
    setRunState((prev) => ({ ...prev, status: "done", exitCode: -1 }));
  }, [codeRunContext, runState.runId]);

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

  const exitSuccess = runState.status === "done" && (runState.exitCode === 0 || runState.exitCode === undefined);

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
          {canRun && (
            runState.status === "running" ? (
              <button
                type="button"
                className="markdown-code-block__run markdown-code-block__run--abort"
                onClick={handleAbort}
                title="终止运行"
                aria-label="终止运行"
              >
                <span className="markdown-code-block__run-dot markdown-code-block__run-dot--pulse" />
                <span>终止</span>
              </button>
            ) : (
              <button
                type="button"
                className={`markdown-code-block__run ${runState.status === "done" ? (exitSuccess ? "markdown-code-block__run--success" : "markdown-code-block__run--fail") : ""}`}
                onClick={handleRun}
                title="运行代码"
                aria-label="运行代码"
              >
                {runState.status === "done" ? (
                  exitSuccess ? <CheckSmallIcon /> : <span>✕</span>
                ) : (
                  <span className="markdown-code-block__run-triangle" />
                )}
                <span>{runState.status === "done" ? (exitSuccess ? "成功" : `退出 ${String(runState.exitCode)}`) : "运行"}</span>
              </button>
            )
          )}
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
      {(runState.status !== "idle" || runState.output) && (
        <div className={`markdown-code-block__output ${runState.status === "running" ? "markdown-code-block__output--running" : runState.status === "error" ? "markdown-code-block__output--error" : exitSuccess ? "markdown-code-block__output--success" : "markdown-code-block__output--fail"}`}>
          <div className="markdown-code-block__output-header">
            <span className="markdown-code-block__output-label">
              {runState.status === "running" ? "运行中…" : runState.status === "error" ? `错误: ${runState.errorMessage ?? ""}` : `退出码 ${String(runState.exitCode ?? 0)}`}
            </span>
            {runState.status !== "running" && (
              <button
                type="button"
                className="markdown-code-block__output-clear"
                onClick={(e) => { e.stopPropagation(); setRunState({ status: "idle", output: "" }); }}
                title="清除输出"
              >
                清除
              </button>
            )}
          </div>
          <pre
            className="markdown-code-block__output-pre"
            ref={outputRef}
          >
            {runState.output || (runState.status === "done" && !runState.output ? "(无输出)" : "")}
          </pre>
        </div>
      )}
    </div>
  );
}

export const MarkdownCodeBlock = memo(MarkdownCodeBlockImpl);
