import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { FilePreviewResult, PiDesktopApi } from "./ipc";
import {
  CheckSmallIcon,
  CloseIcon,
  CopyIcon,
  FileIcon,
  MaximizeIcon,
  MinimizeIcon,
} from "./icons";
import { MessageMarkdown } from "./message-markdown";
import { highlightLine, renderHighlightTokens } from "./syntax-highlight";

export interface FilePreviewModalProps {
  readonly api: PiDesktopApi;
  readonly workspaceId: string;
  readonly filePath: string;
  readonly initialLine?: number;
  readonly onClose: () => void;
  readonly onPreviewFile?: (path: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilePreviewModal({
  api,
  workspaceId,
  filePath,
  initialLine,
  onClose,
  onPreviewFile,
}: FilePreviewModalProps) {
  const [preview, setPreview] = useState<FilePreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"rendered" | "source">("rendered");
  const [copied, setCopied] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  // Window geometry state: position, size, and maximized state
  const [isMaximized, setIsMaximized] = useState(false);
  const [windowSize, setWindowSize] = useState(() => {
    const width = Math.min(960, Math.max(560, window.innerWidth - 80));
    const height = Math.min(720, Math.max(400, window.innerHeight - 80));
    return { width, height };
  });
  const [windowPos, setWindowPos] = useState(() => {
    const defaultW = Math.min(960, Math.max(560, window.innerWidth - 80));
    const defaultH = Math.min(720, Math.max(400, window.innerHeight - 80));
    const x = Math.max(16, Math.round((window.innerWidth - defaultW) / 2));
    const y = Math.max(16, Math.round((window.innerHeight - defaultH) / 2));
    return { x, y };
  });

  const modalRef = useRef<HTMLDivElement | null>(null);
  const targetLineRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Clean path without :line anchor
  const cleanPath = filePath.replace(/:\d+(?::\d+)?$/, "");

  // Load file preview from workspace
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSaveError("");
    setPreview(null);

    void api
      .previewWorkspaceFile(workspaceId, cleanPath)
      .then((result) => {
        if (active) {
          setPreview(result);
          setLoading(false);
          // If markdown, default to rendered; if code/text, default to source
          setActiveTab(result.ok && result.kind === "markdown" ? "rendered" : "source");
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setPreview({
            ok: false,
            kind: "unsupported",
            path: cleanPath,
            name: cleanPath.split("/").at(-1) || cleanPath,
            sizeBytes: 0,
            message: err instanceof Error ? err.message : String(err),
          });
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [api, cleanPath, workspaceId]);

  // Scroll to initial targeted line if provided
  useEffect(() => {
    if (!loading && targetLineRef.current) {
      targetLineRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loading, activeTab]);

  // Escape key closes modal; Cmd+F toggles search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowSearch((prev) => {
          const next = !prev;
          if (next) {
            setTimeout(() => searchInputRef.current?.focus(), 50);
          }
          return next;
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Copy full content or partial selection on demand
  const handleCopy = useCallback(async () => {
    // Check if user has active text selection inside modal
    const selection = window.getSelection();
    let textToCopy = "";
    if (
      selection &&
      !selection.isCollapsed &&
      modalRef.current &&
      selection.anchorNode &&
      modalRef.current.contains(selection.anchorNode)
    ) {
      textToCopy = selection.toString();
    } else {
      textToCopy = preview?.content ?? "";
    }
    if (!textToCopy) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textArea = document.createElement("textarea");
      textArea.value = textToCopy;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [preview?.content]);

  // Copy file path
  const handleCopyPath = useCallback(async () => {
    const pathText = preview?.path || cleanPath;
    try {
      await navigator.clipboard.writeText(pathText);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 1600);
    } catch {
      // ignore
    }
  }, [cleanPath, preview?.path]);

  // Save file locally
  const handleSaveAs = useCallback(async () => {
    if (!preview?.ok) return;
    setSaveError("");
    try {
      await api.saveWorkspaceFileAs(workspaceId, preview.path);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [api, preview, workspaceId]);

  // Drag-to-move window
  const handleHeaderMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (isMaximized) return;
    // Don't drag if clicking buttons or inputs
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest("a")) {
      return;
    }
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    const initialPos = { ...windowPos };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const newX = Math.max(0, Math.min(window.innerWidth - 120, initialPos.x + deltaX));
      const newY = Math.max(0, Math.min(window.innerHeight - 80, initialPos.y + deltaY));
      setWindowPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Drag-to-resize window (corner: se, edge: e, edge: s)
  const handleResizeMouseDown = (direction: "se" | "e" | "s") => (e: ReactMouseEvent) => {
    if (isMaximized) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const initialSize = { ...windowSize };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      let newWidth = initialSize.width;
      let newHeight = initialSize.height;

      if (direction === "se" || direction === "e") {
        newWidth = Math.max(
          460,
          Math.min(window.innerWidth - windowPos.x - 16, initialSize.width + deltaX),
        );
      }
      if (direction === "se" || direction === "s") {
        newHeight = Math.max(
          320,
          Math.min(window.innerHeight - windowPos.y - 16, initialSize.height + deltaY),
        );
      }

      setWindowSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const lineCount = preview?.content ? preview.content.split("\n").length : 0;
  const isMarkdown = preview?.ok && preview.kind === "markdown";

  return (
    <div
      className="file-preview-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`file-preview-modal ${isMaximized ? "file-preview-modal--maximized" : ""}`}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={`File preview: ${preview?.name ?? cleanPath}`}
        style={
          isMaximized
            ? undefined
            : {
                width: `${windowSize.width}px`,
                height: `${windowSize.height}px`,
                left: `${windowPos.x}px`,
                top: `${windowPos.y}px`,
              }
        }
      >
        {/* Header / Titlebar */}
        <div className="file-preview-modal__header" onMouseDown={handleHeaderMouseDown}>
          <div className="file-preview-modal__title-area">
            <span className="file-preview-modal__file-icon" aria-hidden="true">
              <FileIcon />
            </span>
            <div className="file-preview-modal__title-info">
              <span className="file-preview-modal__filename">
                {preview?.name ?? cleanPath.split("/").at(-1)}
              </span>
              <button
                type="button"
                className="file-preview-modal__path-badge"
                onClick={() => void handleCopyPath()}
                title="Click to copy file path"
              >
                {cleanPath}
                {copiedPath ? <span className="file-preview-modal__copied-mini">✓ copied</span> : null}
              </button>
            </div>
            {preview?.ok && (
              <div className="file-preview-modal__badges">
                {preview.sizeBytes > 0 && (
                  <span className="file-preview-modal__badge">{formatBytes(preview.sizeBytes)}</span>
                )}
                {lineCount > 0 && (
                  <span className="file-preview-modal__badge">{lineCount} lines</span>
                )}
                {preview.kind === "code" && preview.language && (
                  <span className="file-preview-modal__badge file-preview-modal__badge--lang">
                    {preview.language}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* View toggle & Actions */}
          <div className="file-preview-modal__actions">
            {isMarkdown && (
              <div className="file-preview-modal__tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "rendered"}
                  className={`file-preview-modal__tab ${activeTab === "rendered" ? "file-preview-modal__tab--active" : ""}`}
                  onClick={() => setActiveTab("rendered")}
                >
                  预览
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "source"}
                  className={`file-preview-modal__tab ${activeTab === "source" ? "file-preview-modal__tab--active" : ""}`}
                  onClick={() => setActiveTab("source")}
                >
                  源码
                </button>
              </div>
            )}

            {/* Quick search button */}
            <button
              type="button"
              className={`file-preview-modal__action-btn ${showSearch ? "file-preview-modal__action-btn--active" : ""}`}
              onClick={() => {
                setShowSearch((s) => !s);
                if (!showSearch) {
                  setTimeout(() => searchInputRef.current?.focus(), 50);
                }
              }}
              title="Search in file (Cmd+F)"
              aria-label="Search in file"
            >
              🔍
            </button>

            {/* Copy Button (Copies selection if present, else full file) */}
            <button
              type="button"
              className={`file-preview-modal__action-btn file-preview-modal__action-btn--copy ${copied ? "file-preview-modal__action-btn--copied" : ""}`}
              onClick={() => void handleCopy()}
              title="复制全文或选中内容"
            >
              {copied ? <CheckSmallIcon /> : <CopyIcon />}
              <span>{copied ? "已复制!" : "复制"}</span>
            </button>

            {/* Save as button */}
            {preview?.ok && (
              <button
                type="button"
                className="file-preview-modal__action-btn"
                onClick={() => void handleSaveAs()}
                title="Save file as..."
              >
                另存为
              </button>
            )}

            {/* Maximize / Restore */}
            <button
              type="button"
              className="file-preview-modal__action-btn"
              onClick={() => setIsMaximized((m) => !m)}
              title={isMaximized ? "Restore" : "Maximize"}
              aria-label={isMaximized ? "Restore window" : "Maximize window"}
            >
              {isMaximized ? <MinimizeIcon /> : <MaximizeIcon />}
            </button>

            {/* Close */}
            <button
              type="button"
              className="file-preview-modal__close-btn"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close file preview"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Search bar row */}
        {showSearch && (
          <div className="file-preview-modal__search-bar">
            <input
              ref={searchInputRef}
              type="text"
              className="file-preview-modal__search-input"
              placeholder="在文件中查找… (按 Esc 清空)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setSearchQuery("");
                  setShowSearch(false);
                }
              }}
            />
            {searchQuery && (
              <button
                type="button"
                className="file-preview-modal__search-clear"
                onClick={() => setSearchQuery("")}
                title="Clear search"
                aria-label="Clear search"
              >
                <CloseIcon />
              </button>
            )}
          </div>
        )}

        {/* Modal Body / Viewer */}
        <div className="file-preview-modal__body">
          {loading ? (
            <div className="file-preview-modal__loading">
              <span className="file-preview-modal__spinner" aria-hidden="true" />
              <span>正在加载文件内容…</span>
            </div>
          ) : null}

          {/* Error / Unsupported state */}
          {!loading && preview && !preview.ok ? (
            <div className="file-preview-modal__empty">
              <div className="file-preview-modal__empty-icon">⚠️</div>
              <h3 className="file-preview-modal__empty-title">无法预览此文件</h3>
              <p className="file-preview-modal__empty-desc">
                {preview.message || "该文件在当前工作区不存在或暂不支持预览。"}
              </p>
              <code className="file-preview-modal__empty-path">{preview.path}</code>
            </div>
          ) : null}

          {/* Image preview */}
          {!loading && preview?.ok && preview.kind === "image" && preview.dataUrl ? (
            <div className="file-preview-modal__image-wrap">
              <img
                src={preview.dataUrl}
                alt={preview.name}
                className="file-preview-modal__image"
              />
            </div>
          ) : null}

          {/* PDF preview */}
          {!loading && preview?.ok && preview.kind === "pdf" && preview.dataUrl ? (
            <embed
              className="file-preview-modal__pdf"
              src={preview.dataUrl}
              type="application/pdf"
            />
          ) : null}

          {/* Markdown Rendered view */}
          {!loading &&
          preview?.ok &&
          preview.kind === "markdown" &&
          activeTab === "rendered" &&
          preview.content !== undefined ? (
            <div className="file-preview-modal__markdown-content">
              <MessageMarkdown text={preview.content} onPreviewFile={onPreviewFile} />
            </div>
          ) : null}

          {/* Code / Text / Source view */}
          {!loading &&
          preview?.ok &&
          (preview.kind === "code" ||
            preview.kind === "text" ||
            (preview.kind === "markdown" && activeTab === "source")) &&
          preview.content !== undefined ? (
            <CodeViewer
              content={preview.content}
              language={preview.kind === "markdown" ? "markdown" : preview.language}
              initialLine={initialLine}
              searchQuery={searchQuery}
              targetLineRef={targetLineRef}
            />
          ) : null}

          {saveError ? (
            <div className="file-preview-modal__error">{saveError}</div>
          ) : null}
        </div>

        {/* Footer info & resize handles */}
        <div className="file-preview-modal__footer">
          <div className="file-preview-modal__hint">
            <span>可直接使用鼠标拖拽划选并复制任意局部内容；双击或拖拽边角可自由缩放窗口。</span>
          </div>
          {/* Resize handles */}
          {!isMaximized && (
            <>
              <div
                className="file-preview-modal__resize-handle file-preview-modal__resize-handle--e"
                onMouseDown={handleResizeMouseDown("e")}
                title="Drag to resize width"
              />
              <div
                className="file-preview-modal__resize-handle file-preview-modal__resize-handle--s"
                onMouseDown={handleResizeMouseDown("s")}
                title="Drag to resize height"
              />
              <div
                className="file-preview-modal__resize-handle file-preview-modal__resize-handle--se"
                onMouseDown={handleResizeMouseDown("se")}
                title="Drag to resize window"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CodeViewer({
  content,
  language,
  initialLine,
  searchQuery,
  targetLineRef,
}: {
  readonly content: string;
  readonly language?: string;
  readonly initialLine?: number;
  readonly searchQuery?: string;
  readonly targetLineRef: React.RefObject<HTMLDivElement | null>;
}) {
  const visibleLines = useMemo(() => {
    return content.split("\n").slice(0, 10000);
  }, [content]);
  const q = searchQuery?.trim().toLowerCase();

  return (
    <div className="file-preview-modal__code-wrap">
      <pre className="file-preview-modal__code">
        <code>
          {visibleLines.map((line, index) => {
            const lineNumber = index + 1;
            const isTargetLine = initialLine === lineNumber;
            const isSearchMatch = q && line.toLowerCase().includes(q);

            return (
              <div
                key={lineNumber}
                ref={isTargetLine ? targetLineRef : undefined}
                className={`file-preview-modal__line ${
                  isTargetLine ? "file-preview-modal__line--target" : ""
                } ${isSearchMatch ? "file-preview-modal__line--matched" : ""}`}
              >
                <span className="file-preview-modal__line-num" aria-hidden="true">
                  {lineNumber}
                </span>
                <span className="file-preview-modal__line-code">
                  {language && language !== "text"
                    ? renderHighlightTokens(highlightLine(line, language))
                    : line}
                </span>
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
