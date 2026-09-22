import {
  Fragment,
  cloneElement,
  isValidElement,
  useMemo,
  type MouseEvent,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileIcon } from "./icons";
import { MarkdownCodeBlock } from "./markdown-code-block";
import { MermaidDiagram } from "./mermaid-diagram";

const REMARK_PLUGINS = [remarkGfm];

export const NUMBER_REGEX = /\b\d+(?:,\d{3})*(?:\.\d+)?%?(?![a-zA-Z\d]|[.,]\d)/g;

const FILE_EXT_LIST =
  "md|markdown|ts|tsx|js|jsx|mjs|cjs|json|yml|yaml|toml|css|scss|less|html|svg|png|jpg|jpeg|gif|webp|pdf|sh|bash|zsh|py|rs|go|java|c|cpp|h|hpp|sql|txt|env|lock|plist|xml";

export const FILE_PATH_PROSE_REGEX = new RegExp(
  `(?:^|(?<=[\\s(（[\\[【<:：至到在从于]))((?:\\.{1,2}\\/|[a-zA-Z0-9_.-]+\\/)+[a-zA-Z0-9_.-]+\\.(?:${FILE_EXT_LIST})|(?:package\\.json|README\\.md|CLAUDE\\.md|AGENTS\\.md|tsconfig\\.json|pnpm-lock\\.yaml|Cargo\\.toml|tauri\\.conf\\.json|electron-builder\\.yml|vite\\.config\\.ts|playwright\\.config\\.ts|MEMORY\\.md|\\.gitignore|\\.env|\\.env\\.local))(?::(\\d+)(?::(\\d+))?)?(?=[.,;:!?)）\\]】>'"\\s。，、；：]|$)`,
  "gi",
);

export const EXACT_FILE_PATH_REGEX = new RegExp(
  `^(?:(?:\\.{1,2}\\/|[a-zA-Z0-9_.-]+\\/)+[a-zA-Z0-9_.-]+\\.(?:${FILE_EXT_LIST})|(?:package\\.json|README\\.md|CLAUDE\\.md|AGENTS\\.md|tsconfig\\.json|pnpm-lock\\.yaml|Cargo\\.toml|tauri\\.conf\\.json|electron-builder\\.yml|vite\\.config\\.ts|playwright\\.config\\.ts|MEMORY\\.md|\\.gitignore|\\.env|\\.env\\.local))(?::\\d+(?::\\d+)?)?$`,
  "i",
);

export function isFilePathString(raw: string): boolean {
  const text = raw.trim();
  if (text.length === 0 || text.length > 250 || text.includes("\n") || text.startsWith("http:") || text.startsWith("https:")) {
    return false;
  }
  return EXACT_FILE_PATH_REGEX.test(text);
}

export function extractNumbersFromText(text: string): string[] {
  return text.match(NUMBER_REGEX) ?? [];
}

function highlightNumbersInText(text: string): ReactNode {
  if (!/\d/.test(text)) {
    return text;
  }

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  NUMBER_REGEX.lastIndex = 0;
  while ((match = NUMBER_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <strong className="markdown-num" key={match.index}>
        {match[0]}
      </strong>,
    );
    lastIndex = NUMBER_REGEX.lastIndex;
  }

  if (lastIndex === 0) {
    return text;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

export function formatFileMentionsAndNumbers(
  text: string,
  onPreviewFile?: (path: string) => void,
): ReactNode {
  FILE_PATH_PROSE_REGEX.lastIndex = 0;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FILE_PATH_PROSE_REGEX.exec(text)) !== null) {
    const matchIndex = match.index;
    const fullMatch = match[0];
    const filePath = match[1];
    const lineNumber = match[2];

    if (!filePath) continue;

    if (matchIndex > lastIndex) {
      parts.push(highlightNumbersInText(text.slice(lastIndex, matchIndex)));
    }

    const cleanPath = filePath;
    const targetWithLine = lineNumber ? `${cleanPath}:${lineNumber}` : cleanPath;

    parts.push(
      <span
        key={`file:${matchIndex}:${targetWithLine}`}
        className="markdown-file-pill"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onPreviewFile?.(targetWithLine);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPreviewFile?.(targetWithLine);
          }
        }}
        title={`查看文件: ${targetWithLine}`}
      >
        <span className="markdown-file-pill__icon" aria-hidden="true">
          <FileIcon />
        </span>
        <span className="markdown-file-pill__text">{fullMatch}</span>
      </span>,
    );

    lastIndex = FILE_PATH_PROSE_REGEX.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(highlightNumbersInText(text.slice(lastIndex)));
  }

  return <>{parts}</>;
}

