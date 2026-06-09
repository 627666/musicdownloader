import { app, shell } from "electron";
import crypto from "node:crypto";
import https from "node:https";
import http from "node:http";
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import type {
  AppSettings,
  ImportPlaylistResult,
  LibraryImportResult,
  SpotifyAuthStatus,
  SpotifyCollectionType,
  TrackMetadata
} from "../shared/types.js";

const redirectUri = "http://127.0.0.1:43879/spotify/callback";
const authScopes = ["playlist-read-private", "playlist-read-collaborative", "user-read-private"];
const authFile = () => path.join(app.getPath("userData"), "spotify-auth.json");
const bundledSpotifyClientId = process.env.MUSICDOWNLOADER_SPOTIFY_CLIENT_ID?.trim() ?? "";

function spotifyClientId(settings: AppSettings): string {
  return bundledSpotifyClientId || settings.spotifyClientId.trim();
}

interface SpotifyAuthStore {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  displayName?: string;
}

interface SpotifyTrackItem {
  track?: SpotifyApiTrack;
}

interface SpotifyApiTrack {
  id?: string;
  name?: string;
  duration_ms?: number;
  external_ids?: { isrc?: string };
  artists?: Array<{ name?: string }>;
  album?: {
    name?: string;
    images?: Array<{ url?: string }>;
  };
}

interface SpotifyAlbum {
  id?: string;
  name?: string;
  images?: Array<{ url: string }>;
  release_date?: string;
  artists?: Array<{ name: string }>;
  tracks?: { items?: SpotifyAlbumTrack[]; next?: string };
}

interface SpotifyAlbumTrack {
  id?: string;
  name?: string;
  duration_ms?: number;
  artists?: Array<{ name: string }>;
}

interface SpotifyArtist {
  id?: string;
  name?: string;
  images?: Array<{ url?: string }>;
}

interface SpotifyEmbedEntity {
  type?: string;
  id?: string;
  uri?: string;
  name?: string;
  title?: string;
  subtitle?: string;
  trackList?: SpotifyEmbedTrack[];
  visualIdentity?: {
    image?: Array<{ url?: string; maxWidth?: number; maxHeight?: number }>;
  };
}

interface SpotifyEmbedTrack {
  uri?: string;
  uid?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  isPlayable?: boolean;
  playabilityReason?: string;
  entityType?: string;
}

interface PublicImportAttempt {
  url: string;
  ok: boolean;
  length?: number;
  tracks?: number;
  error?: string;
}

interface PublicImportResult {
  result: ImportPlaylistResult | null;
  attempts: PublicImportAttempt[];
}

interface TextResponse {
  text: string;
  headers: Record<string, string | string[] | undefined>;
  statusCode: number;
  url: string;
}

interface SpotisaverApiTrack {
  id?: string;
  name?: string;
  artists?: string[] | string;
  album?: string;
  duration_ms?: number;
  external_url?: string;
  thumb_image?: string | { url?: string };
  image?: string | { url?: string };
}

interface SpotisaverApiResponse {
  error?: string;
  total?: number;
  total_tracks?: number;
  track_count?: number;
  playlist_info?: {
    id?: string;
    name?: string;
    type?: SpotifyCollectionType;
    images?: Array<{ url?: string }> | string[];
    external_url?: string;
    total?: number;
    total_tracks?: number;
    totalTracks?: number;
    track_count?: number;
    trackCount?: number;
    from_source?: string;
    premium_loaded?: boolean;
  };
  tracks?: SpotisaverApiTrack[];
}

class IncompletePublicTrackListError extends Error {}

export function parseSpotifyCollectionLink(input: string): { type: SpotifyCollectionType; id: string } {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album|track|artist)\/([a-zA-Z0-9]+)/i);
  if (urlMatch) return { type: urlMatch[1] as SpotifyCollectionType, id: urlMatch[2] };
  const legacyPlaylistMatch = trimmed.match(/open\.spotify\.com\/user\/[^/]+\/playlist\/([a-zA-Z0-9]+)/i);
  if (legacyPlaylistMatch) return { type: "playlist", id: legacyPlaylistMatch[1] };
  const uriMatch = trimmed.match(/spotify:(playlist|album|track|artist):([a-zA-Z0-9]+)/i);
  if (uriMatch) return { type: uriMatch[1] as SpotifyCollectionType, id: uriMatch[2] };
  return { type: "playlist", id: trimmed.split("?")[0] };
}

export async function getSpotifyAuthStatus(settings: AppSettings): Promise<SpotifyAuthStatus> {
  const needsClientId = !spotifyClientId(settings);
  if (needsClientId) return { connected: false, needsClientId: true };

  const auth = await readAuth();
  return {
    connected: Boolean(auth?.accessToken || auth?.refreshToken),
    needsClientId: false,
    displayName: auth?.displayName,
    expiresAt: auth?.expiresAt
  };
}

