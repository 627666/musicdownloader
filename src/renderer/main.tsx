import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FolderOpen,
  Link,
  ListMusic,
  Pause,
  Play,
  RefreshCcw,
  Search,
  Settings,
  ShieldAlert,
  X
} from "lucide-react";
import type {
  AppSettings,
  DownloadTask,
  LibraryImportResult,
  MatchCandidate,
  SpotifyAuthStatus,
  TrackMetadata
} from "../shared/types";
import "./styles.css";

type Page = "search" | "downloads" | "settings";

function App() {
  const [page, setPage] = useState<Page>("search");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [authStatus, setAuthStatus] = useState<SpotifyAuthStatus | null>(null);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [libraryLink, setLibraryLink] = useState("");
  const [library, setLibrary] = useState<LibraryImportResult | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<TrackMetadata | null>(null);
  const [results, setResults] = useState<MatchCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<MatchCandidate | null>(null);

  useEffect(() => {
    void refreshSettings();
    void window.musicDownloader.getTasks().then(setTasks);
    return window.musicDownloader.onTasksChanged(setTasks);
  }, []);

  async function refreshSettings() {
    const next = await window.musicDownloader.getSettings();
    setSettings(next);
    setAuthStatus(await window.musicDownloader.getSpotifyAuthStatus());
  }

  async function importLibrary() {
    if (!libraryLink.trim()) return;
    setBusy("正在导入曲库");
    setNotice("");
    try {
      const imported = await window.musicDownloader.importLibraryLink(libraryLink);
      setLibrary(imported);
      setSelectedTrack(imported.tracks[0] ?? null);
      setResults([]);
      setSelectedCandidate(null);
      setNotice(`已导入 ${imported.collectionType === "album" ? "专辑" : "歌单"}：${imported.tracks.length} 首曲目`);
    } catch (error) {
      setNotice(cleanError(error));
    } finally {
      setBusy("");
    }
  }

  async function searchTrack(track: TrackMetadata) {
    setSelectedTrack(track);
    setSelectedCandidate(null);
    setBusy("正在搜索候选结果");
    setNotice("");
    try {
      const candidates = await window.musicDownloader.searchCandidates(track);
      setResults(candidates);
      setSelectedCandidate(candidates[0] ?? null);
      if (!candidates.length) setNotice("没有找到合适结果");
    } catch (error) {
      setNotice(cleanError(error));
    } finally {
      setBusy("");
    }
  }

  async function enqueueSelected() {
    if (!selectedTrack || !selectedCandidate) return;
    setBusy("正在加入下载队列");
    try {
      await window.musicDownloader.enqueueDownload(selectedCandidate.matchedTrack ?? selectedTrack, selectedCandidate);
      setNotice("已加入下载队列");
      setPage("downloads");
    } catch (error) {
      setNotice(cleanError(error));
    } finally {
      setBusy("");
    }
  }

  async function queueImportedTracks() {
    if (!library?.tracks.length) return;
    setBusy("正在加入下载队列");
    for (const track of library.tracks) {
      await window.musicDownloader.enqueueDownload(track);
    }
    setBusy("");
    setNotice(`已加入 ${library.tracks.length} 首曲目`);
    setPage("downloads");
  }

  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const activeCount = tasks.filter((task) => ["queued", "searching", "downloading", "confirming"].includes(task.status)).length;

  function selectCandidate(candidate: MatchCandidate) {
    setSelectedCandidate(candidate);
    if (candidate.matchedTrack) setSelectedTrack(candidate.matchedTrack);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">MD</div>
          <div>
            <h1>Music Downloader</h1>
            <p>Atmosphere coding music</p>
          </div>
        </div>

        <nav className="main-nav">
          <button className={page === "search" ? "active" : ""} onClick={() => setPage("search")}>
            <Search size={18} />
            搜索
          </button>
          <button className={page === "downloads" ? "active" : ""} onClick={() => setPage("downloads")}>
            <Download size={18} />
            下载
          </button>
          <button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}>
            <Settings size={18} />
            设置
          </button>
        </nav>

        <section className="panel compact">
          <div className="section-title">
            <ListMusic size={18} />
            <span>队列概览</span>
          </div>
          <div className="stat-grid">
            <div>
              <strong>{tasks.length}</strong>
              <span>全部</span>
            </div>
            <div>
              <strong>{activeCount}</strong>
              <span>进行中</span>
            </div>
            <div>
              <strong>{completedCount}</strong>
              <span>完成</span>
            </div>
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div>
            <h2>{pageTitle(page)}</h2>
            <p>{pageSubtitle(page)}</p>
          </div>
          <div className="busy">{busy || notice}</div>
        </header>

        {page === "search" && (
          <SearchPage
            libraryLink={libraryLink}
            setLibraryLink={setLibraryLink}
            library={library}
            selectedTrack={selectedTrack}
            results={results}
            selectedCandidate={selectedCandidate}
            setSelectedCandidate={selectCandidate}
            busy={busy}
            onImport={importLibrary}
            onSearchTrack={searchTrack}
            onQueueImported={queueImportedTracks}
            onEnqueueSelected={enqueueSelected}
          />
        )}
        {page === "downloads" && <DownloadPage tasks={tasks} settings={settings} />}
        {page === "settings" && (
          <SettingsPanel settings={settings} authStatus={authStatus} onSave={refreshSettings} setNotice={setNotice} setBusy={setBusy} />
        )}
      </section>
    </main>
  );
}

