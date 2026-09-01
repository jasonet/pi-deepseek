import { copyFile, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { FilePreviewResult } from "../src/ipc";

const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_MEDIA_BYTES = 12 * 1024 * 1024;
const EXECUTABLE_EXTENSIONS = new Set(["app", "bin", "com", "dll", "dylib", "exe", "msi", "out", "so"]);
const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  bash: "bash",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  mjs: "javascript",
  mts: "typescript",
  py: "python",
  sh: "bash",
  ts: "typescript",
  tsx: "typescript",
  zsh: "bash",
};
const CODE_EXTENSIONS = new Set([
  "c", "cc", "cpp", "css", "go", "h", "hpp", "html", "java", "js", "jsx", "json", "mjs", "mts", "py",
  "rb", "rs", "sh", "sql", "ts", "tsx", "xml", "yaml", "yml", "zsh",
]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd"]);

export async function previewWorkspaceFile(workspacePath: string, requestedPath: string): Promise<FilePreviewResult> {
  try {
    const resolvedPath = await resolveWorkspaceFile(workspacePath, requestedPath);
    const fileStats = await stat(resolvedPath);
    const name = path.basename(resolvedPath);
    const extension = path.extname(name).slice(1).toLowerCase();

    if (!fileStats.isFile()) {
      return unsupportedResult(resolvedPath, name, fileStats.size, "Only files can be previewed.");
    }
    if ((fileStats.mode & 0o111) !== 0 || EXECUTABLE_EXTENSIONS.has(extension)) {
      return unsupportedResult(resolvedPath, name, fileStats.size, "Executable files are not previewed.");
    }

    const imageMimeType = IMAGE_MIME_TYPES[extension];
    if (imageMimeType || extension === "pdf") {
      if (fileStats.size > MAX_MEDIA_BYTES) {
        return unsupportedResult(resolvedPath, name, fileStats.size, "This file is too large to preview.");
      }
      const buffer = await readFile(resolvedPath);
      const mimeType = imageMimeType ?? "application/pdf";
      return {
        ok: true,
        kind: extension === "pdf" ? "pdf" : "image",
        path: resolvedPath,
        name,
        sizeBytes: fileStats.size,
        dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
      };
    }

    if (fileStats.size > MAX_TEXT_BYTES) {
      return unsupportedResult(resolvedPath, name, fileStats.size, "This file is too large to preview.");
    }
    const buffer = await readFile(resolvedPath);
    if (buffer.includes(0)) {
      return unsupportedResult(resolvedPath, name, fileStats.size, "This binary file cannot be previewed.");
    }
    const content = buffer.toString("utf8");
    const language = LANGUAGE_BY_EXTENSION[extension];
    return {
      ok: true,
      kind: MARKDOWN_EXTENSIONS.has(extension) ? "markdown" : CODE_EXTENSIONS.has(extension) ? "code" : "text",
      path: resolvedPath,
      name,
      sizeBytes: fileStats.size,
      content,
      language,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      kind: "unsupported",
      path: requestedPath,
      name: path.basename(requestedPath),
      sizeBytes: 0,
      message: message.includes("outside workspace") ? message : "The file is no longer available in this workspace.",
    };
  }
}

export async function saveWorkspaceFileAs(
  workspacePath: string,
  requestedPath: string,
  destinationPath: string,
): Promise<void> {
  const sourcePath = await resolveWorkspaceFile(workspacePath, requestedPath);
  const fileStats = await stat(sourcePath);
  const extension = path.extname(sourcePath).slice(1).toLowerCase();
  if (!fileStats.isFile() || (fileStats.mode & 0o111) !== 0 || EXECUTABLE_EXTENSIONS.has(extension)) {
    throw new Error("Executable files cannot be saved from the preview.");
  }
  await copyFile(sourcePath, destinationPath);
}

async function resolveWorkspaceFile(workspacePath: string, requestedPath: string): Promise<string> {
  const root = await realpath(workspacePath);
  const normalizedRequest = normalizeRequestedPath(requestedPath);
  const candidate = path.isAbsolute(normalizedRequest)
    ? normalizedRequest
    : path.resolve(root, normalizedRequest);
  const resolved = await realpath(candidate);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Requested file is outside workspace");
  }
  return resolved;
}

function normalizeRequestedPath(requestedPath: string): string {
  if (requestedPath.startsWith("file://")) {
    const url = new URL(requestedPath);
    if (url.hostname && url.hostname !== "localhost") {
      throw new Error("Unsupported file URL");
    }
    return stripLinkSuffix(decodeURIComponent(url.pathname));
  }
  if (requestedPath.startsWith("sandbox:")) {
    return stripLinkSuffix(decodeURIComponent(requestedPath.slice("sandbox:".length).replace(/^\/\//, "")));
  }
  return stripLinkSuffix(requestedPath);
}

function stripLinkSuffix(filePath: string): string {
  return filePath.replace(/[?#].*$/, "");
}

function unsupportedResult(filePath: string, name: string, sizeBytes: number, message: string): FilePreviewResult {
  return { ok: false, kind: "unsupported", path: filePath, name, sizeBytes, message };
}
