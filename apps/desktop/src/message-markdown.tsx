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

function MarkdownPre({ children }: { children?: ReactNode }) {
  if (!isValidElement(children)) {
    return <pre>{children}</pre>;
  }
  const { className, children: codeChildren } = children.props as {
    className?: string;
    children?: ReactNode;
  };
  const language = className?.startsWith("language-") ? className.slice("language-".length) : undefined;
  return <MarkdownCodeBlock language={language} code={String(codeChildren ?? "").replace(/\n$/, "")} />;
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
} as const;

export function MessageMarkdown({
  text,
  onPreviewFile,
}: {
  readonly text: string;
  readonly onPreviewFile?: (path: string) => void;
}) {
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
        {text}
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
