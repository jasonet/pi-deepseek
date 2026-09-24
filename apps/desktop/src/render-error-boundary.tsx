import { Component, type ErrorInfo, type ReactNode } from "react";

export class RenderErrorBoundary extends Component<{
  children: ReactNode;
  fallback?: ReactNode;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    // Component names are useful diagnostics without logging conversation data.
    console.error("Renderer component failed", info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ?? (
      <div role="alert" className="renderer-recovery">
        <p>界面暂时无法显示。会话仍保存在本机。</p>
        <button type="button" onClick={() => window.location.reload()}>重新加载界面</button>
      </div>
    );
  }
}