const SKIP_PROSE_CLASSES = new Set(["markdown-num", "markdown-file-pill", "message-inline-code"]);

function formatProseContent(children: ReactNode, onPreviewFile?: (path: string) => void): ReactNode {
  if (typeof children === "string") {
    return formatFileMentionsAndNumbers(children, onPreviewFile);
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{formatProseContent(child, onPreviewFile)}</Fragment>
    ));
  }
  if (isValidElement(children)) {
    const type = children.type;
    const props = children.props as { children?: ReactNode; className?: string };
    if (
      type === "code" ||
      type === "pre" ||
      type === "a" ||
      type === MarkdownCodeBlock ||
      (props.className && SKIP_PROSE_CLASSES.has(props.className))
    ) {
      return children;
    }
    if ("children" in props) {
      return cloneElement(children, {}, formatProseContent(props.children, onPreviewFile));
    }
  }
  return children;
}

/** Inline code renders on its own; file paths receive an interactive file pill. */
function MarkdownInlineCode({
  className,
  children,
  onPreviewFile,
}: {
  className?: string;
  children?: ReactNode;
  onPreviewFile?: (path: string) => void;
}) {
  const rawText = extractTextFromChildren(children).trim();
  const isFile = isFilePathString(rawText);

  if (isFile && onPreviewFile) {
    return (
      <code
        className={`${className ?? "message-inline-code"} message-inline-code--file`}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onPreviewFile(rawText);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPreviewFile(rawText);
          }
        }}
        title={`点击浮层查看文件: ${rawText}`}
      >
        <span className="markdown-file-pill__icon" aria-hidden="true">
          <FileIcon />
        </span>
        {children}
      </code>
    );
  }

  return <code className={className ?? "message-inline-code"}>{children}</code>;
}

function extractTextFromChildren(children: ReactNode): string {
  if (children === null || children === undefined) return "";
  if (typeof children === "string") return children;
  if (typeof children === "number" || typeof children === "boolean") return String(children);
  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join("");
  }
  if (isValidElement(children)) {
    const props = children.props as { children?: ReactNode };
    return extractTextFromChildren(props?.children);
  }
  if (typeof children === "object") {
    const obj = children as unknown as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    if (typeof obj.value === "string") return obj.value;
    try {
      return JSON.stringify(children, null, 2);
    } catch {
      return "";
    }
  }
  return typeof children === "string" ? children : "";
}

function MarkdownPre({ children }: { children?: ReactNode }) {
  if (!isValidElement(children)) {
    return <pre>{children}</pre>;
  }
  const { className, children: codeChildren } = children.props as {
    className?: string;
    children?: ReactNode;
  };
  const language = className?.startsWith("language-") ? className.slice("language-".length) : undefined;
  const rawCode = extractTextFromChildren(codeChildren).replace(/\n$/, "");

  // Flowchart & diagram support (e.g. mermaid, flowchart)
  if (language === "mermaid" || language === "flowchart") {
    return <MermaidDiagram code={rawCode} />;
  }

  return <MarkdownCodeBlock language={language} code={rawCode} />;
}

export function normalizeMarkdownText(input: unknown): string {
  if (input === null || input === undefined) return "";
  if (typeof input === "string") {
    if (input.trim() === "[object Object]") return "";
    if (input.startsWith("{") && input.endsWith("}")) {
      try {
        const parsed = JSON.parse(input);
        if (parsed && typeof parsed === "object") {
          return formatObjectToMarkdown(parsed);
        }
      } catch {
        // Not valid JSON, keep original text
      }
    }
    return input;
  }
  if (typeof input === "object") {
    return formatObjectToMarkdown(input as Record<string, unknown>);
  }
  return String(input);
}

