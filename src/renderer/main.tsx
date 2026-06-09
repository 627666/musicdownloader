import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  Crown,
  Download,
  ExternalLink,
  FolderOpen,
  Gauge,
  Globe2,
  Home,
  Link,
  Pause,
  Play,
  RefreshCcw,
  RotateCw,
  Settings,
  Sparkles,
  Trash2
} from "lucide-react";
import type {
  AppSettings,
  DownloadTask,
  LibraryImportResult,
  MembershipStatus,
  SpotifyAuthStatus,
  SpotifyCollectionType
} from "../shared/types";
import tuneKeepWordmark from "./assets/tunekeep-wordmark-dark.png";
import "./styles.css";

type Page = "home" | "import" | "downloads" | "settings";
type QueueFilter = "all" | "downloading" | "queued" | "completed" | "failed";
type SpotifyWebviewElement = HTMLWebViewElement & {
  getURL(): string;
  loadURL(url: string): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
};

const spotifyDesktopUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const spotifyBrowserHomeUrl = "https://open.spotify.com/";

const navItems: Array<{ page: Page; label: string; icon: React.ElementType }> = [
  { page: "home", label: "首页", icon: Home },
  { page: "import", label: "导入音乐", icon: Link },
  { page: "downloads", label: "下载队列", icon: Download },
  { page: "settings", label: "设置", icon: Settings }
];