export async function startSpotifyLogin(settings: AppSettings): Promise<SpotifyAuthStatus> {
  const clientId = spotifyClientId(settings);
  if (!clientId) {
    throw new Error("Spotify login is not configured for this build.");
  }

  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64Url(crypto.randomBytes(24));
  const callback = waitForCallback(state);

  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", authScopes.join(" "));

  await shell.openExternal(url.toString());
  const code = await callback;
  const auth = await exchangeCode(clientId, code, verifier);
  const displayName = await getProfileName(auth.accessToken).catch(() => undefined);
  await writeAuth({ ...auth, displayName });
  return getSpotifyAuthStatus(settings);
}

export async function disconnectSpotify(settings: AppSettings): Promise<SpotifyAuthStatus> {
  await rm(authFile(), { force: true });
  return getSpotifyAuthStatus(settings);
}

export async function importLibraryLink(input: string, settings: AppSettings): Promise<LibraryImportResult> {
  const collection = parseSpotifyCollectionLink(input);
  let apiError: unknown;

  if (spotifyClientId(settings)) {
    try {
      return await importSpotifyCollectionFromApi(collection, settings);
    } catch (error) {
      apiError = error;
    }
  }

  const publicImport = await importPublicSpotifyCollection(collection);
  if (publicImport.result?.tracks.length && !isLikelyCappedPublicResult(publicImport.result, collection)) {
    return { ...publicImport.result, source: "spotify", collectionType: collection.type };
  }

  try {
    if (apiError) throw apiError;
    return await importSpotifyCollectionFromApi(collection, settings);
  } catch (error) {
    if (!spotifyClientId(settings)) {
      const title = await getPublicEmbedTitle(input).catch(() => undefined);
      const label = title ? `: ${title}` : "";
      const diagnostics = summarizePublicImportAttempts(publicImport.attempts);
      if (publicImport.result?.tracks.length && isLikelyCappedPublicResult(publicImport.result, collection)) {
        throw new Error(
          `已识别 Spotify ${collection.type}${label}，但公开元数据源只返回了 ${publicImport.result.tracks.length} 首，疑似被截断。完整导入需要可用的 Spotify API 连接。`
        );
      }
      throw new Error(
        `已识别 Spotify ${collection.type}${label}，但应用无法读取公开曲目列表。${diagnostics}`
      );
    }
    throw error;
  }
}

async function importSpotifyCollectionFromApi(
  collection: { type: SpotifyCollectionType; id: string },
  settings: AppSettings
): Promise<LibraryImportResult> {
  if (collection.type === "album") {
    const result = await importSpotifyAlbumFromApi(collection.id, settings);
    return { ...result, source: "spotify", collectionType: "album" };
  }
  if (collection.type === "track") {
    const result = await importSpotifyTrackFromApi(collection.id, settings);
    return { ...result, source: "spotify", collectionType: "track" };
  }
  if (collection.type === "artist") {
    const result = await importSpotifyArtistFromApi(collection.id, settings);
    return { ...result, source: "spotify", collectionType: "artist" };
  }

  const result = await importSpotifyPlaylistFromApi(collection.id, settings);
  return { ...result, source: "spotify", collectionType: "playlist" };
}

export async function importSpotifyPlaylist(input: string, settings: AppSettings): Promise<ImportPlaylistResult> {
  const playlistId = parseSpotifyCollectionLink(input).id;
  if (!playlistId) throw new Error("Please enter a Spotify playlist link or ID.");
  const publicImport = await importPublicSpotifyCollection({ type: "playlist", id: playlistId });
  if (publicImport.result?.tracks.length && !isLikelyCappedPublicResult(publicImport.result, { type: "playlist", id: playlistId })) {
    return publicImport.result;
  }

  return importSpotifyPlaylistFromApi(playlistId, settings);
}

export async function importSpotifyAlbum(input: string, settings: AppSettings): Promise<ImportPlaylistResult> {
  const albumId = parseSpotifyCollectionLink(input).id;
  if (!albumId) throw new Error("Please enter a Spotify album link or ID.");
  const publicImport = await importPublicSpotifyCollection({ type: "album", id: albumId });
  if (publicImport.result?.tracks.length && !isLikelyCappedPublicResult(publicImport.result, { type: "album", id: albumId })) {
    return publicImport.result;
  }

  return importSpotifyAlbumFromApi(albumId, settings);
}

