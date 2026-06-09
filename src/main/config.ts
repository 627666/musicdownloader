import { app, dialog } from "electron";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { AppSettings } from "../shared/types.js";

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

export const defaultSettings = (): AppSettings => ({
  spotifyClientId: "",
  spotifyClientSecret: "",
  membershipKey: "",
  membershipValidationUrl: "",
  downloadDirectory: path.join(app.getPath("downloads"), "MusicDownloader"),
  outputFormat: "mp3",
  audioQuality: "best",
  concurrentDownloads: 2,
  autoDownloadThreshold: 82,
  confirmationThreshold: 58
});

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsFile(), "utf8");
    return saveSettings(await sanitizeSettings(JSON.parse(raw) as Partial<AppSettings>));
  } catch {
    const settings = defaultSettings();
    await saveSettings(settings);
    return settings;
  }
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const sanitized = await sanitizeSettings(settings);
  await mkdir(app.getPath("userData"), { recursive: true });
  await mkdir(sanitized.downloadDirectory, { recursive: true });
  await writeFile(settingsFile(), JSON.stringify(sanitized, null, 2), "utf8");
  return sanitized;
}

async function sanitizeSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const defaults = defaultSettings();
  const autoDownloadThreshold = Math.max(0, Math.min(100, Number(settings.autoDownloadThreshold) || 82));
  const confirmationThreshold = Math.min(
    autoDownloadThreshold,
    Math.max(0, Math.min(100, Number(settings.confirmationThreshold) || 58))
  );
  const downloadDirectory = await ensureWritableDirectory(settings.downloadDirectory?.trim() || defaults.downloadDirectory, defaults.downloadDirectory);

  return {
    ...defaults,
    ...settings,
    downloadDirectory,
    membershipKey: settings.membershipKey?.trim() ?? defaults.membershipKey,
    membershipValidationUrl: settings.membershipValidationUrl?.trim() ?? defaults.membershipValidationUrl,
    outputFormat: settings.outputFormat ?? defaults.outputFormat,
    audioQuality: settings.audioQuality ?? defaults.audioQuality,
    concurrentDownloads: Math.max(1, Math.min(5, Number(settings.concurrentDownloads) || 1)),
    autoDownloadThreshold,
    confirmationThreshold
  };
}

async function ensureWritableDirectory(candidate: string, fallback: string): Promise<string> {
  try {
    await mkdir(candidate, { recursive: true });
    await access(candidate, constants.W_OK);
    return candidate;
  } catch {
    await mkdir(fallback, { recursive: true });
    return fallback;
  }
}

export async function chooseDownloadDirectory(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Choose download folder"
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}
