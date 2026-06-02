import { BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { AppSettings, DownloadTask, MatchCandidate, TrackMetadata } from "../shared/types.js";
import { cleanYtdlpError, searchYoutubeCandidates } from "./matcher.js";
import { findProjectTool, toolEnvironment, ytdlpBaseArgs } from "./tools.js";

type SettingsProvider = () => Promise<AppSettings>;

export class DownloadManager {
  private tasks = new Map<string, DownloadTask>();
  private active = new Map<string, AbortController>();

  constructor(
    private getSettings: SettingsProvider,
    private stateFile: string
  ) {}

  async load(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.stateFile, "utf8")) as DownloadTask[];
      for (const task of saved) {
        const resumable = task.status === "downloading" || task.status === "searching" || task.status === "queued" || task.status === "confirming";
        this.tasks.set(task.id, {
          ...task,
          status: resumable ? (task.candidate ? "queued" : "searching") : task.status,
          progress: resumable ? 0 : task.progress,
          updatedAt: Date.now()
        });
      }
      void this.process();
    } catch {
      await this.persist();
    }
  }

  all(): DownloadTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async enqueue(track: TrackMetadata, candidate?: MatchCandidate): Promise<DownloadTask> {
    const now = Date.now();
    const task: DownloadTask = {
      id: crypto.randomUUID(),
      track,
      candidate,
      status: candidate ? "queued" : "searching",
      progress: 0,
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(task.id, task);
    await this.persistAndEmit();
    void this.process();
    return task;
  }

  async retry(taskId: string): Promise<DownloadTask | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    this.patch(taskId, { status: task.candidate ? "queued" : "searching", progress: 0, error: undefined });
    void this.process();
    return this.tasks.get(taskId) ?? null;
  }

  async approve(taskId: string): Promise<DownloadTask | null> {
    const task = this.tasks.get(taskId);
    if (!task?.candidate) return task ?? null;
    this.patch(taskId, { status: "queued", error: undefined });
    void this.process();
    return this.tasks.get(taskId) ?? null;
  }

  async pause(taskId: string): Promise<DownloadTask | null> {
    const active = this.active.get(taskId);
    active?.abort();
    this.patch(taskId, { status: "paused" });
    return this.tasks.get(taskId) ?? null;
  }

  async resume(taskId: string): Promise<DownloadTask | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    this.patch(taskId, { status: task.candidate ? "queued" : "searching" });
    void this.process();
    return this.tasks.get(taskId) ?? null;
  }

  async cancel(taskId: string): Promise<DownloadTask | null> {
    const active = this.active.get(taskId);
    active?.abort();
    this.patch(taskId, { status: "cancelled" });
    return this.tasks.get(taskId) ?? null;
  }

  private async process(): Promise<void> {
    const settings = await this.getSettings();
    const openSlots = Math.max(0, settings.concurrentDownloads - this.active.size);
    const pending = this.all()
      .filter((task) => task.status === "queued" || task.status === "searching" || task.status === "confirming")
      .slice(0, openSlots);

    for (const task of pending) {
      void this.runTask(task.id);
    }
  }

  private async runTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || this.active.has(taskId)) return;

    const abort = new AbortController();
    this.active.set(taskId, abort);

    try {
      const settings = await this.getSettings();
      let candidate = task.candidate;
      let candidatesToTry: MatchCandidate[] = candidate ? [candidate] : [];

      if (!candidate) {
        this.patch(taskId, { status: "searching", progress: 0 });
        const candidates = await searchYoutubeCandidates(task.track);
        candidate = candidates[0];
        if (!candidate) throw new Error("No YouTube candidate found.");
        candidatesToTry = candidates.slice(0, 5);
      }

      await mkdir(settings.downloadDirectory, { recursive: true });
      const template = path.join(settings.downloadDirectory, "%(title)s.%(ext)s");
      let lastError: unknown;

      for (const candidateToTry of candidatesToTry) {
        this.patch(taskId, { status: "downloading", candidate: candidateToTry, progress: 0, error: undefined });
        const args = [
          "--newline",
          "--continue",
          "--no-overwrites",
          "--format",
          audioFormatSelector(settings.audioQuality),
          "--extract-audio",
          "--embed-thumbnail",
          "--add-metadata",
          "--audio-quality",
          ffmpegAudioQuality(settings.audioQuality),
          "--output",
          template
        ];

        if (settings.outputFormat !== "best") {
          args.push("--audio-format", settings.outputFormat);
        }
        args.push(candidateToTry.url);

        try {
          await this.runDownload(taskId, args, abort.signal);
          if (!abort.signal.aborted) {
            this.patch(taskId, { status: "completed", progress: 100, error: undefined });
          }
          return;
        } catch (error) {
          lastError = error;
          if (abort.signal.aborted) throw error;
          this.patch(taskId, {
            progress: 0,
            error: `Candidate failed: ${error instanceof Error ? error.message : String(error)}`
          });
        }
      }

      throw lastError ?? new Error("No downloadable candidate found.");
    } catch (error) {
      const current = this.tasks.get(taskId);
      if (current?.status !== "paused" && current?.status !== "cancelled") {
        this.patch(taskId, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      this.active.delete(taskId);
      this.emit();
      void this.process();
    }
  }

  private runDownload(taskId: string, args: string[], signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(findProjectTool("yt-dlp"), [...ytdlpBaseArgs(), ...args], { windowsHide: true, env: toolEnvironment() });
      let stderr = "";

      child.stdout.on("data", (buffer: Buffer) => {
        const chunk = buffer.toString();
        const match = chunk.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (match) this.patch(taskId, { progress: Number(match[1]) });
      });
      child.stderr.on("data", (buffer: Buffer) => {
        stderr += buffer.toString();
      });

      signal.addEventListener(
        "abort",
        () => {
          child.kill();
          reject(new Error("Download stopped."));
        },
        { once: true }
      );
      child.on("error", (error) => reject(new Error(`yt-dlp is not available: ${error.message}`)));
      child.on("close", (code) => {
        if (signal.aborted) return;
        if (code === 0) resolve();
        else reject(new Error(cleanYtdlpError(stderr) || `yt-dlp exited with code ${code}`));
      });
    });
  }

  private patch(taskId: string, patch: Partial<DownloadTask>): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.tasks.set(taskId, { ...task, ...patch, updatedAt: Date.now() });
    void this.persistAndEmit();
  }

  private emit(): void {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send("tasks:changed", this.all());
    });
  }

  private async persistAndEmit(): Promise<void> {
    await this.persist();
    this.emit();
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.stateFile), { recursive: true });
    await writeFile(this.stateFile, JSON.stringify(this.all(), null, 2), "utf8");
  }
}

function audioFormatSelector(quality: AppSettings["audioQuality"]): string {
  if (quality === "small") return "bestaudio[abr<=96]/bestaudio/best";
  if (quality === "balanced") return "bestaudio[abr<=160]/bestaudio/best";
  return "bestaudio/best";
}

function ffmpegAudioQuality(quality: AppSettings["audioQuality"]): string {
  if (quality === "small") return "9";
  if (quality === "balanced") return "5";
  return "0";
}