function isLikelyCappedPublicResult(result: ImportPlaylistResult, collection: { type: SpotifyCollectionType; id: string }): boolean {
  if (collection.type === "track") return false;
  if (result.reportedTotal && result.tracks.length < result.reportedTotal) return true;
  return result.tracks.length >= 100;
}

async function importSpotifyPlaylistFromApi(playlistId: string, settings: AppSettings): Promise<ImportPlaylistResult> {
  const token = await getValidAccessToken(settings);
  const playlistResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!playlistResponse.ok) {
    throw new Error(`Spotify playlist import failed: ${playlistResponse.status}`);
  }

  const playlist = (await playlistResponse.json()) as {
    name?: string;
    tracks?: { items?: SpotifyTrackItem[]; next?: string };
  };

  let items = playlist.tracks?.items ?? [];
  let next = playlist.tracks?.next;
  while (next) {
    const pageResponse = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
    if (!pageResponse.ok) throw new Error(`Spotify page import failed: ${pageResponse.status}`);
    const page = (await pageResponse.json()) as { items?: SpotifyTrackItem[]; next?: string };
    items = items.concat(page.items ?? []);
    next = page.next;
  }

  const tracks: TrackMetadata[] = items.reduce<TrackMetadata[]>((acc, item, index) => {
    const track = item.track;
    if (!track?.name) return acc;
    const artists = track.artists?.map((artist) => artist.name).filter((name): name is string => Boolean(name)) ?? [];
    acc.push({
      id: track.id ?? `${playlistId}-${index}`,
      title: track.name,
      artists,
      album: track.album?.name,
      durationMs: track.duration_ms,
      artworkUrl: track.album?.images?.[0]?.url,
      isrc: track.external_ids?.isrc,
      sourcePlaylist: playlist.name ?? playlistId
    });
    return acc;
  }, []);

  return {
    playlistName: playlist.name ?? playlistId,
    tracks
  };
}

async function importSpotifyAlbumFromApi(albumId: string, settings: AppSettings): Promise<ImportPlaylistResult> {
  const token = await getValidAccessToken(settings, "album");
  const albumResponse = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!albumResponse.ok) {
    throw new Error(`Spotify album import failed: ${albumResponse.status}`);
  }

  const album = (await albumResponse.json()) as SpotifyAlbum;
  let items = album.tracks?.items ?? [];
  let next = album.tracks?.next;

  while (next) {
    const pageResponse = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
    if (!pageResponse.ok) throw new Error(`Spotify album page import failed: ${pageResponse.status}`);
    const page = (await pageResponse.json()) as { items?: SpotifyAlbumTrack[]; next?: string };
    items = items.concat(page.items ?? []);
    next = page.next;
  }

  const albumArtists = album.artists?.map((artist) => artist.name).filter(Boolean) ?? [];
  const artworkUrl = album.images?.[0]?.url;
  const tracks: TrackMetadata[] = items.reduce<TrackMetadata[]>((acc, track, index) => {
    if (!track.name) return acc;
    const artists = track.artists?.map((artist) => artist.name).filter(Boolean) ?? albumArtists;
    acc.push({
      id: track.id ?? `${albumId}-${index}`,
      title: track.name,
      artists,
      album: album.name,
      durationMs: track.duration_ms,
      artworkUrl,
      sourcePlaylist: album.name ?? albumId
    });
    return acc;
  }, []);

  return {
    playlistName: album.name ?? albumId,
    tracks
  };
}

async function importSpotifyTrackFromApi(trackId: string, settings: AppSettings): Promise<ImportPlaylistResult> {
  const token = await getValidAccessToken(settings, "track");
  const trackResponse = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!trackResponse.ok) {
    throw new Error(`Spotify track import failed: ${trackResponse.status}`);
  }

  const track = (await trackResponse.json()) as SpotifyApiTrack;
  const parsed = spotifyApiTrackToMetadata(track, "Spotify track", trackId, 0);
  if (!parsed) throw new Error("Spotify track did not include a readable title.");

  return {
    playlistName: parsed.title,
    tracks: [parsed]
  };
}

