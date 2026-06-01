import type { BrowserWindow } from "electron";
import type { DesktopAppState } from "../src/desktop-state";
import type { SessionRef } from "@pi-gui/session-driver";

type SessionVisibilityOverride = "active" | "inactive" | undefined;

export function isSessionActivelyViewed(
  state: Pick<DesktopAppState, "activeView" | "selectedWorkspaceId" | "selectedSessionId"> | undefined,
  sessionRef: SessionRef,
  window: BrowserWindow | null,
): boolean {
  if (!state) {
    return false;
  }
  if (state.activeView !== "threads") {
    return false;
  }
  if (state.selectedWorkspaceId !== sessionRef.workspaceId || state.selectedSessionId !== sessionRef.sessionId) {
    return false;
  }
  const override = sessionVisibilityOverride();
  if (override === "active") {
    return true;
  }
  if (override === "inactive") {
    return false;
  }
  if (!window || window.isDestroyed() || window.isMinimized() || !window.isVisible()) {
    return false;
  }
  return window.isFocused();
}

function sessionVisibilityOverride(): SessionVisibilityOverride {
  return (globalThis as { __PI_APP_TEST_SESSION_VISIBILITY__?: SessionVisibilityOverride })
    .__PI_APP_TEST_SESSION_VISIBILITY__;
}
