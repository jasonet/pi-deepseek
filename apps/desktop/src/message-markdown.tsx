import { useMemo, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];

const MARKDOWN_COMPONENTS = {
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    const language = className?.replace(/^language-/, "");
    const code = String(children).replace(/\n$/, "");
    if (!className) {
      return <code>{code}</code>;
    }
    return (
      <pre data-language={language}>
        <code className={className}>{code}</code>
      </pre>
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

function isPreviewableFileLink(href: string): boolean {
  if (/^(https?:|mailto:|tel:|ftp:|#)/i.test(href)) {
    return false;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) {
    return false;
  }
  return true;
}