async function importSpotifyArtistFromApi(artistId: string, settings: AppSettings): Promise<ImportPlaylistResult> {
  const token = await getValidAccessToken(settings, "artist");
  const [artistResponse, topTracksResponse] = await Promise.all([
    fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`, {
      headers: { Authorization: `Bearer ${token}` }
    })
  ]);

  if (!artistResponse.ok) throw new Error(`Spotify artist import failed: ${artistResponse.status}`);
  if (!topTracksResponse.ok) throw new Error(`Spotify artist tracks import failed: ${topTracksResponse.status}`);

  const artist = (await artistResponse.json()) as SpotifyArtist;
  const topTracks = (await topTracksResponse.json()) as { tracks?: SpotifyApiTrack[] };
  const sourcePlaylist = `${artist.name ?? artistId} top tracks`;
  const tracks = (topTracks.tracks ?? []).reduce<TrackMetadata[]>((acc, track, index) => {
    const parsed = spotifyApiTrackToMetadata(track, sourcePlaylist, `${artistId}-${index}`, index);
    if (parsed) acc.push(parsed);
    return acc;
  }, []);

  return {
    playlistName: sourcePlaylist,
    tracks
  };
}

function spotifyApiTrackToMetadata(track: SpotifyApiTrack, sourcePlaylist: string, fallbackId: string, index: number): TrackMetadata | null {
  if (!track.name) return null;
  return {
    id: track.id ?? `${fallbackId}-${index}`,
    title: track.name,
    artists: track.artists?.map((artist) => artist.name).filter((name): name is string => Boolean(name)) ?? [],
    album: track.album?.name,
    durationMs: track.duration_ms,
    artworkUrl: track.album?.images?.[0]?.url,
    isrc: track.external_ids?.isrc,
    sourcePlaylist
  };
}

async function importPublicSpotifyTrack(collection: { type: SpotifyCollectionType; id: string }): Promise<PublicImportResult> {
  const url = `https://open.spotify.com/track/${collection.id}`;
  try {
    const title = await getPublicEmbedTitle(url);
    if (!title) throw new Error("public track title was not available");
    const parsed = parsePublicTrackTitle(title);
    return {
      result: {
        playlistName: parsed.title,
        tracks: [
          {
            id: collection.id,
            title: parsed.title,
            artists: parsed.artists,
            sourcePlaylist: "Spotify track"
          }
        ]
      },
      attempts: [{ url: "https://open.spotify.com/oembed", ok: true, tracks: 1 }]
    };
  } catch (error) {
    return {
      result: null,
      attempts: [{ url: "https://open.spotify.com/oembed", ok: false, error: error instanceof Error ? error.message : String(error) }]
    };
  }
}

function parsePublicTrackTitle(value: string): { title: string; artists: string[] } {
  const cleaned = value.replace(/\s*\|\s*Spotify\s*$/i, "").trim();
  const [titlePart, artistPart] = cleaned.split(/\s+(?:song and lyrics by|song by)\s+/i);
  if (titlePart && artistPart) return { title: titlePart.trim(), artists: artistsFromSubtitle(artistPart) };
  const dashParts = cleaned.split(/\s+-\s+/);
  if (dashParts.length >= 2) return { title: dashParts[0].trim(), artists: artistsFromSubtitle(dashParts.slice(1).join(" - ")) };
  return { title: cleaned || value, artists: [] };
}

async function importPublicSpotifyCollection(collection: { type: SpotifyCollectionType; id: string }): Promise<PublicImportResult> {
  const attempts: PublicImportAttempt[] = [];
  if (!collection.id) return { result: null, attempts: [{ url: "spotify-link", ok: false, error: "missing id" }] };
  if (collection.type === "artist") {
    return { result: null, attempts: [{ url: "spotify-public-page", ok: false, error: "artist links require Spotify login" }] };
  }
  if (collection.type === "track") {
    return importPublicSpotifyTrack(collection);
  }

  try {
    const parsed = await fetchSpotisaverApiCollection(collection);
    attempts.push({ url: "https://spotisaver.net/api/get_playlist.php", ok: true, tracks: parsed.tracks.length });
    if (parsed.tracks.length) return { result: parsed, attempts };
  } catch (error) {
    attempts.push({
      url: "https://spotisaver.net/api/get_playlist.php",
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
    if (error instanceof IncompletePublicTrackListError) return { result: null, attempts };
  }

  const pageResults = await Promise.allSettled(
    spotifyPublicPageUrls(collection).map(async (page) => {
      const html = await fetchSpotifyPublicPage(page.url);
      const parsed = page.parser(html, collection);
      return { parsed, attempt: { url: page.url, ok: true, length: html.length, tracks: parsed.tracks.length } satisfies PublicImportAttempt };
    })
  );

  for (const result of pageResults) {
    if (result.status === "fulfilled") {
      attempts.push(result.value.attempt);
      if (result.value.parsed.tracks.length) return { result: result.value.parsed, attempts };
    } else {
      attempts.push({ url: "spotify-public-page", ok: false, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
    }
  }

  return { result: null, attempts };
}

function spotifyPublicPageUrls(collection: { type: SpotifyCollectionType; id: string }): Array<{
  url: string;
  parser: (html: string, collection: { type: SpotifyCollectionType; id: string }) => ImportPlaylistResult;
}> {
  return [
    {
      url: `https://open.spotify.com/embed/${collection.type}/${collection.id}?utm_source=generator`,
      parser: parseSpotifyEmbedHtml
    },
    {
      url: `https://open.spotify.com/embed/${collection.type}/${collection.id}?utm_source=oembed`,
      parser: parseSpotifyEmbedHtml
    },
    {
      url: `https://open.spotify.com/embed/${collection.type}/${collection.id}`,
      parser: parseSpotifyEmbedHtml
    },
    {
      url: `https://open.spotify.com/${collection.type}/${collection.id}`,
      parser: parseSpotifyEmbedHtml
    }
  ];
}

async function fetchSpotisaverApiCollection(collection: { type: SpotifyCollectionType; id: string }): Promise<ImportPlaylistResult> {
  const pageUrl = `https://spotisaver.net/en/${collection.type}/${collection.id}/`;
  const pageResponse = await fetchTextWithHttpsResponse(pageUrl);
  const cookie = cookieHeaderFromResponse(pageResponse);
  const context = base64Url(Buffer.from(JSON.stringify({ id: collection.id, type: collection.type, lang: "en" }), "utf8"));
  const signatureUrl = `https://spotisaver.net/api/get_signature.php?action=get_playlist&ctx=${encodeURIComponent(context)}`;
  const commonHeaders = {
    Accept: "application/json",
    Referer: pageUrl,
    "X-Requested-With": "XMLHttpRequest",
    ...(cookie ? { Cookie: cookie } : {})
  };
  const signatureResponse = await fetchTextWithHttpsResponse(signatureUrl, commonHeaders);
  const signatureCookie = cookieHeaderFromResponse(signatureResponse);
  const apiCookie = [cookie, signatureCookie].filter(Boolean).join("; ");
  const signature = JSON.parse(signatureResponse.text) as { success?: boolean; token?: string; exp?: string | number };
  if (!signature.success || !signature.token || !signature.exp) throw new Error("metadata signature failed");

  const apiUrl = `https://spotisaver.net/api/get_playlist.php?id=${encodeURIComponent(collection.id)}&type=${encodeURIComponent(
    collection.type
  )}&lang=en`;
  const apiResponse = await fetchTextWithHttpsResponse(apiUrl, {
    ...commonHeaders,
    ...(apiCookie ? { Cookie: apiCookie } : {}),
    "X-PT": String(signature.token),
    "X-PE": String(signature.exp)
  });
  const data = JSON.parse(apiResponse.text) as SpotisaverApiResponse;
  if (data.error) throw new Error(`metadata api failed: ${data.error}`);
  return importFromSpotisaverApi(data, collection);
}

function importFromSpotisaverApi(data: SpotisaverApiResponse, collection: { type: SpotifyCollectionType; id: string }): ImportPlaylistResult {
  const playlistName = data.playlist_info?.name?.trim() || collection.id;
  const playlistArtwork = firstImageUrl(data.playlist_info?.images);
  const tracks = (data.tracks ?? []).reduce<TrackMetadata[]>((acc, track, index) => {
    const title = track.name?.trim();
    if (!title) return acc;
    const artists = Array.isArray(track.artists)
      ? track.artists.map((artist) => String(artist).trim()).filter(Boolean)
      : track.artists
        ? [track.artists.trim()]
        : [];
    const artworkUrl = imageValue(track.image) ?? imageValue(track.thumb_image) ?? playlistArtwork;
    acc.push({
      id: track.id ?? parseTrackIdFromUrl(track.external_url) ?? `${collection.id}-${index}`,
      title,
      artists,
      album: collection.type === "album" ? playlistName : track.album,
      durationMs: Number.isFinite(track.duration_ms) ? track.duration_ms : undefined,
      artworkUrl,
      sourcePlaylist: playlistName
    });
    return acc;
  }, []);

  const reportedTotal = spotisaverReportedTrackTotal(data);
  if (reportedTotal && tracks.length > 0 && tracks.length < reportedTotal) {
    throw new IncompletePublicTrackListError(
      `public metadata returned ${tracks.length}/${reportedTotal} tracks; connect Spotify in Settings to import the complete ${collection.type}`
    );
  }
  if (collection.type !== "track" && tracks.length >= 100 && data.playlist_info?.premium_loaded === false) {
    throw new IncompletePublicTrackListError(
      `public metadata returned ${tracks.length} tracks from a capped source; connect Spotify in Settings to import the complete ${collection.type}`
    );
  }
  if (!reportedTotal && collection.type !== "track" && tracks.length >= 100) {
    throw new IncompletePublicTrackListError(
      `public metadata returned ${tracks.length} tracks and may be capped; connect Spotify in Settings to import the complete ${collection.type}`
    );
  }

  return { playlistName, tracks, reportedTotal };
}

function spotisaverReportedTrackTotal(data: SpotisaverApiResponse): number | undefined {
  const candidates = [
    data.total_tracks,
    data.track_count,
    data.total,
    data.playlist_info?.total_tracks,
    data.playlist_info?.totalTracks,
    data.playlist_info?.track_count,
    data.playlist_info?.trackCount,
    data.playlist_info?.total
  ];
  for (const value of candidates) {
    const total = Number(value);
    if (Number.isFinite(total) && total > 0) return total;
  }
  return undefined;
}

async function fetchSpotifyPublicPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`public page failed: ${response.status}`);
    const text = await response.text();
    if (text.length > 500) return text;
    throw new Error(`public page too small: ${text.length}`);
  } catch (error) {
    return fetchTextWithHttps(url, 2, 6_000).catch(() => {
      throw error;
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function parseSpotifyEmbedHtml(
  html: string,
  collection: { type: SpotifyCollectionType; id: string }
): ImportPlaylistResult {
  const entity = extractNextDataEntity(html);
  if (entity?.trackList?.length) {
    const parsed = importFromEmbedEntity(entity, collection);
    if (parsed.tracks.length) return parsed;
  }

  return importFromTrackListRows(html, collection);
}

function extractNextDataEntity(html: string): SpotifyEmbedEntity | null {
  const match = html.match(/<script\b(?=[^>]*id="__NEXT_DATA__")(?=[^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]) as unknown;
    return findSpotifyEmbedEntity(data);
  } catch {
    return null;
  }
}

function findSpotifyEmbedEntity(value: unknown, depth = 0): SpotifyEmbedEntity | null {
  if (!value || typeof value !== "object" || depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSpotifyEmbedEntity(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const object = value as Record<string, unknown>;
  if (Array.isArray(object.trackList)) return object as SpotifyEmbedEntity;
  for (const child of Object.values(object)) {
    const found = findSpotifyEmbedEntity(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function importFromEmbedEntity(
  entity: SpotifyEmbedEntity,
  collection: { type: SpotifyCollectionType; id: string }
): ImportPlaylistResult {
  const playlistName = entity.title ?? entity.name ?? collection.id;
  const artworkUrl = selectSpotifyImage(entity.visualIdentity?.image);
  const tracks = (entity.trackList ?? []).reduce<TrackMetadata[]>((acc, track, index) => {
    if (!track.title) return acc;

    acc.push({
      id: parseSpotifyUriId(track.uri) ?? track.uid ?? `${collection.id}-${index}`,
      title: htmlDecode(track.title),
      artists: artistsFromSubtitle(track.subtitle),
      album: collection.type === "album" ? playlistName : undefined,
      durationMs: Number.isFinite(track.duration) ? track.duration : undefined,
      artworkUrl,
      sourcePlaylist: playlistName
    });
    return acc;
  }, []);

  return { playlistName, tracks };
}

function importFromTrackListRows(
  html: string,
  collection: { type: SpotifyCollectionType; id: string }
): ImportPlaylistResult {
  const playlistName = htmlDecode(
    firstMatch(html, /<img[^>]+alt="([^"]+)\s+cover"/) ?? firstMatch(html, /<title[^>]*>(.*?)<\/title>/) ?? collection.id
  );
  const artworkUrl = htmlDecode(firstMatch(html, /<img[^>]+src="([^"]+)"[^>]*data-encore-id="image"/) ?? "");
  const rows = html.match(/<li class="TracklistRow_[\s\S]*?<\/li>/g) ?? [];
  const tracks = rows.reduce<TrackMetadata[]>((acc, row, index) => {
    const title = htmlDecode(firstMatch(row, /<h3[^>]*>([\s\S]*?)<\/h3>/) ?? "");
    if (!title) return acc;
    const subtitle = htmlDecode(firstMatch(row, /<h4[^>]*>([\s\S]*?)<\/h4>/) ?? "");
    const durationText = htmlDecode(firstMatch(row, /data-testid="duration-cell">([^<]+)</) ?? "");

    acc.push({
      id: `${collection.id}-${index}`,
      title,
      artists: artistsFromSubtitle(subtitle),
      album: collection.type === "album" ? playlistName : undefined,
      durationMs: parseDurationText(durationText),
      artworkUrl: artworkUrl || undefined,
      sourcePlaylist: playlistName
    });
    return acc;
  }, []);

  return { playlistName, tracks };
}

export function parseSpotisaverHtml(html: string, collection: { type: SpotifyCollectionType; id: string }): ImportPlaylistResult {
  const playlistName = htmlDecode(
    firstMatch(html, /<meta property="og:title" content="([^"]+)"/) ?? firstMatch(html, /<h4[^>]*itemprop="name"[^>]*>(.*?)<\/h4>/) ?? collection.id
  );
  const playlistArtwork = htmlDecode(
    firstMatch(html, /<meta property="og:image" content="([^"]+)"/) ?? firstMatch(html, /class="playlist-cover"[\s\S]*?src="([^"]+)"/) ?? ""
  );
  const rows = html.match(/<div class="track-item"[\s\S]*?(?=<div class="track-item"|<div class="floating-download-panel"|<\/main>|$)/g) ?? [];
  const tracks = rows.reduce<TrackMetadata[]>((acc, row, index) => {
    const title = htmlDecode(
      firstMatch(row, /<span class="track-name-text">([\s\S]*?)<\/span>/) ?? firstMatch(row, /class="track-cover"[\s\S]*?alt="([^"]+)"/) ?? ""
    );
    if (!title) return acc;
    const artist = htmlDecode(firstMatch(row, /<span itemprop="byArtist">([\s\S]*?)<\/span>/) ?? "");
    const duration = htmlDecode(firstMatch(row, /<span class="track-duration">([^<]+)<\/span>/) ?? "");
    const artworkUrl = htmlDecode(
      firstMatch(row, /data-cover-url="([^"]+)"/) ?? firstMatch(row, /class="track-cover"[\s\S]*?src="([^"]+)"/) ?? playlistArtwork
    );
    const trackId = firstMatch(row, /open\.spotify\.com\/track\/([a-zA-Z0-9]+)/) ?? `${collection.id}-${index}`;

    acc.push({
      id: trackId,
      title,
      artists: artist ? [artist] : [],
      album: collection.type === "album" ? playlistName : undefined,
      durationMs: parseDurationText(duration),
      artworkUrl: artworkUrl || undefined,
      sourcePlaylist: playlistName
    });
    return acc;
  }, []);

  const reportedTotal = Number(htmlDecode(firstMatch(html, /itemprop="numTracks">([^<]+)</) ?? ""));
  return { playlistName, tracks, reportedTotal: Number.isFinite(reportedTotal) && reportedTotal > 0 ? reportedTotal : undefined };
}

function selectSpotifyImage(images?: Array<{ url?: string; maxWidth?: number; maxHeight?: number }>): string | undefined {
  return images
    ?.filter((image): image is { url: string; maxWidth?: number; maxHeight?: number } => Boolean(image.url))
    .sort((a, b) => (b.maxWidth ?? b.maxHeight ?? 0) - (a.maxWidth ?? a.maxHeight ?? 0))[0]?.url;
}

function parseSpotifyUriId(uri?: string): string | undefined {
  return uri?.match(/spotify:track:([a-zA-Z0-9]+)/)?.[1];
}

function artistsFromSubtitle(subtitle?: string): string[] {
  const cleaned = htmlDecode(subtitle ?? "").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s*,\s*|\s+•\s+|\s+\/\s+|\s+&\s+|\s+and\s+/i)
    .map((artist) => artist.trim())
    .filter(Boolean);
}

function parseDurationText(value: string): number | undefined {
  const parts = value
    .trim()
    .split(":")
    .map((part) => Number(part));
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
}

function firstMatch(value: string, pattern: RegExp): string | undefined {
  return value.match(pattern)?.[1]?.replace(/<[^>]+>/g, "").trim();
}

function htmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function summarizePublicImportAttempts(attempts: PublicImportAttempt[]): string {
  if (!attempts.length) return "No public pages were checked.";
  const summary = attempts
    .slice(0, 5)
    .map((attempt) => {
      const source = attempt.url.includes("spotisaver") ? "metadata fallback" : attempt.url.includes("/embed/") ? "Spotify embed" : "Spotify page";
      if (!attempt.ok) return `${source}: ${attempt.error}`;
      return `${source}: ${attempt.tracks ?? 0} tracks from ${attempt.length ?? 0} chars`;
    })
    .join("; ");
  return `Public metadata check: ${summary}.`;
}

function fetchTextWithHttps(url: string, redirects = 2, timeoutMs = 12_000): Promise<string> {
  return fetchTextWithHttpsResponse(url, undefined, redirects, timeoutMs).then((response) => response.text);
}

function fetchTextWithHttpsResponse(url: string, headers: Record<string, string> = {}, redirects = 2, timeoutMs = 12_000): Promise<TextResponse> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "br,gzip,deflate",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
          ...headers
        }
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location && redirects > 0) {
          response.resume();
          const redirected = new URL(location, url).toString();
          void fetchTextWithHttpsResponse(redirected, headers, redirects - 1, timeoutMs).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`native public page failed: ${status}`));
          return;
        }

        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve({
              text: decodeHttpBody(Buffer.concat(chunks), response.headers["content-encoding"]),
              headers: response.headers,
              statusCode: status,
              url
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("native public page timed out"));
    });
    request.on("error", reject);
  });
}

function cookieHeaderFromResponse(response: TextResponse): string {
  const cookies = response.headers["set-cookie"];
  const list = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
  return list.map((cookie) => cookie.split(";")[0]).filter(Boolean).join("; ");
}

function firstImageUrl(images?: Array<{ url?: string }> | string[]): string | undefined {
  const first = images?.[0];
  if (!first) return undefined;
  return typeof first === "string" ? first : first.url;
}

function imageValue(value?: string | { url?: string }): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.url;
}

