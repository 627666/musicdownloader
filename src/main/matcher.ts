import { spawn } from "node:child_process";
import crypto from "node:crypto";
import type { MatchCandidate, TrackMetadata } from "../shared/types.js";
import { findProjectTool, toolEnvironment, ytdlpBaseArgs } from "./tools.js";

interface YtdlpEntry {
  title?: string;
  uploader?: string;
  channel?: string;
  channel_is_verified?: boolean;
  webpage_url?: string;
  url?: string;
  duration?: number;
}

interface RunYtdlpOptions {
  timeoutMs?: number;
}

type MatchMode = "fuzzy" | "exact";

const searchCache = new Map<string, { expiresAt: number; candidates: MatchCandidate[] }>();
const cacheTtlMs = 10 * 60 * 1000;
const primarySearchTimeoutMs = 12_000;
const fallbackSearchTimeoutMs = 8_000;

const badSignals = [
  "live",
  "cover",
  "karaoke",
  "remix",
  "sped up",
  "slowed",
  "nightcore",
  "reaction",
  "现场",
  "翻唱",
  "伴奏",
  "卡拉",
  "混音",
  "加速",
  "降调"
];
const goodSignals = ["official audio", "official video", "official music video", "topic", "provided to youtube", "官方", "官方音频", "官方mv"];
const softBadSignals = ["lyrics", "lyric", "歌詞", "歌词", "pinyin", "日本語訳", "hi-res", "hi res", "lossless", "无损"];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function tokenScore(a: string, b: string): number {
  const left = new Set(normalize(a).split(" ").filter(Boolean));
  const right = new Set(normalize(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  const matches = [...left].filter((token) => right.has(token)).length;
  return (matches / Math.max(left.size, right.size)) * 100;
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}

function isCjkCharacter(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}

function cjkCoverage(expected: string, actual: string): number {
  const expectedChars = new Set([...expected].filter(isCjkCharacter));
  if (!expectedChars.size) return 1;
  const actualChars = new Set([...actual].filter(isCjkCharacter));
  const matches = [...expectedChars].filter((char) => actualChars.has(char)).length;
  return matches / expectedChars.size;
}

function hasCjkNumeral(value: string): boolean {
  return /[〇零一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾]/u.test(value);
}

function hasAsciiDigit(value: string): boolean {
  return /\d/.test(value);
}

export function scoreCandidate(
  track: TrackMetadata,
  candidate: Omit<MatchCandidate, "score" | "riskTags">,
  mode: MatchMode = "fuzzy"
): Pick<MatchCandidate, "score" | "riskTags"> {
  const queryTitle = `${track.title} ${track.artists.join(" ")} ${track.album ?? ""}`;
  const candidateTitle = `${candidate.title} ${candidate.uploader ?? ""}`;
  const normalized = normalize(candidateTitle);
  const normalizedTitle = normalize(track.title);
  const risks: string[] = [];
  let score = tokenScore(queryTitle, candidateTitle) * 0.7;

  if (track.durationMs && candidate.durationMs) {
    const diffSeconds = Math.abs(track.durationMs - candidate.durationMs) / 1000;
    score += Math.max(0, 20 - diffSeconds * 1.4);
    if (diffSeconds > 18) risks.push("duration mismatch");
  }

  if (normalizedTitle && normalized.includes(normalizedTitle)) {
    score += track.artists.length ? 18 : 38;
    if (hasCjk(track.title)) score += 12;
    if (candidate.isVerified) score += 14;
  } else if (mode === "exact") {
    score -= 25;
    risks.push("title mismatch");
  }

  for (const artist of track.artists) {
    const normalizedArtist = normalize(artist);
    if (normalizedArtist && normalized.includes(normalizedArtist)) {
      score += 8;
    } else if (mode === "exact") {
      score -= 8;
    }
  }

  if (hasCjk(track.title)) {
    const titleCoverage = cjkCoverage(track.title, candidate.title);
    const candidateHasCjk = hasCjk(candidateTitle);
    if (!candidateHasCjk) {
      score -= 30;
      risks.push("language mismatch");
    }

    if (titleCoverage >= 0.75) {
      score += 18;
    } else if (titleCoverage >= 0.45) {
      score += 8;
    } else {
      score -= 34;
      risks.push("title mismatch");
    }

    if (hasCjkNumeral(track.title) && hasAsciiDigit(candidate.title) && titleCoverage < 0.5) {
      score -= 18;
      risks.push("numeric title mismatch");
    }

    for (const artist of track.artists.filter(hasCjk)) {
      const artistCoverage = cjkCoverage(artist, candidateTitle);
      if (artistCoverage >= 0.5) score += 8;
      else if (mode === "exact") score -= 6;
    }
  }

  if (track.album && normalize(track.album) && normalized.includes(normalize(track.album))) score += 5;
  if (candidate.isVerified) score += 4;

  for (const signal of goodSignals) {
    if (normalized.includes(signal)) score += signal === "official music video" ? 10 : 5;
  }
  for (const signal of badSignals) {
    if (normalized.includes(signal)) {
      score -= 12;
      risks.push(signal);
    }
  }
  for (const signal of softBadSignals) {
    if (normalized.includes(signal)) {
      score -= 7;
      risks.push(signal);
    }
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    riskTags: [...new Set(risks)]
  };
}

export async function searchYoutubeCandidates(track: TrackMetadata): Promise<MatchCandidate[]> {
  return searchTrackCandidates(track, "fuzzy");
}

async function searchTrackCandidates(track: TrackMetadata, mode: MatchMode): Promise<MatchCandidate[]> {
  const cacheKey = JSON.stringify({ title: track.title, artists: track.artists, album: track.album, mode });
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.candidates;

  const queries = buildSearchQueries(track, mode);
  if (!queries.primary) return [];

  const entries = await runSearchQuery(queries.primary, primarySearchTimeoutMs);
  if (entries.length < 5 && queries.fallbacks.length) {
    const fallbackResults = await Promise.allSettled(queries.fallbacks.map((query) => runSearchQuery(query, fallbackSearchTimeoutMs)));
    for (const result of fallbackResults) {
      if (result.status === "fulfilled") entries.push(...result.value);
    }
  }

  const candidates = rankCandidates(track, entries, mode);
  searchCache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, candidates });
  return candidates;
}

