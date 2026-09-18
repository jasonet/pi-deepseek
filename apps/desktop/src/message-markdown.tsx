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
import { MarkdownCodeBlock } from "./markdown-code-block";
import { MermaidDiagram } from "./mermaid-diagram";

const REMARK_PLUGINS = [remarkGfm];

export const NUMBER_REGEX = /\b\d+(?:,\d{3})*(?:\.\d+)?%?(?![a-zA-Z\d]|[.,]\d)/g;

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

const ALREADY_NUMBER_HIGHLIGHTED = "markdown-num";

/**
 * Walks rendered markdown children and bolds numbers in prose. Containers recurse
 * only into plain elements: `<code>`, `<pre>`, links and already-processed
 * `<strong class="markdown-num">` are left untouched so nesting (e.g. `blockquote > p`)
 * cannot highlight the same number twice.
 */
function formatBoldNumbers(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    return highlightNumbersInText(children);
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{formatBoldNumbers(child)}</Fragment>
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
      props.className === ALREADY_NUMBER_HIGHLIGHTED
    ) {
      return children;
    }
    if ("children" in props) {
      return cloneElement(children, {}, formatBoldNumbers(props.children));
    }
  }
  return children;
}

/** Inline code renders on its own; fenced blocks are recognised by their `<pre>` wrapper. */
function MarkdownInlineCode({ className, children }: { className?: string; children?: ReactNode }) {
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

const MARKDOWN_COMPONENTS = {
  pre: MarkdownPre,
  code: MarkdownInlineCode,
  p: ({ children }: { children?: ReactNode }) => <p>{formatBoldNumbers(children)}</p>,
  li: ({ children }: { children?: ReactNode }) => <li>{formatBoldNumbers(children)}</li>,
  blockquote: ({ children }: { children?: ReactNode }) => <blockquote>{formatBoldNumbers(children)}</blockquote>,
  h1: ({ children }: { children?: ReactNode }) => <h1>{formatBoldNumbers(children)}</h1>,
  h2: ({ children }: { children?: ReactNode }) => <h2>{formatBoldNumbers(children)}</h2>,
  h3: ({ children }: { children?: ReactNode }) => <h3>{formatBoldNumbers(children)}</h3>,
  h4: ({ children }: { children?: ReactNode }) => <h4>{formatBoldNumbers(children)}</h4>,
  h5: ({ children }: { children?: ReactNode }) => <h5>{formatBoldNumbers(children)}</h5>,
  h6: ({ children }: { children?: ReactNode }) => <h6>{formatBoldNumbers(children)}</h6>,
  td: ({ children }: { children?: ReactNode }) => <td>{formatBoldNumbers(children)}</td>,
  th: ({ children }: { children?: ReactNode }) => <th>{formatBoldNumbers(children)}</th>,
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
      ...MARKDOWN_COMPONENTS,
      a: ({ href, children }: { href?: string; children?: ReactNode }) => {
        const isFileLink = Boolean(href && isPreviewableFileLink(href));
        const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
          if (!isFileLink || !href || !onPreviewFile) {
            return;
          }
          event.preventDefault();
          onPreviewFile(href);
        };
        return (
          <a
            data-file-link={isFileLink ? "true" : undefined}
            href={href}
            onClick={handleClick}
            rel={isFileLink ? undefined : "noreferrer"}
            target={isFileLink ? undefined : "_blank"}
          >
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
