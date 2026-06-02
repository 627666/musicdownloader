import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chooseDownloadDirectory, getSettings, saveSettings } from "./config.js";
import { DownloadManager } from "./downloadManager.js";
import { searchKeywordCandidates, searchYoutubeCandidates } from "./matcher.js";
import { disconnectSpotify, getSpotifyAuthStatus, importLibraryLink, importSpotifyPlaylist, startSpotifyLogin } from "./spotify.js";
import type { AppSettings, KeywordSearchInput, MatchCandidate, TrackMetadata } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.MUSICDOWNLOADER_DEV === "1";
let manager: DownloadManager;

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "Music Downloader",
    backgroundColor: "#f7f4ef",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await window.loadURL("http://localhost:5173");
  } else {
    await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  manager = new DownloadManager(getSettings, path.join(app.getPath("userData"), "download-tasks.json"));
  await manager.load();

  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:save", (_event, settings: AppSettings) => saveSettings(settings));
  ipcMain.handle("settings:chooseDownloadDirectory", () => chooseDownloadDirectory());
  ipcMain.handle("shell:openExternal", (_event, url: string) => shell.openExternal(url));
  ipcMain.handle("spotify:startLogin", async () => startSpotifyLogin(await getSettings()));
  ipcMain.handle("spotify:getAuthStatus", async () => getSpotifyAuthStatus(await getSettings()));
  ipcMain.handle("spotify:disconnect", async () => disconnectSpotify(await getSettings()));
  ipcMain.handle("library:importLink", async (_event, link: string) => importLibraryLink(link, await getSettings()));
  ipcMain.handle("search:keyword", async (_event, input: KeywordSearchInput) => searchKeywordCandidates(input, await getSettings()));
  ipcMain.handle("spotify:importPlaylist", async (_event, input: string) => importSpotifyPlaylist(input, await getSettings()));
  ipcMain.handle("matcher:searchCandidates", (_event, track: TrackMetadata) => searchYoutubeCandidates(track));
  ipcMain.handle("downloads:enqueue", (_event, track: TrackMetadata, candidate?: MatchCandidate) => manager.enqueue(track, candidate));
  ipcMain.handle("downloads:retry", (_event, taskId: string) => manager.retry(taskId));
  ipcMain.handle("downloads:approve", (_event, taskId: string) => manager.approve(taskId));
  ipcMain.handle("downloads:pause", (_event, taskId: string) => manager.pause(taskId));
  ipcMain.handle("downloads:resume", (_event, taskId: string) => manager.resume(taskId));
  ipcMain.handle("downloads:cancel", (_event, taskId: string) => manager.cancel(taskId));
  ipcMain.handle("downloads:getTasks", () => manager.all());

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
