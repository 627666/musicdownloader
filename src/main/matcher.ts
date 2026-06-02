import { spawn } from "node:child_process";
import crypto from "node:crypto";
import type { AppSettings, KeywordSearchInput, MatchCandidate, SearchMode, TrackMetadata } from "../shared/types.js";
import { searchSpotifyCatalogTracks } from "./spotify.js";
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

interface ItunesSearchItem {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  isrc?: string;
}

interface CatalogSearchResult {
  source: "Spotify" | "Music catalog";
  tracks: TrackMetadata[];
}

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

export function scoreCandidate(
  track: TrackMetadata,
  candidate: Omit<MatchCandidate, "score" | "riskTags">,
  mode: SearchMode = "fuzzy"
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

export async function searchKeywordCandidates(input: KeywordSearchInput, settings?: AppSettings): Promise<MatchCandidate[]> {
  const track: TrackMetadata = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    artists: input.artist?.trim() ? [input.artist.trim()] : [],
    album: input.album?.trim() || undefined
  };

  if (input.mode === "fuzzy") {
    const catalog = await searchCatalogTracks(input, settings);
    if (catalog.tracks.length) {
      const catalogCandidates = await searchCatalogOrderedYoutubeCandidates(catalog);
      if (catalogCandidates.length >= 3) return catalogCandidates;

      const directCandidates = await searchTrackCandidates(track, input.mode);
      return mergeCandidates(catalogCandidates, directCandidates).slice(0, 12);
    }
  }

  return searchTrackCandidates(track, input.mode);
}

export async function searchYoutubeCandidates(track: TrackMetadata): Promise<MatchCandidate[]> {
  return searchTrackCandidates(track, "fuzzy");
}

async function searchTrackCandidates(track: TrackMetadata, mode: SearchMode): Promise<MatchCandidate[]> {
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

async function searchCatalogTracks(input: KeywordSearchInput, settings?: AppSettings): Promise<CatalogSearchResult> {
  if (settings?.spotifyClientId.trim()) {
    const tracks = await searchSpotifyCatalogTracks(input, settings).catch(() => []);
    if (tracks.length) return { source: "Spotify", tracks };
  }

  const tracks = await searchItunesCatalogTracks(input).catch(() => []);
  return { source: "Music catalog", tracks };
}

async function searchItunesCatalogTracks(input: KeywordSearchInput): Promise<TrackMetadata[]> {
  const term = [input.title, input.artist, input.album].map((part) => part?.trim()).filter(Boolean).join(" ");
  if (!term) return [];

  const countries = hasCjk(term) ? ["HK", "TW", "US"] : ["US"];
  const tracks: TrackMetadata[] = [];
  const seen = new Set<string>();

  for (const country of countries) {
    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", term);
    url.searchParams.set("entity", "song");
    url.searchParams.set("media", "music");
    url.searchParams.set("limit", "8");
    url.searchParams.set("country", country);

    const response = await fetchWithTimeout(url.toString(), 8_000);
    if (!response.ok) continue;
    const data = (await response.json()) as { results?: ItunesSearchItem[] };
    for (const item of data.results ?? []) {
      if (!item.trackName) continue;
      const artists = item.artistName ? [item.artistName] : [];
      const key = normalize(`${item.trackName} ${artists.join(" ")}`);
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push({
        id: item.trackId ? `itunes-${item.trackId}` : crypto.randomUUID(),
        title: item.trackName,
        artists,
        album: item.collectionName,
        durationMs: item.trackTimeMillis,
        artworkUrl: item.artworkUrl100?.replace("100x100", "600x600"),
        isrc: item.isrc,
        sourcePlaylist: "Music catalog search"
      });
    }
    if (tracks.length >= 8) break;
  }

  return tracks.slice(0, 8);
}

async function searchCatalogOrderedYoutubeCandidates(catalog: CatalogSearchResult): Promise<MatchCandidate[]> {
  const tracks = dedupeTracks(catalog.tracks).slice(0, 6);
  const results: Array<MatchCandidate | null> = await Promise.all(
    tracks.map(async (track) => {
      const entries = await runSearchQuery(buildCatalogYoutubeQuery(track), fallbackSearchTimeoutMs);
      const candidate = rankCandidates(track, entries, "exact")[0];
      if (!candidate) return null;
      return {
        ...candidate,
        matchedTrack: track,
        sourceLabel: `${catalog.source} order`
      };
    })
  );

  return mergeCandidates(results.filter((candidate): candidate is MatchCandidate => Boolean(candidate)), []);
}

function buildCatalogYoutubeQuery(track: TrackMetadata): string {
  const query = [track.title, ...track.artists].filter(Boolean).join(" ");
  return `ytsearch5:${query}`;
}

function dedupeTracks(tracks: TrackMetadata[]): TrackMetadata[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    const key = normalize(`${track.title} ${track.artists.join(" ")}`);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeCandidates(primary: MatchCandidate[], secondary: MatchCandidate[]): MatchCandidate[] {
  const byUrl = new Map<string, MatchCandidate>();
  for (const candidate of [...primary, ...secondary]) {
    if (!byUrl.has(candidate.url)) byUrl.set(candidate.url, candidate);
  }
  return [...byUrl.values()];
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
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

function rankCandidates(track: TrackMetadata, entries: YtdlpEntry[], mode: SearchMode): MatchCandidate[] {
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
    byUrl.set(url, { ...base, ...scoreCandidate(track, base, mode) });
  }

  return [...byUrl.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function buildSearchQueries(track: TrackMetadata, mode: SearchMode): { primary: string; fallbacks: string[] } {
  const title = track.title.trim();
  const artist = track.artists.join(" ").trim();
  const album = track.album?.trim() ?? "";
  const core = [title, artist, album].filter(Boolean).join(" ").trim();
  if (!core) return { primary: "", fallbacks: [] };

  if (hasCjk(core)) {
    const precise = [title, artist].filter(Boolean).join(" ").trim();
    return {
      primary: `ytsearch10:${mode === "exact" ? precise : core}`,
      fallbacks:
        mode === "exact"
          ? [`ytsearch5:${precise} 官方`]
          : [`ytsearch5:${precise} 官方`, `ytsearch5:${precise} 音频`, `ytsearch5:${precise} MV`]
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
