import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function findProjectTool(name: "yt-dlp" | "ffmpeg"): string {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const candidates =
    name === "ffmpeg"
      ? [
          path.join(sourceRoot, ".tools", "ffmpeg", "bin", exe),
          ...findNestedFfmpeg(sourceRoot, exe),
          exe
        ]
      : [path.join(sourceRoot, ".tools", exe), exe];

  return candidates.find((candidate) => candidate === exe || existsSync(candidate)) ?? exe;
}

export function ytdlpBaseArgs(): string[] {
  const args: string[] = [];
  const nodeRuntime = findNodeRuntime();
  const ffmpegPath = findProjectTool("ffmpeg");

  if (nodeRuntime) {
    args.push("--js-runtimes", `node:${nodeRuntime}`);
  }
  if (ffmpegPath !== "ffmpeg") {
    args.push("--ffmpeg-location", path.dirname(ffmpegPath));
  }

  return args;
}

export function toolEnvironment(): NodeJS.ProcessEnv {
  const ffmpegPath = findProjectTool("ffmpeg");
  const ffmpegDir = path.dirname(ffmpegPath);
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  return {
    ...process.env,
    [pathKey]: ffmpegPath === "ffmpeg" ? process.env[pathKey] : `${ffmpegDir}${path.delimiter}${process.env[pathKey] ?? ""}`
  };
}

function findNodeRuntime(): string | null {
  const exe = process.platform === "win32" ? "node.exe" : "node";
  const candidates = [
    process.env.MUSICDOWNLOADER_NODE,
    process.env.npm_node_execpath,
    process.platform === "win32" ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", exe) : undefined,
    process.platform === "win32" && process.env["ProgramFiles(x86)"]
      ? path.join(process.env["ProgramFiles(x86)"], "nodejs", exe)
      : undefined,
    exe
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => candidate === exe || existsSync(candidate)) ?? null;
}

function findNestedFfmpeg(root: string, exe: string): string[] {
  const likely = path.join(root, ".tools", "ffmpeg");
  try {
    return readdirSync(likely, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(likely, entry.name, "bin", exe));
  } catch {
    return [];
  }
}
