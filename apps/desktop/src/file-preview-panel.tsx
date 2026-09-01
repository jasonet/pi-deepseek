import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type { FilePreviewResult, PiDesktopApi } from "./ipc";
import { CloseIcon, FileIcon } from "./icons";
import { MessageMarkdown } from "./message-markdown";
import { highlightLine, type HighlightLine } from "./syntax-highlight";

export interface FilePreviewRequest {
  readonly workspaceId: string;
  readonly path: string;
  readonly nonce: number;
}

export function FilePreviewPanel({
  api,
  request,
  onClose,
  onPreviewFile,
}: {
  readonly api: PiDesktopApi;
  readonly request: FilePreviewRequest;
  readonly onClose: () => void;
  readonly onPreviewFile?: (path: string) => void;
}) {
  const [preview, setPreview] = useState<FilePreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSaveError("");
    setPreview(null);
    void api.previewWorkspaceFile(request.workspaceId, request.path).then((result) => {
      if (active) {
        setPreview(result);
        setLoading(false);
      }
    }).catch((error: unknown) => {
      if (active) {
        setPreview({
          ok: false,
          kind: "unsupported",
          path: request.path,
          name: request.path.split("/").at(-1) || request.path,
          sizeBytes: 0,
          message: error instanceof Error ? error.message : String(error),
        });
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [api, request.nonce, request.path, request.workspaceId]);

  const save = async () => {
    if (!preview?.ok) return;
    setSaveError("");
    try {
      await api.saveWorkspaceFileAs(request.workspaceId, preview.path);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    void save();
  };

  return (
    <aside className="file-preview-panel" data-testid="file-preview-panel">
      <div className="file-preview-panel__header">
        <div className="file-preview-panel__heading">
          <span className="file-preview-panel__icon" aria-hidden="true"><FileIcon /></span>
          <div>
            <h2 className="file-preview-panel__title">File preview</h2>
            <div className="file-preview-panel__path" title={preview?.path ?? request.path}>
              {preview?.name ?? request.path}
            </div>
          </div>
        </div>
        <div className="file-preview-panel__actions">
          <button className="button button--small" type="button" onClick={() => void save()} disabled={!preview?.ok}>
            Save as
          </button>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close file preview">
            <CloseIcon />
          </button>
        </div>
      </div>
      <div className="file-preview-panel__body" onContextMenu={handleContextMenu}>
        {loading ? <div className="file-preview-panel__empty">Loading preview…</div> : null}
        {!loading && preview?.ok && preview.kind === "image" && preview.dataUrl ? (
          <img className="file-preview-panel__image" src={preview.dataUrl} alt={preview.name} />
        ) : null}
        {!loading && preview?.ok && preview.kind === "pdf" && preview.dataUrl ? (
          <embed className="file-preview-panel__pdf" src={preview.dataUrl} type="application/pdf" />
        ) : null}
        {!loading && preview?.ok && preview.kind === "markdown" && preview.content !== undefined ? (
          <div className="file-preview-panel__markdown">
            <MessageMarkdown text={preview.content} onPreviewFile={onPreviewFile} />
          </div>
        ) : null}
        {!loading && preview?.ok && (preview.kind === "code" || preview.kind === "text") && preview.content !== undefined ? (
          <CodePreview content={preview.content} language={preview.language} />
        ) : null}
        {!loading && preview && !preview.ok ? (
          <div className="file-preview-panel__empty">
            <strong>{preview.name}</strong>
            <span>{preview.message ?? "This file cannot be previewed."}</span>
          </div>
        ) : null}
        {saveError ? <div className="file-preview-panel__error">{saveError}</div> : null}
      </div>
      {preview?.ok ? <div className="file-preview-panel__hint">Right-click the preview to save a local copy.</div> : null}
    </aside>
  );
}

function CodePreview({ content, language }: { readonly content: string; readonly language?: string }) {
  const lines = content.split("\n");
  const visibleLines = lines.slice(0, 5000);
  return (
    <pre className="file-preview-panel__code">
      <code>
        {visibleLines.map((line, index) => (
          <span className="file-preview-panel__line" key={`${index}:${line}`}>
            <span className="file-preview-panel__line-number">{index + 1}</span>
            <span className="file-preview-panel__line-content">
              {language && language !== "text" ? renderTokens(highlightLine(line, language)) : line}
            </span>
            {"\n"}
          </span>
        ))}
      </code>
    </pre>
  );
}

function renderTokens(tokens: HighlightLine): ReactNode {
  return tokens.map((token, index) =>
    typeof token === "string" ? token : <span className={token.className} key={index}>{renderTokens(token.children)}</span>,
  );
}