function formatObjectToMarkdown(obj: Record<string, unknown>): string {
  if (obj.type === "image" && typeof obj.data === "string") {
    const mime = typeof obj.mimeType === "string" ? obj.mimeType : "image/png";
    return `![${typeof obj.name === "string" ? obj.name : "image"}](data:${mime};base64,${obj.data})`;
  }
  if (typeof obj.text === "string") {
    return obj.text;
  }
  if (typeof obj.content === "string") {
    return obj.content;
  }
  if (Array.isArray(obj.content)) {
    return obj.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null) {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") return p.text;
          if (p.type === "image" && typeof p.data === "string") {
            const mime = typeof p.mimeType === "string" ? p.mimeType : "image/png";
            return `\n\n![${typeof p.name === "string" ? p.name : "image"}](data:${mime};base64,${p.data})\n\n`;
          }
        }
        return "";
      })
      .join("\n\n");
  }
  try {
    return `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``;
  } catch {
    return "";
  }
}

const BASE_MARKDOWN_COMPONENTS = {
  pre: MarkdownPre,
  img: ({ src, alt }: { src?: string; alt?: string }) => {
    if (!src) return null;
    return (
      <span className="markdown-image-wrap">
        <img src={src} alt={alt || "Image"} className="markdown-image" loading="lazy" />
        {alt && alt !== "image" && alt !== "Image" ? (
          <span className="markdown-image-caption">{alt}</span>
        ) : null}
      </span>
    );
  },
} as const;

export function MessageMarkdown({
  text,
  onPreviewFile,
}: {
  readonly text: string;
  readonly onPreviewFile?: (path: string) => void;
}) {
  const normalizedText = useMemo(() => normalizeMarkdownText(text), [text]);

  const components = useMemo(
    () => ({
      ...BASE_MARKDOWN_COMPONENTS,
      code: ({ className, children }: { className?: string; children?: ReactNode }) => (
        <MarkdownInlineCode className={className} onPreviewFile={onPreviewFile}>
          {children}
        </MarkdownInlineCode>
      ),
      p: ({ children }: { children?: ReactNode }) => (
        <p>{formatProseContent(children, onPreviewFile)}</p>
      ),
      li: ({ children }: { children?: ReactNode }) => (
        <li>{formatProseContent(children, onPreviewFile)}</li>
      ),
      blockquote: ({ children }: { children?: ReactNode }) => (
        <blockquote>{formatProseContent(children, onPreviewFile)}</blockquote>
      ),
      h1: ({ children }: { children?: ReactNode }) => (
        <h1>{formatProseContent(children, onPreviewFile)}</h1>
      ),
      h2: ({ children }: { children?: ReactNode }) => (
        <h2>{formatProseContent(children, onPreviewFile)}</h2>
      ),
      h3: ({ children }: { children?: ReactNode }) => (
        <h3>{formatProseContent(children, onPreviewFile)}</h3>
      ),
      h4: ({ children }: { children?: ReactNode }) => (
        <h4>{formatProseContent(children, onPreviewFile)}</h4>
      ),
      h5: ({ children }: { children?: ReactNode }) => (
        <h5>{formatProseContent(children, onPreviewFile)}</h5>
      ),
      h6: ({ children }: { children?: ReactNode }) => (
        <h6>{formatProseContent(children, onPreviewFile)}</h6>
      ),
      td: ({ children }: { children?: ReactNode }) => (
        <td>{formatProseContent(children, onPreviewFile)}</td>
      ),
      th: ({ children }: { children?: ReactNode }) => (
        <th>{formatProseContent(children, onPreviewFile)}</th>
      ),
      a: ({ href, children }: { href?: string; children?: ReactNode }) => {
        const isFileLink = Boolean(href && isPreviewableFileLink(href));
        const isHttpLink = Boolean(href && (href.startsWith("http://") || href.startsWith("https://")));

        const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
          if (isFileLink && href && onPreviewFile) {
            event.preventDefault();
            onPreviewFile(href);
            return;
          }
          if (isHttpLink && href) {
            event.preventDefault();
            if (window.piApp?.openExternal) {
              void window.piApp.openExternal(href);
            } else {
              window.open(href, "_blank", "noopener,noreferrer");
            }
          }
        };

        return (
          <a
            data-file-link={isFileLink ? "true" : undefined}
            className={isFileLink ? "markdown-file-link" : undefined}
            href={href}
            onClick={handleClick}
            rel={isFileLink ? undefined : "noreferrer noopener"}
            target={isFileLink ? undefined : "_blank"}
            title={isFileLink ? `预览文件: ${href}` : undefined}
          >
            {isFileLink ? (
              <span className="markdown-file-pill__icon" aria-hidden="true">
                <FileIcon />
              </span>
            ) : null}
            {children}
          </a>
        );
      },
    }),
    [onPreviewFile],
  );

  return (
    <div className="message__content">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {normalizedText}
      </ReactMarkdown>
    </div>
  );
}

export function isPreviewableFileLink(href: string): boolean {
  if (/^(https?:|mailto:|tel:|ftp:|#)/i.test(href)) {
    return false;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) {
    return false;
  }
  return true;
}