function App() {
  const [page, setPage] = useState<Page>("home");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [authStatus, setAuthStatus] = useState<SpotifyAuthStatus | null>(null);
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [libraryLink, setLibraryLink] = useState("");
  const [library, setLibrary] = useState<LibraryImportResult | null>(null);

  useEffect(() => {
    void refreshSettings();
    void window.musicDownloader.getTasks().then(setTasks);
    return window.musicDownloader.onTasksChanged(setTasks);
  }, []);

  async function refreshSettings() {
    const next = await window.musicDownloader.getSettings();
    setSettings(next);
    setAuthStatus(await window.musicDownloader.getSpotifyAuthStatus());
    setMembershipStatus(await window.musicDownloader.getMembershipStatus());
  }

  async function importLibrary(linkOverride?: string) {
    const link = (linkOverride ?? libraryLink).trim();
    if (!link) return;
    setBusy("正在导入曲库");
    setNotice("");
    if (linkOverride) setLibraryLink(link);
    try {
      const imported = await window.musicDownloader.importLibraryLink(link);
      setLibrary(imported);
      setNotice(`已导入 ${collectionTypeLabel(imported.collectionType)}：${imported.tracks.length} 首曲目`);
      setPage("import");
    } catch (error) {
      setNotice(cleanError(error));
    } finally {
      setBusy("");
    }
  }

  async function queueImportedTracks() {
    if (!library?.tracks.length) return;
    const total = library.tracks.length;
    let added = 0;
    setBusy(`正在加入下载队列 0/${total}`);
    try {
      for (const track of library.tracks) {
        await window.musicDownloader.enqueueDownload(track);
        added += 1;
        if (added % 10 === 0 || added === total) setBusy(`正在加入下载队列 ${added}/${total}`);
        if (added % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      setNotice(`已加入 ${added}/${total} 首曲目`);
      setPage("downloads");
    } catch (error) {
      setNotice(`已加入 ${added}/${total} 首曲目；${cleanError(error)}`);
    } finally {
      setBusy("");
    }
  }

  async function connectSpotify() {
    setBusy("正在打开 Spotify 授权页");
    setNotice("");
    try {
      await window.musicDownloader.startSpotifyLogin();
      await refreshSettings();
      setNotice("Spotify 已连接");
    } catch (error) {
      const message = cleanError(error);
      if (message.includes("not configured")) {
        await window.musicDownloader.openExternal(spotifyBrowserHomeUrl);
        setNotice("已用系统浏览器打开 Spotify。当前构建未配置 Spotify 授权 Client ID，可先复制公开链接导入。");
      } else {
        setNotice(message);
      }
    } finally {
      setBusy("");
    }
  }

  const summary = useTaskSummary(tasks);
  const activityText = busy || notice;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={tuneKeepWordmark} alt="TuneKeep" />
        </div>

        <nav className="main-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.page} className={page === item.page ? "active" : ""} onClick={() => setPage(item.page)}>
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <PlanCard status={membershipStatus} />
      </aside>

      <section className="workspace">
        <TopBar summary={summary} notice={activityText} membershipStatus={membershipStatus} />

        <header className="page-header">
          <div>
            <h2>{pageTitle(page)}</h2>
            <p>{pageSubtitle(page)}</p>
          </div>
        </header>

        <section className="page-body">
          {page === "home" && <HomePage tasks={tasks} library={library} setPage={setPage} settings={settings} />}
          {page === "import" && (
            <ImportPage
              libraryLink={libraryLink}
              setLibraryLink={setLibraryLink}
              library={library}
              busy={busy}
              onImport={() => importLibrary()}
              onImportLink={importLibrary}
              onQueueImported={queueImportedTracks}
              membershipStatus={membershipStatus}
              authStatus={authStatus}
              onConnectSpotify={connectSpotify}
            />
          )}
          {page === "downloads" && <DownloadPage tasks={tasks} settings={settings} setNotice={setNotice} />}
          {page === "settings" && (
            <SettingsPanel
              settings={settings}
              authStatus={authStatus}
              membershipStatus={membershipStatus}
              onSave={refreshSettings}
              setNotice={setNotice}
              setBusy={setBusy}
            />
          )}
        </section>

      </section>
    </main>
  );
}

function TopBar({
  summary,
  notice,
  membershipStatus
}: {
  summary: TaskSummary;
  notice: string;
  membershipStatus: MembershipStatus | null;
}) {
  const state = membershipStatus?.state ?? "trial";
  return (
    <div className="topbar">
      <div className="top-metrics">
        <span>
          <Gauge size={15} />
          Active Tasks: {summary.active}
        </span>
      </div>
      <div className="top-notice">{notice}</div>
      <div className="membership-pill" data-state={state}>
        <Crown size={15} />
        <span>{membershipStateText(state)}</span>
      </div>
    </div>
  );
}

function PlanCard({ status }: { status: MembershipStatus | null }) {
  const state = status?.state ?? "trial";
  return (
    <section className="plan-card" data-state={state}>
      <div>
        <strong>{membershipStateText(state)}</strong>
        <span>{state === "active" ? "VIP" : "Free"}</span>
      </div>
      <p>{status?.message ?? "当前为试用模式，可正常体验下载。"}</p>
      <div className="plan-meter">
        <i />
      </div>
      <button>
        <Crown size={16} />
        Upgrade to Pro
      </button>
    </section>
  );
}

function HomePage({
  tasks,
  library,
  setPage,
  settings
}: {
  tasks: DownloadTask[];
  library: LibraryImportResult | null;
  setPage: (page: Page) => void;
  settings: AppSettings | null;
}) {
  const current = tasks.filter((task) => ["downloading", "searching", "queued"].includes(task.status)).slice(0, 4);
  const failed = tasks.filter((task) => ["failed", "cancelled", "paused"].includes(task.status)).slice(0, 3);
  const recent = library?.tracks.slice(0, 4) ?? [];

  return (
    <div className="home-grid">
      <section className="surface home-panel home-panel-large">
        <PanelTitle title="Current Downloads" action="View All" onAction={() => setPage("downloads")} />
        <div className="stack-list">
          {current.map((task) => (
            <CompactTask key={task.id} task={task} />
          ))}
          {!current.length && <EmptyState text="暂无进行中的下载任务" />}
        </div>
      </section>

      <section className="surface home-panel home-panel-large">
        <PanelTitle title="Recent Imports" action="View All" onAction={() => setPage("import")} />
        <div className="stack-list">
          {recent.map((track) => (
            <div className="mini-row" key={track.id}>
              {track.artworkUrl ? <img src={track.artworkUrl} alt="" /> : <span className="art-fallback" />}
              <div>
                <strong>{track.title}</strong>
                <span>{track.artists.join(", ") || "Unknown artist"}</span>
              </div>
              <button className="outline" onClick={() => window.musicDownloader.enqueueDownload(track)}>
                Add
              </button>
            </div>
          ))}
          {!recent.length && <EmptyState text="导入 Spotify 链接后会显示最近导入曲目" />}
        </div>
      </section>

      <section className="surface home-panel home-panel-large">
        <PanelTitle title="Failed Tasks" action="View All" onAction={() => setPage("downloads")} />
        <div className="stack-list">
          {failed.map((task) => (
            <div className="mini-row danger" key={task.id}>
              {task.track.artworkUrl ? <img src={task.track.artworkUrl} alt="" /> : <span className="art-fallback" />}
              <div>
                <strong>{task.track.title}</strong>
                <span>{task.error ?? statusText(task.status)}</span>
              </div>
              <button className="outline" onClick={() => window.musicDownloader.retryTask(task.id)}>
                Retry
              </button>
            </div>
          ))}
          {!failed.length && <EmptyState text="暂无失败任务" />}
        </div>
      </section>

      <section className="surface quick-actions home-panel-large">
        <PanelTitle title="Quick Actions" />
        <div className="quick-grid">
          <button onClick={() => setPage("import")}>
            <Link size={28} />
            Import Link
          </button>
          <button onClick={() => settings?.downloadDirectory && window.musicDownloader.openExternal(localFileUrl(settings.downloadDirectory))}>
            <FolderOpen size={28} />
            Open Folder
          </button>
          <button onClick={() => setPage("settings")}>
            <Crown size={28} />
            Membership Settings
          </button>
        </div>
      </section>
    </div>
  );
}

function ImportPage(props: {
  libraryLink: string;
  setLibraryLink: (value: string) => void;
  library: LibraryImportResult | null;
  busy: string;
  onImport: () => void;
  onImportLink: (link: string) => void;
  onQueueImported: () => void;
  membershipStatus: MembershipStatus | null;
  authStatus: SpotifyAuthStatus | null;
  onConnectSpotify: () => void;
}) {
  return (
    <div className="import-page">
      <div className="import-workbench">
        <div className="import-side-stack">
          <LibraryImportPanel {...props} />
          <SpotifyAccessPanel authStatus={props.authStatus} busy={props.busy} onConnectSpotify={props.onConnectSpotify} />
        </div>
        <SpotifyBrowserImportPanel {...props} />
      </div>

      <ImportedLibraryTracks
        library={props.library}
        busy={props.busy}
        canDownload={canUseDownloads(props.membershipStatus)}
        onQueueImported={props.onQueueImported}
      />
    </div>
  );
}

function LibraryImportPanel({
  libraryLink,
  setLibraryLink,
  busy,
  onImport
}: {
  libraryLink: string;
  setLibraryLink: (value: string) => void;
  library: LibraryImportResult | null;
  busy: string;
  onImport: () => void;
  onQueueImported: () => void;
  membershipStatus: MembershipStatus | null;
}) {
  return (
    <section className="surface link-import-card">
      <h3>Paste Spotify Link</h3>
      <p>支持 Spotify 专辑、播放列表、单曲和艺人链接。公开链接可直接导入；超长歌单需要完成 Spotify 授权后才能完整读取。</p>
      <div className="input-row">
        <input placeholder="https://open.spotify.com/playlist/..." value={libraryLink} onChange={(event) => setLibraryLink(event.target.value)} />
        <button onClick={onImport} disabled={!libraryLink.trim() || Boolean(busy)}>
          <Link size={16} />
          导入
        </button>
      </div>
    </section>
  );
}

function SpotifyAccessPanel({
  authStatus,
  busy,
  onConnectSpotify
}: {
  authStatus: SpotifyAuthStatus | null;
  busy: string;
  onConnectSpotify: () => void;
}) {
  return (
    <section className="surface spotify-access-card">
      <PanelTitle title="Spotify Web Login" icon={Globe2} />
      <p>{authStatus?.connected ? "Spotify 已连接，可以导入账号有权限访问的内容。" : "如需登录 Spotify 或使用 Google 登录，请用系统浏览器打开。右侧网页只用于浏览和识别链接。"}</p>
      <div className="access-actions">
        <button className="secondary" onClick={onConnectSpotify} disabled={Boolean(busy)}>
          <ExternalLink size={16} />
          授权连接
        </button>
        <button className="secondary" onClick={() => window.musicDownloader.openExternal(spotifyBrowserHomeUrl)}>
          <Globe2 size={16} />
          系统浏览器打开
        </button>
      </div>
    </section>
  );
}

function SpotifyBrowserImportPanel({
  library,
  busy,
  onImportLink,
  authStatus
}: {
  library: LibraryImportResult | null;
  busy: string;
  onImportLink: (link: string) => void;
  onQueueImported: () => void;
  membershipStatus: MembershipStatus | null;
  authStatus: SpotifyAuthStatus | null;
}) {
  const [webview, setWebview] = useState<SpotifyWebviewElement | null>(null);
  const [address, setAddress] = useState(spotifyBrowserHomeUrl);
  const [currentUrl, setCurrentUrl] = useState(spotifyBrowserHomeUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const detected = useMemo(() => detectSpotifyLibraryUrl(currentUrl), [currentUrl]);

  const setWebviewNode = useCallback((node: SpotifyWebviewElement | null) => {
    setWebview(node);
  }, []);

  useEffect(() => {
    if (!webview) return;
    const syncUrl = () => {
      const nextUrl = webview.getURL();
      if (!nextUrl) return;
      setCurrentUrl(nextUrl);
      setAddress(nextUrl);
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };
    const redirectUnsafeLogin = (event: Event) => {
      const nextUrl = (event as Event & { url?: string }).url;
      if (!nextUrl || shouldStayInSpotifyPreview(nextUrl)) return;
      event.preventDefault();
      void window.musicDownloader.openExternal(nextUrl);
      setCurrentUrl(spotifyBrowserHomeUrl);
      setAddress(spotifyBrowserHomeUrl);
      webview.loadURL(spotifyBrowserHomeUrl);
    };
    webview.addEventListener("did-navigate", syncUrl);
    webview.addEventListener("did-navigate-in-page", syncUrl);
    webview.addEventListener("dom-ready", syncUrl);
    webview.addEventListener("will-navigate", redirectUnsafeLogin);
    webview.addEventListener("new-window", redirectUnsafeLogin);
    return () => {
      webview.removeEventListener("did-navigate", syncUrl);
      webview.removeEventListener("did-navigate-in-page", syncUrl);
      webview.removeEventListener("dom-ready", syncUrl);
      webview.removeEventListener("will-navigate", redirectUnsafeLogin);
      webview.removeEventListener("new-window", redirectUnsafeLogin);
    };
  }, [webview]);

  function loadAddress() {
    const next = normalizeSpotifyBrowserAddress(address);
    setAddress(next);
    setCurrentUrl(next);
    webview?.loadURL(next);
  }

  function openHome() {
    const next = spotifyBrowserHomeUrl;
    setAddress(next);
    setCurrentUrl(next);
    webview?.loadURL(next);
  }

  return (
    <section className="surface browser-stage">
      <PanelTitle title="Spotify Browser Preview" icon={Globe2} />
      <div className="browser-toolbar">
        <button className="icon-button" onClick={openHome} title="打开 Spotify 曲库">
          <Home size={16} />
        </button>
        <button className="icon-button" onClick={() => webview?.goBack()} disabled={!canGoBack} title="上一页">
          ←
        </button>
        <button className="icon-button" onClick={() => webview?.goForward()} disabled={!canGoForward} title="下一页">
          →
        </button>
        <button className="icon-button" onClick={() => webview?.reload()} title="刷新">
          <RotateCw size={15} />
        </button>
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") loadAddress();
          }}
        />
        <button className="secondary" onClick={loadAddress}>
          打开
        </button>
        <button className="secondary" onClick={() => window.musicDownloader.openExternal(address || spotifyBrowserHomeUrl)}>
          <ExternalLink size={16} />
          系统浏览器打开
        </button>
      </div>
      <div className="browser-auth-row">
        <span>{authStatus?.connected ? "Spotify 已连接，可导入账号有权限访问的内容。" : "右侧页面用于浏览和识别当前 Spotify 链接；登录请使用左侧入口。"}</span>
      </div>
      <div className="browser-import-row">
        <span>
          {detected ? `已识别 ${collectionTypeLabel(detected.type)}：${detected.id}` : library ? `${library.playlistName} · ${library.tracks.length} 首` : "打开 Spotify 页面后即可导入"}
        </span>
        <button onClick={() => detected && onImportLink(detected.url)} disabled={!detected || Boolean(busy)}>
          导入当前页面
        </button>
      </div>
      <webview
        ref={setWebviewNode}
        className="spotify-webview"
        src={spotifyBrowserHomeUrl}
        partition="persist:spotify-browser"
        useragent={spotifyDesktopUserAgent}
        allowpopups={true}
        webpreferences="contextIsolation=yes,nodeIntegration=no"
      />
    </section>
  );
}