async function runSearchQuery(query: string, timeoutMs: number): Promise<YtdlpEntry[]> {
  try {
    const output = await runYtdlp(["--flat-playlist", "--dump-json", "--skip-download", "--ignore-errors", "--no-playlist", query], undefined, {
      timeoutMs
    });
    return parseYtdlpJsonLines(output);
  } catch {
    return [];
  }
}

function rankCandidates(track: TrackMetadata, entries: YtdlpEntry[], mode: MatchMode): MatchCandidate[] {
  const byUrl = new Map<string, MatchCandidate>();

  for (const entry of entries) {
    const url = entry.webpage_url ?? entry.url ?? "";
    if (!url || byUrl.has(url)) continue;

    const base = {
      id: crypto.randomUUID(),
      title: entry.title ?? "Untitled result",
      uploader: entry.uploader ?? entry.channel,
      durationMs: entry.duration ? entry.duration * 1000 : undefined,
      url,
      isVerified: Boolean(entry.channel_is_verified),
      sourceType: "youtube" as const,
      sourceLabel: "YouTube",
      matchedTrack: track
    };
    const candidate = { ...base, ...scoreCandidate(track, base, mode) };
    if (shouldRejectCandidate(track, candidate, mode)) continue;
    byUrl.set(url, candidate);
  }

  return [...byUrl.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function shouldRejectCandidate(track: TrackMetadata, candidate: MatchCandidate, mode: MatchMode): boolean {
  if (hasCjk(track.title) && candidate.score < 35 && candidate.riskTags.includes("language mismatch")) return true;
  if (hasCjk(track.title) && candidate.score < 30 && candidate.riskTags.includes("title mismatch")) return true;
  if (mode === "exact" && candidate.score < 18) return true;
  return false;
}

function buildSearchQueries(track: TrackMetadata, mode: MatchMode): { primary: string; fallbacks: string[] } {
  const title = track.title.trim();
  const artist = track.artists.join(" ").trim();
  const album = track.album?.trim() ?? "";
  const core = [title, artist, album].filter(Boolean).join(" ").trim();
  if (!core) return { primary: "", fallbacks: [] };

  if (hasCjk(core)) {
    const precise = [title, artist].filter(Boolean).join(" ").trim();
    const normalizedTitle = normalize(title);
    const titleAndArtist = [normalizedTitle, artist].filter(Boolean).join(" ").trim();
    const primaryTerm = mode === "exact" ? precise : titleAndArtist || precise || core;
    const fallbackTerms = [...new Set([precise, titleAndArtist].filter(Boolean))];
    return {
      primary: `ytsearch10:${primaryTerm}`,
      fallbacks:
        mode === "exact"
          ? fallbackTerms.map((term) => `ytsearch5:${term} 官方`)
          : [
              ...fallbackTerms.map((term) => `ytsearch5:${term}`),
              ...fallbackTerms.flatMap((term) => [`ytsearch5:${term} 官方`, `ytsearch5:${term} 音频`, `ytsearch5:${term} MV`])
            ]
    };
  }

  const precise = [title, artist].filter(Boolean).join(" ").trim();
  return {
    primary: `ytsearch10:${mode === "exact" ? precise : `${core} official audio`}`,
    fallbacks: mode === "exact" ? [`ytsearch5:${precise} topic`] : [`ytsearch5:${precise}`, `ytsearch5:${precise} topic`]
  };
}

function parseYtdlpJsonLines(output: string): YtdlpEntry[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => {
      try {
        return JSON.parse(entry) as YtdlpEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is YtdlpEntry => Boolean(entry));
}

export function runYtdlp(args: string[], onStdout?: (chunk: string) => void, options: RunYtdlpOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(findProjectTool("yt-dlp"), [...ytdlpBaseArgs(), ...args], { windowsHide: true, env: toolEnvironment() });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          if (finished) return;
          finished = true;
          child.kill();
          reject(new Error("yt-dlp timed out."));
        }, options.timeoutMs)
      : null;

    child.stdout.on("data", (buffer: Buffer) => {
      const chunk = buffer.toString();
      stdout += chunk;
      onStdout?.(chunk);
    });
    child.stderr.on("data", (buffer: Buffer) => {
      stderr += buffer.toString();
    });
    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      reject(new Error(`yt-dlp is not available: ${error.message}`));
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(cleanYtdlpError(stderr) || `yt-dlp exited with code ${code}`));
    });
  });
}

export function cleanYtdlpError(stderr: string): string {
  const cleaned = stderr
    .split(/\r?\n/)
    .filter((line) => !line.includes("No supported JavaScript runtime could be found"))
    .filter((line) => !line.includes("YouTube extraction without a JS runtime has been deprecated"))
    .join("\n")
    .trim();
  return cleaned || stderr.trim();
}
