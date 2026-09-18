import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";
import { CheckSmallIcon, CopyIcon } from "./icons";
import { useT } from "./i18n";

let mermaidLoadPromise: Promise<any> | null = null;

function loadMermaid(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  const win = window as any;
  if (win.mermaid) return Promise.resolve(win.mermaid);
  if (mermaidLoadPromise) return mermaidLoadPromise;

  mermaidLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mermaid="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve((window as any).mermaid));
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.setAttribute("data-mermaid", "true");
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
    script.async = true;
    script.onload = () => {
      const m = (window as any).mermaid;
      if (m) {
        m.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
        });
        resolve(m);
      } else {
        reject(new Error("Mermaid not initialized"));
      }
    };
    script.onerror = () => {
      mermaidLoadPromise = null;
      reject(new Error("Failed to load mermaid script"));
    };
    document.head.appendChild(script);
  });
  return mermaidLoadPromise;
}

export function MermaidDiagram({ code }: { readonly code: string }) {
  const [viewMode, setViewMode] = useState<"diagram" | "code">("diagram");
  const [svgHtml, setSvgHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const rawId = useId();
  const diagramId = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const t = useT();
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanCode = useMemo(() => code.trim(), [code]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);

    loadMermaid()
      .then(async (mermaid) => {
        if (!active) return;
        const isDark = document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: isDark ? "dark" : "default",
        });
        try {
          const { svg } = await mermaid.render(`${diagramId}-${Date.now()}`, cleanCode);
          if (active) {
            setSvgHtml(svg);
            setIsLoading(false);
          }
        } catch (renderErr) {
          if (active) {
            setError(renderErr instanceof Error ? renderErr.message : String(renderErr));
            setIsLoading(false);
          }
        }
      })
      .catch((loadErr) => {
        if (active) {
          setError(loadErr instanceof Error ? loadErr.message : String(loadErr));
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [cleanCode, diagramId]);

  const handleCopy = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(cleanCode);
      setCopied(true);
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    };
  }, []);

  return (
    <div className="mermaid-diagram">
      <div className="mermaid-diagram__header">
        <div className="mermaid-diagram__header-left">
          <span className="mermaid-diagram__badge">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="2" width="4" height="4" rx="1" />
              <rect x="10" y="2" width="4" height="4" rx="1" />
              <rect x="6" y="10" width="4" height="4" rx="1" />
              <path d="M4 6v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6M8 9v1" />
            </svg>
            <span>流程图 / Flowchart</span>
          </span>
          <div className="mermaid-diagram__tabs">
            <button
              type="button"
              className={`mermaid-diagram__tab ${viewMode === "diagram" ? "mermaid-diagram__tab--active" : ""}`}
              onClick={() => setViewMode("diagram")}
            >
              视图 / Diagram
            </button>
            <button
              type="button"
              className={`mermaid-diagram__tab ${viewMode === "code" ? "mermaid-diagram__tab--active" : ""}`}
              onClick={() => setViewMode("code")}
            >
              代码 / Code
            </button>
          </div>
        </div>
        <div className="mermaid-diagram__header-right">
          <button
            type="button"
            className={`mermaid-diagram__copy ${copied ? "mermaid-diagram__copy--copied" : ""}`}
            onClick={handleCopy}
            title={copied ? t("markdown.copied") : t("markdown.copy")}
            aria-label={copied ? t("markdown.copied") : t("markdown.copy")}
          >
            {copied ? <CheckSmallIcon /> : <CopyIcon />}
            <span>{copied ? t("markdown.copied") : t("markdown.copy")}</span>
          </button>
        </div>
      </div>

      <div className="mermaid-diagram__body">
        {viewMode === "code" ? (
          <pre className="mermaid-diagram__code">
            <code>{cleanCode}</code>
          </pre>
        ) : (
          <div className="mermaid-diagram__render">
            {isLoading && !svgHtml ? (
              <div className="mermaid-diagram__loading">
                <span className="mermaid-diagram__spinner" />
                <span>正在渲染流程图…</span>
              </div>
            ) : svgHtml ? (
              <div
                className="mermaid-diagram__svg-wrapper"
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
            ) : (
              <div className="mermaid-diagram__fallback">
                <div className="mermaid-diagram__fallback-msg">
                  <span>流程图解析中 (点击“代码”查看源定义)</span>
                  {error && <span className="mermaid-diagram__fallback-error">{error}</span>}
                </div>
                <pre className="mermaid-diagram__fallback-code">
                  <code>{cleanCode}</code>
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