function ImportedLibraryTracks({
  library,
  busy,
  canDownload,
  onQueueImported
}: {
  library: LibraryImportResult | null;
  busy: string;
  canDownload: boolean;
  onQueueImported: () => void;
}) {
  if (!library) {
    return (
      <section className="surface imported-results empty-results">
        <PanelTitle title="Imported Results" />
        <EmptyState text="导入后，这里会显示曲目列表和下载准备状态。" />
      </section>
    );
  }

  return (
    <section className="surface imported-results">
      <div className="result-head">
        <PanelTitle title="Imported Results" />
        <div className="result-filters">
          <span className="active">All {library.tracks.length}</span>
          <span>Matched {library.tracks.length}</span>
          <span>Possible mismatch 0</span>
        </div>
      </div>
      <div className="music-table import-table">
        <div className="table-head">
          <span>Track</span>
          <span>Artist</span>
          <span>Album</span>
          <span>Duration</span>
          <span>Match Status</span>
        </div>
        <div className="table-body">
          {library.tracks.map((track) => (
            <div className="table-row" key={track.id}>
              <span className="track-cell">
                {track.artworkUrl ? <img src={track.artworkUrl} alt="" /> : <i className="art-fallback" />}
                <strong>{track.title}</strong>
              </span>
              <span>{track.artists.join(", ") || "Unknown artist"}</span>
              <span>{track.album ?? library.playlistName}</span>
              <span>{formatDuration(track.durationMs)}</span>
              <span className="badge ok">Ready</span>
            </div>
          ))}
        </div>
      </div>
      <div className="result-footer">
        <strong>Selected {library.tracks.length} of {library.tracks.length} tracks</strong>
        <button onClick={onQueueImported} disabled={Boolean(busy) || !canDownload}>
          <Download size={16} />
          Add to Download Queue
        </button>
      </div>
    </section>
  );
}