function parseTrackIdFromUrl(url?: string): string | undefined {
  return url?.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/)?.[1];
}

function decodeHttpBody(buffer: Buffer, encoding?: string | string[]): string {
  const value = Array.isArray(encoding) ? encoding[0] : encoding;
  if (value?.includes("br")) return zlib.brotliDecompressSync(buffer).toString("utf8");
  if (value?.includes("gzip")) return zlib.gunzipSync(buffer).toString("utf8");
  if (value?.includes("deflate")) return zlib.inflateSync(buffer).toString("utf8");
  return buffer.toString("utf8");
}

async function getValidAccessToken(settings: AppSettings, collectionType: SpotifyCollectionType = "playlist"): Promise<string> {
  const auth = await readAuth();
  if (auth?.accessToken && auth.expiresAt > Date.now() + 60_000) {
    return auth.accessToken;
  }

  const clientId = spotifyClientId(settings);
  if (!clientId) {
    throw new Error(`读取完整 Spotify ${collectionType} 需要官方授权；当前没有可用的 Spotify API 连接。`);
  }
  if (auth?.refreshToken) {
    const refreshed = await refreshAccessToken(clientId, auth.refreshToken);
    await writeAuth({ ...refreshed, refreshToken: refreshed.refreshToken ?? auth.refreshToken, displayName: auth.displayName });
    return refreshed.accessToken;
  }

  if (settings.spotifyClientSecret.trim()) {
    return getClientCredentialsToken(settings);
  }

  throw new Error(`请先在设置里连接 Spotify API，再导入这个 ${collectionType}。`);
}

