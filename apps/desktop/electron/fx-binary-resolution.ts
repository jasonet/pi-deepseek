import { homedir } from "node:os";
import { delimiter, join, win32 as windowsPath } from "node:path";

export interface BuildFxBinaryCandidateOptions {
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly pathValue?: string;
  readonly homeDirectory?: string;
  readonly bundledRoot?: string;
  readonly binaryPath?: string;
}

export function fxExecutableName(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? "fx.exe" : "fx";
}

export function isFxHelpOutputCompatible(output: string): boolean {
  return output.includes("Start an ACP server over stdio")
    && output.includes("fx.sh/docs");
}

export function buildFxBinaryCandidatePaths(
  options: BuildFxBinaryCandidateOptions = {},
): string[] {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const joinPath = platform === "win32" ? windowsPath.join : join;
  const pathDelimiter = platform === "win32" ? ";" : delimiter;
  const binaryName = fxExecutableName(platform);
  const explicit = options.binaryPath ?? process.env.PI_FX_BINARY;
  const pathCandidates = (options.pathValue ?? process.env.PATH ?? "")
    .split(pathDelimiter)
    .filter(Boolean)
    .map((directory) => joinPath(directory, binaryName));
  const home = options.homeDirectory ?? homedir();
  const homeCandidates = [
    joinPath(home, ".fx", "bin", binaryName),
    joinPath(home, ".local", "bin", binaryName),
  ];
  const systemCandidates = [
    ...pathCandidates,
    ...homeCandidates,
    ...(platform === "win32"
      ? []
      : [`/opt/homebrew/bin/${binaryName}`, `/usr/local/bin/${binaryName}`]),
  ];
  const bundledCandidates = options.bundledRoot
    ? [joinPath(options.bundledRoot, `${platform}-${arch}`, binaryName)]
    : [];

  return [
    ...new Set([explicit, ...systemCandidates, ...bundledCandidates]),
  ].filter((candidate): candidate is string => Boolean(candidate));
}
