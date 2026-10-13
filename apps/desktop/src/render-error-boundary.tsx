import { Component, type ErrorInfo, type ReactNode } from "react";

export class RenderErrorBoundary extends Component<{
  children: ReactNode;
  fallback?: ReactNode;
}, { failed: boolean; errorMessage?: string; componentStack?: string }> {
  state: { failed: boolean; errorMessage?: string; componentStack?: string } = { failed: false };

  static getDerivedStateFromError(error: Error) {
    return { failed: true, errorMessage: error?.message || String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Component names are useful diagnostics without logging conversation data.
    console.error("Renderer component failed", error?.message, info.componentStack);
    this.setState({ componentStack: info.componentStack || undefined });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ?? (
      <div role="alert" className="renderer-recovery">
        <p>界面暂时无法显示。会话仍保存在本机。</p>
        {this.state.errorMessage ? (
          <p style={{ color: "#ef4444", fontSize: "13px", fontFamily: "monospace", margin: "12px 0", userSelect: "text" }}>
            {this.state.errorMessage}
          </p>
        ) : null}
        {this.state.componentStack ? (
          <pre style={{ fontSize: "11px", color: "var(--text-muted)", background: "rgba(0,0,0,0.05)", padding: "8px", borderRadius: "4px", overflow: "auto", maxHeight: "200px", userSelect: "text" }}>
            {this.state.componentStack}
          </pre>
        ) : null}
        <button type="button" onClick={() => window.location.reload()}>重新加载界面</button>
      </div>
    );
  }
}
