import { contextBridge, ipcRenderer } from "electron";
import type { AppApi, AppSettings, DownloadTask, KeywordSearchInput, MatchCandidate, TrackMetadata } from "../shared/types.js";

const api: AppApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("settings:save", settings),
  chooseDownloadDirectory: () => ipcRenderer.invoke("settings:chooseDownloadDirectory"),
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  startSpotifyLogin: () => ipcRenderer.invoke("spotify:startLogin"),
  getSpotifyAuthStatus: () => ipcRenderer.invoke("spotify:getAuthStatus"),
  disconnectSpotify: () => ipcRenderer.invoke("spotify:disconnect"),
  importLibraryLink: (link: string) => ipcRenderer.invoke("library:importLink", link),
  searchKeyword: (input: KeywordSearchInput) => ipcRenderer.invoke("search:keyword", input),
  importSpotifyPlaylist: (playlistUrlOrId: string) => ipcRenderer.invoke("spotify:importPlaylist", playlistUrlOrId),
  searchCandidates: (track: TrackMetadata) => ipcRenderer.invoke("matcher:searchCandidates", track),
  enqueueDownload: (track: TrackMetadata, candidate?: MatchCandidate) => ipcRenderer.invoke("downloads:enqueue", track, candidate),
  retryTask: (taskId: string) => ipcRenderer.invoke("downloads:retry", taskId),
  approveTask: (taskId: string) => ipcRenderer.invoke("downloads:approve", taskId),
  pauseTask: (taskId: string) => ipcRenderer.invoke("downloads:pause", taskId),
  resumeTask: (taskId: string) => ipcRenderer.invoke("downloads:resume", taskId),
  cancelTask: (taskId: string) => ipcRenderer.invoke("downloads:cancel", taskId),
  getTasks: () => ipcRenderer.invoke("downloads:getTasks"),
  onTasksChanged: (callback: (tasks: DownloadTask[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, tasks: DownloadTask[]) => callback(tasks);
    ipcRenderer.on("tasks:changed", listener);
    return () => ipcRenderer.off("tasks:changed", listener);
  }
};

contextBridge.exposeInMainWorld("musicDownloader", api);
