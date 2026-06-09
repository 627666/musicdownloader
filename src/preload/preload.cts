import { contextBridge, ipcRenderer } from "electron";
import type { AppApi, AppSettings, DownloadTask, MatchCandidate, TrackMetadata } from "../shared/types.js";

const api: AppApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("settings:save", settings),
  chooseDownloadDirectory: () => ipcRenderer.invoke("settings:chooseDownloadDirectory"),
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  openPath: (path: string) => ipcRenderer.invoke("shell:openPath", path),
  getMembershipStatus: () => ipcRenderer.invoke("membership:getStatus"),
  verifyMembership: () => ipcRenderer.invoke("membership:verify"),
  clearMembership: () => ipcRenderer.invoke("membership:clear"),
  startSpotifyLogin: () => ipcRenderer.invoke("spotify:startLogin"),
  getSpotifyAuthStatus: () => ipcRenderer.invoke("spotify:getAuthStatus"),
  disconnectSpotify: () => ipcRenderer.invoke("spotify:disconnect"),
  importLibraryLink: (link: string) => ipcRenderer.invoke("library:importLink", link),
  importSpotifyPlaylist: (playlistUrlOrId: string) => ipcRenderer.invoke("spotify:importPlaylist", playlistUrlOrId),
  enqueueDownload: (track: TrackMetadata, candidate?: MatchCandidate) => ipcRenderer.invoke("downloads:enqueue", track, candidate),
  retryTask: (taskId: string) => ipcRenderer.invoke("downloads:retry", taskId),
  approveTask: (taskId: string) => ipcRenderer.invoke("downloads:approve", taskId),
  pauseTask: (taskId: string) => ipcRenderer.invoke("downloads:pause", taskId),
  resumeTask: (taskId: string) => ipcRenderer.invoke("downloads:resume", taskId),
  cancelTask: (taskId: string) => ipcRenderer.invoke("downloads:cancel", taskId),
  removeTask: (taskId: string) => ipcRenderer.invoke("downloads:remove", taskId),
  getTasks: () => ipcRenderer.invoke("downloads:getTasks"),
  onTasksChanged: (callback: (tasks: DownloadTask[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, tasks: DownloadTask[]) => callback(tasks);
    ipcRenderer.on("tasks:changed", listener);
    return () => ipcRenderer.off("tasks:changed", listener);
  }
};

contextBridge.exposeInMainWorld("musicDownloader", api);