async function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Spotify login timed out."));
    }, 120_000);

    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", redirectUri);
      if (requestUrl.pathname !== "/spotify/callback") {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const state = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");

      clearTimeout(timeout);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<html><body><h2>Spotify connected.</h2><p>You can close this page.</p></body></html>");
      server.close();

      if (error) reject(new Error(`Spotify login failed: ${error}`));
      else if (state !== expectedState) reject(new Error("Spotify login state mismatch."));
      else if (!code) reject(new Error("Spotify did not return an authorization code."));
      else resolve(code);
    });

    server.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Spotify callback server failed: ${error.message}`));
    });
    server.listen(43879, "127.0.0.1");
  });
}

async function exchangeCode(clientId: string, code: string, verifier: string): Promise<SpotifyAuthStore> {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  });
  return tokenRequest(body);
}

async function refreshAccessToken(clientId: string, refreshToken: string): Promise<SpotifyAuthStore> {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  return tokenRequest(body);
}

async function tokenRequest(body: URLSearchParams): Promise<SpotifyAuthStore> {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    throw new Error(`Spotify authorization failed: ${response.status}`);
  }

  const data = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Spotify did not return an access token.");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Math.max(60, data.expires_in ?? 3600) * 1000
  };
}

async function getClientCredentialsToken(settings: AppSettings): Promise<string> {
  const credentials = Buffer.from(`${spotifyClientId(settings)}:${settings.spotifyClientSecret}`).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) throw new Error(`Spotify authorization failed: ${response.status}`);
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Spotify did not return an access token.");
  return data.access_token;
}

async function getProfileName(accessToken: string): Promise<string | undefined> {
  const response = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return undefined;
  const profile = (await response.json()) as { display_name?: string; id?: string };
  return profile.display_name ?? profile.id;
}

async function getPublicEmbedTitle(input: string): Promise<string | undefined> {
  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(input)}`);
  if (!response.ok) return undefined;
  const data = (await response.json()) as { title?: string };
  return data.title;
}

async function readAuth(): Promise<SpotifyAuthStore | null> {
  try {
    return JSON.parse(await readFile(authFile(), "utf8")) as SpotifyAuthStore;
  } catch {
    return null;
  }
}

async function writeAuth(auth: SpotifyAuthStore): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(authFile(), JSON.stringify(auth, null, 2), "utf8");
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