async function openTaskOutput(task: DownloadTask, setNotice: (notice: string) => void) {
  if (!task.outputPath) {
    setNotice("文件尚未生成");
    return;
  }
  try {
    await window.musicDownloader.openPath(task.outputPath);
    setNotice(`已打开：${task.track.title}`);
  } catch (error) {
    setNotice(cleanError(error));
  }
}

async function removeTaskRecord(taskId: string, setNotice: (notice: string) => void) {
  try {
    await window.musicDownloader.removeTask(taskId);
    setNotice("任务记录已删除，本地文件未删除");
  } catch (error) {
    setNotice(cleanError(error));
  }
}

function DownloadPage({
  tasks,
  settings,
  setNotice
}: {
  tasks: DownloadTask[];
  settings: AppSettings | null;
  setNotice: (notice: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const summary = useTaskSummary(tasks);
  const filteredTasks = useMemo(() => tasks.filter((task) => taskMatchesQueueFilter(task, filter)), [filter, tasks]);
  const selected = useMemo(() => filteredTasks.find((task) => task.id === selectedId) ?? filteredTasks[0] ?? null, [filteredTasks, selectedId]);
  const filters: Array<{ value: QueueFilter; label: string; count: number }> = [
    { value: "all", label: "All", count: tasks.length },
    { value: "downloading", label: "Downloading", count: summary.downloading },
    { value: "queued", label: "Queued", count: summary.queued },
    { value: "completed", label: "Completed", count: summary.completed },
    { value: "failed", label: "Failed", count: summary.failed }
  ];

  return (
    <div className="download-layout">
      <section className="surface queue-board">
        <div className="queue-tabs">
          {filters.map((item) => (
            <button key={item.value} className={filter === item.value ? "active" : ""} onClick={() => setFilter(item.value)}>
              {item.label} <b>{item.count}</b>
            </button>
          ))}
        </div>
        <div className="queue-actions">
          <button onClick={() => tasks.filter((task) => ["failed", "cancelled"].includes(task.status)).forEach((task) => window.musicDownloader.retryTask(task.id))}>
            <RefreshCcw size={16} />
            Retry Failed
          </button>
          <span>{settings?.downloadDirectory}</span>
        </div>
        <div className="music-table queue-table">
          <div className="table-head">
            <span>Track</span>
            <span>Artist</span>
            <span>Status</span>
            <span>Progress</span>
            <span>Source Match</span>
            <span>Actions</span>
          </div>
          <div className="table-body">
            {filteredTasks.map((task) => (
              <DownloadRow
                key={task.id}
                task={task}
                selected={selected?.id === task.id}
                onSelect={() => setSelectedId(task.id)}
                setNotice={setNotice}
              />
            ))}
            {!filteredTasks.length && <EmptyState text="当前筛选下没有下载任务。" />}
          </div>
        </div>
      </section>
      <TaskDetails task={selected} settings={settings} setNotice={setNotice} />
    </div>
  );
}

function DownloadRow({
  task,
  selected,
  onSelect,
  setNotice
}: {
  task: DownloadTask;
  selected: boolean;
  onSelect: () => void;
  setNotice: (notice: string) => void;
}) {
  return (
    <div className={selected ? "table-row selected" : "table-row"} onClick={onSelect}>
      <span className="track-cell">
        {task.track.artworkUrl ? <img src={task.track.artworkUrl} alt="" /> : <i className="art-fallback" />}
        <strong>{task.track.title}</strong>
      </span>
      <span>{task.track.artists.join(", ") || "Unknown artist"}</span>
      <span className={`status-pill ${task.status}`}>{statusText(task.status)}</span>
      <span className="progress-cell">
        <b>{Math.round(task.progress)}%</b>
        <i><em style={{ width: `${task.progress}%` }} /></i>
      </span>
      <span className={task.candidate ? "match-ok" : "match-wait"}>{task.candidate ? `Matched ${task.candidate.score}%` : "Pending"}</span>
      <span className="row-actions">
        {task.status === "completed" && (
          <button
            className="icon-button"
            title={task.outputPath ? "打开音乐文件" : "文件尚未生成"}
            disabled={!task.outputPath}
            onClick={(event) => {
              event.stopPropagation();
              void openTaskOutput(task, setNotice);
            }}
          >
            <ExternalLink size={15} />
          </button>
        )}
        {["failed", "cancelled"].includes(task.status) && (
          <button className="icon-button" title="重试" onClick={(event) => { event.stopPropagation(); void window.musicDownloader.retryTask(task.id); }}>
            <RefreshCcw size={15} />
          </button>
        )}
        {["downloading", "searching"].includes(task.status) && (
          <button className="icon-button" title="暂停" onClick={(event) => { event.stopPropagation(); void window.musicDownloader.pauseTask(task.id); }}>
            <Pause size={15} />
          </button>
        )}
        {task.status === "paused" && (
          <button className="icon-button" title="继续" onClick={(event) => { event.stopPropagation(); void window.musicDownloader.resumeTask(task.id); }}>
            <Play size={15} />
          </button>
        )}
        <button
          className="icon-button danger-action"
          title="删除任务记录"
          onClick={(event) => {
            event.stopPropagation();
            void removeTaskRecord(task.id, setNotice);
          }}
        >
          <Trash2 size={15} />
        </button>
      </span>
    </div>
  );
}

function TaskDetails({
  task,
  settings,
  setNotice
}: {
  task: DownloadTask | null;
  settings: AppSettings | null;
  setNotice: (notice: string) => void;
}) {
  return (
    <aside className="details-rail">
      <section className="surface details-card">
        <PanelTitle title="Track Details" />
        {task ? (
          <>
            <div className="detail-hero">
              {task.track.artworkUrl ? <img src={task.track.artworkUrl} alt="" /> : <span className="art-fallback" />}
              <div>
                <strong>{task.track.title}</strong>
                <span>{task.track.artists.join(", ") || "Unknown artist"}</span>
              </div>
            </div>
            <dl>
              <dt>Album</dt>
              <dd>{task.track.album ?? "Unknown"}</dd>
              <dt>Status</dt>
              <dd>{statusText(task.status)}</dd>
              <dt>Format</dt>
              <dd>MP3</dd>
              <dt>Progress</dt>
              <dd>{Math.round(task.progress)}%</dd>
              <dt>Location</dt>
              <dd>{taskLocationText(task, settings)}</dd>
            </dl>
            <div className="detail-actions">
              <button
                className="secondary"
                disabled={!task.outputPath}
                title={task.outputPath ? "打开音乐文件" : "文件尚未生成"}
                onClick={() => void openTaskOutput(task, setNotice)}
              >
                <ExternalLink size={16} />
                打开音乐文件
              </button>
            </div>
          </>
        ) : (
          <EmptyState text="选择一个任务查看详情。" />
        )}
      </section>
      <section className="surface details-card">
        <PanelTitle title="Activity Log" />
        <ol className="activity-log">
          <li className="done">Task added to queue</li>
          <li className={task?.candidate ? "done" : ""}>Matching public source</li>
          <li className={task?.status === "downloading" || task?.status === "completed" ? "done" : ""}>Started downloading</li>
          <li className={task?.status === "completed" ? "done" : ""}>Completed</li>
        </ol>
      </section>
    </aside>
  );
}

function SettingsPanel({
  settings,
  authStatus,
  membershipStatus,
  onSave,
  setNotice,
  setBusy
}: {
  settings: AppSettings | null;
  authStatus: SpotifyAuthStatus | null;
  membershipStatus: MembershipStatus | null;
  onSave: () => Promise<void>;
  setNotice: (notice: string) => void;
  setBusy: (busy: string) => void;
}) {
  const [draft, setDraft] = useState<AppSettings | null>(settings);

  useEffect(() => setDraft(settings), [settings]);
  if (!draft) return null;

  async function save(next: AppSettings) {
    await window.musicDownloader.saveSettings(next);
    await onSave();
    setNotice("设置已保存");
  }

  async function chooseDirectory() {
    if (!draft) return;
    const folder = await window.musicDownloader.chooseDownloadDirectory();
    if (folder) {
      const next = { ...draft, downloadDirectory: folder };
      setDraft(next);
      await save(next);
    }
  }

  async function connectSpotify() {
    if (!draft) return;
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

  async function verifyMembership() {
    if (!draft) return;
    setBusy("正在激活 VIP");
    try {
      await save(draft);
      const status = await window.musicDownloader.verifyMembership();
      await onSave();
      setNotice(status.message ?? membershipStateText(status.state));
    } catch (error) {
      setNotice(cleanError(error));
    } finally {
      setBusy("");
    }
  }

  async function clearMembership() {
    await window.musicDownloader.clearMembership();
    await onSave();
    setNotice("已清除 VIP 激活信息");
  }

  return (
    <div className="settings-layout">
        <section className="surface settings-card download-settings">
          <PanelTitle title="Download Settings" icon={Download} />
          <SettingRow label="Download Directory">
            <input readOnly value={draft.downloadDirectory} />
            <button className="secondary" onClick={chooseDirectory}>Change</button>
          </SettingRow>
          <SettingRow label="Output Format">
            <div className="segmented">
              {(["mp3", "flac", "m4a", "opus", "best"] as AppSettings["outputFormat"][]).map((format) => (
                <button key={format} className={draft.outputFormat === format ? "active" : ""} onClick={() => setDraft({ ...draft, outputFormat: format })}>
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
          </SettingRow>
          <SettingRow label="Audio Quality">
            <select value={draft.audioQuality} onChange={(event) => setDraft({ ...draft, audioQuality: event.target.value as AppSettings["audioQuality"] })}>
              <option value="best">最佳可用音源</option>
              <option value="balanced">均衡音质</option>
              <option value="small">小文件</option>
            </select>
          </SettingRow>
          <SettingRow label="Concurrent Downloads">
            <input
              type="number"
              min={1}
              max={5}
              value={draft.concurrentDownloads}
              onChange={(event) => setDraft({ ...draft, concurrentDownloads: Number(event.target.value) })}
            />
          </SettingRow>
          <div className="settings-actions end">
            <button onClick={() => save(draft)}>
              <CheckCircle2 size={16} />
              保存设置
            </button>
          </div>
        </section>

        <section className="surface settings-card">
          <PanelTitle title="Spotify Settings" icon={Globe2} />
          <div className="account-status">
            <span>Spotify Status</span>
            <strong>{authStatus?.connected ? "Logged in" : "Browser login available"}</strong>
          </div>
          <p className="muted">普通用户请使用系统浏览器连接 Spotify，内置页面只用于辅助浏览和复制链接。</p>
          <details className="advanced-settings">
            <summary>Advanced API Configuration</summary>
            <label>
              Spotify Client ID
              <input value={draft.spotifyClientId} onChange={(event) => setDraft({ ...draft, spotifyClientId: event.target.value })} />
            </label>
            <label>
              Spotify Client Secret
              <input type="password" value={draft.spotifyClientSecret} onChange={(event) => setDraft({ ...draft, spotifyClientSecret: event.target.value })} />
            </label>
            <div className="settings-actions">
              <button className="secondary" onClick={connectSpotify}>
                <ExternalLink size={16} />
                用浏览器连接 Spotify
              </button>
              {authStatus?.connected && <button className="secondary" onClick={disconnectSpotify}>断开</button>}
            </div>
          </details>
        </section>

        <section className="surface settings-card membership-card" data-state={membershipStatus?.state ?? "trial"}>
          <PanelTitle title="Membership" icon={Crown} />
          <div className="member-grid">
            <div>
              <span>Plan Status</span>
              <strong>{membershipStateText(membershipStatus?.state ?? "trial")}</strong>
            </div>
            <div>
              <span>Trial Downloads</span>
              <strong>500</strong>
            </div>
          </div>
          <SettingRow label="Activation Code">
            <input
              type="password"
              value={draft.membershipKey}
              onChange={(event) => setDraft({ ...draft, membershipKey: event.target.value })}
              placeholder="普通用户无需填写"
            />
            <button onClick={verifyMembership}>Activate</button>
            <button className="secondary" onClick={clearMembership}>Clear</button>
          </SettingRow>
        </section>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function PanelTitle({ title, action, onAction, icon: Icon }: { title: string; action?: string; onAction?: () => void; icon?: React.ElementType }) {
  return (
    <div className="panel-title">
      <h3>{Icon && <Icon size={18} />}{title}</h3>
      {action && <button className="text-action" onClick={onAction}>{action}</button>}
    </div>
  );
}

function CompactTask({ task }: { task: DownloadTask }) {
  return (
    <div className="mini-row">
      {task.track.artworkUrl ? <img src={task.track.artworkUrl} alt="" /> : <span className="art-fallback" />}
      <div>
        <strong>{task.track.title}</strong>
        <span>{task.track.artists.join(", ") || statusText(task.status)}</span>
        <i className="mini-progress"><em style={{ width: `${task.progress}%` }} /></i>
      </div>
      <span className="percent">{Math.round(task.progress)}%</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
}

interface TaskSummary {
  total: number;
  active: number;
  downloading: number;
  queued: number;
  completed: number;
  failed: number;
}

function useTaskSummary(tasks: DownloadTask[]): TaskSummary {
  return useMemo(
    () => ({
      total: tasks.length,
      active: tasks.filter((task) => ["queued", "searching", "downloading", "confirming"].includes(task.status)).length,
      downloading: tasks.filter((task) => task.status === "downloading").length,
      queued: tasks.filter((task) => ["queued", "searching", "confirming"].includes(task.status)).length,
      completed: tasks.filter((task) => task.status === "completed").length,
      failed: tasks.filter((task) => ["failed", "cancelled"].includes(task.status)).length
    }),
    [tasks]
  );
}

function pageTitle(page: Page): string {
  const map: Record<Page, string> = {
    home: "Task Center",
    import: "Import Music",
    downloads: "Download Queue",
    settings: "Settings & Account"
  };
  return map[page];
}

function pageSubtitle(page: Page): string {
  const map: Record<Page, string> = {
    home: "Monitor downloads, manage imports, and keep your library safe.",
    import: "Import music from Spotify to add to your library and download.",
    downloads: "Manage and monitor all download tasks in one place.",
    settings: "Customize your experience and manage your account preferences."
  };
  return map[page];
}

function taskMatchesQueueFilter(task: DownloadTask, filter: QueueFilter): boolean {
  if (filter === "all") return true;
  if (filter === "downloading") return task.status === "downloading";
  if (filter === "queued") return ["queued", "searching", "confirming"].includes(task.status);
  if (filter === "completed") return task.status === "completed";
  return ["failed", "cancelled"].includes(task.status);
}

function taskLocationText(task: DownloadTask, settings: AppSettings | null): string {
  if (task.outputPath) return task.outputPath;
  if (task.status === "completed") return "文件路径未记录";
  if (["queued", "searching", "confirming"].includes(task.status)) return "Path will be created after matching";
  if (["downloading", "paused"].includes(task.status)) return "File path will be finalized after download";
  return "No output file was created";
}

function statusText(status: DownloadTask["status"]): string {
  const map: Record<DownloadTask["status"], string> = {
    queued: "Queued",
    searching: "Matching",
    confirming: "Queued",
    downloading: "Downloading",
    paused: "Paused",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled"
  };
  return map[status];
}

function membershipStateText(state: MembershipStatus["state"]): string {
  const map: Record<MembershipStatus["state"], string> = {
    trial: "\u514d\u8d39\u4f7f\u7528",
    active: "VIP \u4f1a\u5458",
    expired: "\u4f1a\u5458\u5df2\u8fc7\u671f",
    invalid: "\u4f1a\u5458\u5f02\u5e38"
  };
  return map[state];
}

function canUseDownloads(_status: MembershipStatus | null): boolean {
  return true;
}

function collectionTypeLabel(type: SpotifyCollectionType): string {
  const map: Record<SpotifyCollectionType, string> = {
    playlist: "播放列表",
    album: "专辑",
    track: "单曲",
    artist: "艺人热门歌曲"
  };
  return map[type];
}

function detectSpotifyLibraryUrl(value: string): { type: SpotifyCollectionType; id: string; url: string } | null {
  const match = value.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album|track|artist)\/([a-zA-Z0-9]+)/i);
  const legacyPlaylistMatch = value.match(/open\.spotify\.com\/user\/[^/]+\/playlist\/([a-zA-Z0-9]+)/i);
  if (!match && !legacyPlaylistMatch) return null;
  if (!match && legacyPlaylistMatch) {
    return {
      type: "playlist",
      id: legacyPlaylistMatch[1],
      url: `https://open.spotify.com/playlist/${legacyPlaylistMatch[1]}`
    };
  }
  if (!match) return null;
  const type = match[1].toLowerCase() as SpotifyCollectionType;
  const id = match[2];
  return {
    type,
    id,
    url: `https://open.spotify.com/${type}/${id}`
  };
}

function normalizeSpotifyBrowserAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return spotifyBrowserHomeUrl;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(open\.)?spotify\.com/i.test(trimmed)) return `https://${trimmed}`;
  return spotifyBrowserHomeUrl;
}

function shouldStayInSpotifyPreview(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "open.spotify.com" || host === "accounts.spotify.com" || host.endsWith(".spotify.com");
  } catch {
    return true;
  }
}

function formatDuration(durationMs?: number): string {
  if (!durationMs) return "--:--";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function localFileUrl(path: string): string {
  return `file:///${path.replace(/\\/g, "/")}`;
}

createRoot(document.getElementById("root")!).render(<App />);
