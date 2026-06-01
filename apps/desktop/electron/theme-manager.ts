import { nativeTheme, type BrowserWindow } from "electron";
import { desktopIpc } from "../src/ipc";
import type { ThemeMode } from "../src/desktop-state";

export class ThemeManager {
  private mode: ThemeMode = "system";
  private window: BrowserWindow | null = null;

  constructor() {
    nativeTheme.on("updated", () => {
      this.broadcast();
    });
  }

  setWindow(win: BrowserWindow) {
    this.window = win;
  }

  getMode(): ThemeMode {
    return this.mode;
  }

  getResolvedTheme(): "light" | "dark" {
    if (this.mode === "system") {
      return nativeTheme.shouldUseDarkColors ? "dark" : "light";
    }
    return this.mode;
  }

  setMode(mode: ThemeMode) {
    this.mode = mode;
    if (mode === "system") {
      nativeTheme.themeSource = "system";
    } else {
      nativeTheme.themeSource = mode;
    }
    this.broadcast();
  }

  private broadcast() {
    this.window?.webContents.send(desktopIpc.themeChanged, this.getResolvedTheme());
  }
}
