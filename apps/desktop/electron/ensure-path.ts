import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter } from "node:path";

let patched = false;

/**
 * When the app is launched from Finder/Dock, launchd hands the process a
 * stripped PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that omits Homebrew and
 * user tool dirs. Anything we spawn in-process — including the pi MCP bridge
 * launching `uvx coplay-mcp-server` for Unity — then fails with ENOENT even
 * though it works from a terminal. Restore a sensible PATH so those tools
 * resolve. No-op on Windows, where GUI launches inherit the user PATH.
 */
export function ensurePathForGuiLaunch(): void {
  if (patched) return;
  patched = true;
  if (process.platform === "win32") return;

  const merged = new Set((process.env.PATH ?? "").split(delimiter).filter(Boolean));

  // Inherit the user's real login-shell PATH (covers nvm/asdf/custom installs).
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const out = execFileSync(shell, ["-lc", 'printf %s "$PATH"'], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const p of out.split(delimiter)) if (p) merged.add(p);
  } catch {
    /* fall back to the known dirs below */
  }

  const home = homedir();
  for (const dir of [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    `${home}/.local/bin`,
    `${home}/.cargo/bin`,
    `${home}/.bun/bin`,
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]) {
    if (existsSync(dir)) merged.add(dir);
  }

  process.env.PATH = [...merged].join(delimiter);
}
