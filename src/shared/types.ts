export type OutputFormat = "mp3" | "m4a" | "opus" | "flac" | "best";
export type AudioQuality = "best" | "balanced" | "small";

export interface TrackMetadata {
  id: string;
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  artworkUrl?: string;
  isrc?: string;
  sourcePlaylist?: string;
}

export interface MatchCandidate {
  id: string;
  title: string;
  uploader?: string;
  durationMs?: number;
  url: string;
  score: number;
  riskTags: string[];
  isVerified?: boolean;
  sourceType?: "youtube";
  sourceLabel?: string;
  matchedTrack?: TrackMetadata;
}

export type DownloadStatus =
  | "queued"
  | "searching"
  | "confirming"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface DownloadTask {
  id: string;
  track: TrackMetadata;
  candidate?: MatchCandidate;
  status: DownloadStatus;
  progress: number;
  outputPath?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  spotifyClientId: string;
  spotifyClientSecret: string;
  membershipKey: string;
  membershipValidationUrl: string;
  downloadDirectory: string;
  outputFormat: OutputFormat;
  audioQuality: AudioQuality;
  concurrentDownloads: number;
  autoDownloadThreshold: number;
  confirmationThreshold: number;
}

export interface ImportPlaylistResult {
  playlistName: string;
  tracks: TrackMetadata[];
  reportedTotal?: number;
}

export type SpotifyCollectionType = "playlist" | "album" | "track" | "artist";

export interface LibraryImportResult extends ImportPlaylistResult {
  source: "spotify";
  collectionType: SpotifyCollectionType;
}

export interface SpotifyAuthStatus {
  connected: boolean;
  needsClientId: boolean;
  displayName?: string;
  expiresAt?: number;
}

export type MembershipState = "trial" | "active" | "expired" | "invalid";

export interface MembershipStatus {
  state: MembershipState;
  checkedAt?: number;
  planName?: string;
  expiresAt?: number;
  memberId?: string;
  message?: string;
  validationUrl?: string;
  keyHash?: string;
  downloadsSinceLastVerification?: number;
}

export interface AppApi {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  chooseDownloadDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  getMembershipStatus(): Promise<MembershipStatus>;
  verifyMembership(): Promise<MembershipStatus>;
  clearMembership(): Promise<MembershipStatus>;
  startSpotifyLogin(): Promise<SpotifyAuthStatus>;
  getSpotifyAuthStatus(): Promise<SpotifyAuthStatus>;
  disconnectSpotify(): Promise<SpotifyAuthStatus>;
  importLibraryLink(link: string): Promise<LibraryImportResult>;
  importSpotifyPlaylist(playlistUrlOrId: string): Promise<ImportPlaylistResult>;
  enqueueDownload(track: TrackMetadata, candidate?: MatchCandidate): Promise<DownloadTask>;
  retryTask(taskId: string): Promise<DownloadTask | null>;
  approveTask(taskId: string): Promise<DownloadTask | null>;
  pauseTask(taskId: string): Promise<DownloadTask | null>;
  resumeTask(taskId: string): Promise<DownloadTask | null>;
  cancelTask(taskId: string): Promise<DownloadTask | null>;
  removeTask(taskId: string): Promise<boolean>;
  getTasks(): Promise<DownloadTask[]>;
  onTasksChanged(callback: (tasks: DownloadTask[]) => void): () => void;
}