function SearchPage(props: {
  libraryLink: string;
  setLibraryLink: (value: string) => void;
  library: LibraryImportResult | null;
  selectedTrack: TrackMetadata | null;
  results: MatchCandidate[];
  selectedCandidate: MatchCandidate | null;
  setSelectedCandidate: (candidate: MatchCandidate) => void;
  busy: string;
  onImport: () => void;
  onSearchTrack: (track: TrackMetadata) => void;
  onQueueImported: () => void;
  onEnqueueSelected: () => void;
}) {
  return (
    <div className="content-grid search-layout">
      <section className="panel">
        <div className="section-title">
          <Link size={18} />
          <span>导入曲库链接</span>
        </div>
        <LibraryImportPanel {...props} />
      </section>

      <section className="panel result-panel">
        <div className="section-title">
          <ShieldAlert size={18} />
          <span>搜索结果</span>
        </div>
        <CandidateList
          results={props.results}
          selectedCandidate={props.selectedCandidate}
          onSelect={props.setSelectedCandidate}
          onEnqueue={props.onEnqueueSelected}
        />
      </section>
    </div>
  );
}

function LibraryImportPanel({
  libraryLink,
  setLibraryLink,
  library,
  selectedTrack,
  busy,
  onImport,
  onSearchTrack,
  onQueueImported
}: {
  libraryLink: string;
  setLibraryLink: (value: string) => void;
  library: LibraryImportResult | null;
  selectedTrack: TrackMetadata | null;
  busy: string;
  onImport: () => void;
  onSearchTrack: (track: TrackMetadata) => void;
  onQueueImported: () => void;
}) {
  return (
    <div className="library-panel">
      <div className="input-row">
        <input placeholder="Spotify 专辑 / 播放列表链接" value={libraryLink} onChange={(event) => setLibraryLink(event.target.value)} />
        <button onClick={onImport} disabled={!libraryLink.trim() || Boolean(busy)}>
          导入
        </button>
      </div>
      {library && (
        <>
          <div className="playlist-heading">
            <div>
              <strong>{library.playlistName}</strong>
              <span>{library.collectionType === "album" ? "专辑" : "播放列表"} · {library.tracks.length} 首</span>
            </div>
            <button className="secondary" onClick={onQueueImported} disabled={Boolean(busy)}>
              加入全部
            </button>
          </div>
          <div className="track-list">
            {library.tracks.map((track) => (
              <button
                key={track.id}
                className={selectedTrack?.id === track.id ? "track-row active" : "track-row"}
                onClick={() => onSearchTrack(track)}
              >
                {track.artworkUrl ? <img src={track.artworkUrl} alt="" /> : <div className="art-fallback" />}
                <span>
                  <strong>{track.title}</strong>
                  <small>{track.artists.join(", ") || "Unknown artist"}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CandidateList({
  results,
  selectedCandidate,
  onSelect,
  onEnqueue
}: {
  results: MatchCandidate[];
  selectedCandidate: MatchCandidate | null;
  onSelect: (candidate: MatchCandidate) => void;
  onEnqueue: () => void;
}) {
  return (
    <>
      <div className="candidate-list">
        {results.map((candidate) => (
          <button
            key={candidate.id}
            className={selectedCandidate?.id === candidate.id ? "candidate-card active" : "candidate-card"}
            onClick={() => onSelect(candidate)}
          >
            <div className="candidate-art">
              {candidate.matchedTrack?.artworkUrl ? <img src={candidate.matchedTrack.artworkUrl} alt="" /> : <div className="art-fallback" />}
            </div>
            <div className="candidate-main">
              <div className="candidate-meta">
                <span>{candidate.sourceLabel ?? "YouTube"}</span>
                <span>{formatDuration(candidate.durationMs)}</span>
              </div>
              {candidate.matchedTrack && (
                <div className="matched-track">
                  <span>{candidate.matchedTrack.artists.join(", ") || "Unknown artist"}</span>
                  <strong>{candidate.matchedTrack.title}</strong>
                </div>
              )}
              <strong>{candidate.title}</strong>
              <span>{candidate.uploader || "Unknown channel"}</span>
              <div className="confidence-row" data-score={candidate.score >= 82 ? "good" : candidate.score >= 58 ? "ok" : "risk"}>
                <span>关联度</span>
                <div className="confidence-bar">
                  <div style={{ width: `${candidate.score}%` }} />
                </div>
              </div>
              <div className="tags">
                {candidate.isVerified && <small>verified</small>}
                {candidate.riskTags.map((tag) => (
                  <small key={tag}>{tag}</small>
                ))}
              </div>
            </div>
          </button>
        ))}
        {!results.length && <p className="muted">暂无搜索结果</p>}
      </div>

      {selectedCandidate && (
        <div className="selected-result">
          <div>
            <strong>{selectedCandidate.matchedTrack?.title ?? selectedCandidate.title}</strong>
            <span>{selectedCandidate.uploader || "Unknown channel"}</span>
          </div>
          <button onClick={onEnqueue}>
            <Download size={16} />
            加入下载队列
          </button>
        </div>
      )}
    </>
  );
}

function DownloadPage({ tasks, settings }: { tasks: DownloadTask[]; settings: AppSettings | null }) {
  const groups = useMemo(
    () => [
      { key: "downloading", title: "正在下载", tasks: tasks.filter((task) => task.status === "downloading") },
      { key: "queued", title: "排队中", tasks: tasks.filter((task) => ["queued", "searching", "confirming"].includes(task.status)) },
      { key: "completed", title: "已完成", tasks: tasks.filter((task) => task.status === "completed") },
      { key: "failed", title: "失败/取消", tasks: tasks.filter((task) => ["failed", "cancelled", "paused"].includes(task.status)) }
    ],
    [tasks]
  );

  return (
    <section className="panel queue-panel">
      <div className="section-title">
        <Download size={18} />
        <span>下载队列</span>
        <small>{settings?.downloadDirectory}</small>
      </div>
      <div className="download-groups">
        {groups.map((group) => (
          <div className="download-group" key={group.key}>
            <div className="group-title">
              <strong>{group.title}</strong>
              <span>{group.tasks.length}</span>
            </div>
            <div className="queue-list">
              {group.tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
              {!group.tasks.length && <p className="muted">暂无任务</p>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskRow({ task }: { task: DownloadTask }) {
  const canPause = task.status === "downloading" || task.status === "searching";
  const canResume = task.status === "paused";
  const canRetry = task.status === "failed";

  return (
    <div className="task-row">
      <div className="task-main">
        <strong>{task.track.title}</strong>
        <span>{task.track.artists.join(", ") || task.candidate?.title || "Unknown artist"}</span>
        {task.error && <small className="error">{task.error}</small>}
        <div className="progress">
          <div style={{ width: `${task.progress}%` }} />
        </div>
      </div>
      <span className={`status ${task.status}`}>{statusText(task.status)}</span>
      <div className="task-actions">
        {canPause && (
          <button className="icon-button" onClick={() => window.musicDownloader.pauseTask(task.id)}>
            <Pause size={16} />
          </button>
        )}
        {canResume && (
          <button className="icon-button" onClick={() => window.musicDownloader.resumeTask(task.id)}>
            <Play size={16} />
          </button>
        )}
        {canRetry && (
          <button className="icon-button" onClick={() => window.musicDownloader.retryTask(task.id)}>
            <RefreshCcw size={16} />
          </button>
        )}
        <button className="icon-button" onClick={() => window.musicDownloader.cancelTask(task.id)}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  authStatus,
  onSave,
  setNotice,
  setBusy
}: {
  settings: AppSettings | null;
  authStatus: SpotifyAuthStatus | null;
  onSave: () => Promise<void>;
  setNotice: (notice: string) => void;
  setBusy: (busy: string) => void;
}) {
  const [draft, setDraft] = useState<AppSettings | null>(settings);

  useEffect(() => setDraft(settings), [settings]);
  if (!draft) return null;

  async function save(next = draft) {
    await window.musicDownloader.saveSettings(next);
    await onSave();
    setNotice("设置已保存");
  }

  async function chooseDirectory() {
    const folder = await window.musicDownloader.chooseDownloadDirectory();
    if (folder) {
      const next = { ...draft, downloadDirectory: folder };
      setDraft(next);
      await save(next);
    }
  }

  async function connectSpotify() {
    setBusy("正在连接 Spotify");
    try {
      await save(draft);
      await window.musicDownloader.startSpotifyLogin();
      await onSave();
      setNotice("Spotify 已连接");
    } catch (error) {
      setNotice(cleanError(error));
    } finally {
      setBusy("");
    }
  }

  async function disconnectSpotify() {
    await window.musicDownloader.disconnectSpotify();
    await onSave();
    setNotice("Spotify 已断开");
  }

  return (
    <section className="panel settings-panel page-settings">
      <div className="section-title">
        <Settings size={18} />
        <span>设置</span>
      </div>
      <label>
        Spotify Client ID
        <input value={draft.spotifyClientId} onChange={(event) => setDraft({ ...draft, spotifyClientId: event.target.value })} />
      </label>
      <label>
        Spotify Client Secret
        <input
          type="password"
          value={draft.spotifyClientSecret}
          onChange={(event) => setDraft({ ...draft, spotifyClientSecret: event.target.value })}
        />
      </label>
      <div className="settings-actions">
        <button className="secondary" onClick={connectSpotify}>
          <ExternalLink size={16} />
          连接 Spotify
        </button>
        <button className="secondary" onClick={() => window.musicDownloader.openExternal("https://developer.spotify.com/dashboard")}>
          Spotify App
        </button>
        {authStatus?.connected && (
          <button className="secondary" onClick={disconnectSpotify}>
            断开
          </button>
        )}
      </div>
      <p className="auth-line">{authStatus?.connected ? `Spotify: ${authStatus.displayName ?? "connected"}` : "Spotify: not connected"}</p>
      <label>
        Output Format
        <select value={draft.outputFormat} onChange={(event) => setDraft({ ...draft, outputFormat: event.target.value as AppSettings["outputFormat"] })}>
          <option value="mp3">MP3</option>
          <option value="m4a">M4A</option>
          <option value="opus">Opus</option>
          <option value="flac">FLAC</option>
          <option value="best">Best audio</option>
        </select>
      </label>
      <label>
        Audio Quality
        <select value={draft.audioQuality} onChange={(event) => setDraft({ ...draft, audioQuality: event.target.value as AppSettings["audioQuality"] })}>
          <option value="best">最佳可用音源</option>
          <option value="balanced">均衡音质</option>
          <option value="small">小文件</option>
        </select>
      </label>
      <label>
        Concurrent Downloads
        <input
          type="number"
          min={1}
          max={5}
          value={draft.concurrentDownloads}
          onChange={(event) => setDraft({ ...draft, concurrentDownloads: Number(event.target.value) })}
        />
      </label>
      <label>
        Download Folder
        <input readOnly value={draft.downloadDirectory} />
      </label>
      <div className="settings-actions">
        <button className="secondary" onClick={chooseDirectory}>
          <FolderOpen size={16} />
          Folder
        </button>
        <button onClick={() => save()}>
          <CheckCircle2 size={16} />
          Save
        </button>
      </div>
    </section>
  );
}

function pageTitle(page: Page): string {
  return page === "search" ? "搜索" : page === "downloads" ? "下载" : "设置";
}

function pageSubtitle(page: Page): string {
  if (page === "search") return "导入 Spotify 专辑、播放列表，或按关键词查找候选音源";
  if (page === "downloads") return "查看排队、下载中、完成和失败任务";
  return "Spotify、下载目录和格式";
}

function formatDuration(durationMs?: number): string {
  if (!durationMs) return "--:--";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function statusText(status: DownloadTask["status"]): string {
  const map: Record<DownloadTask["status"], string> = {
    queued: "排队中",
    searching: "搜索中",
    confirming: "待确认",
    downloading: "下载中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消"
  };
  return map[status];
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

createRoot(document.getElementById("root")!).render(<App />);
