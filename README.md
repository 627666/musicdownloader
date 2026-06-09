# Music Downloader

Electron + React desktop app for importing Spotify library metadata, matching imported tracks to public YouTube results, and downloading through `yt-dlp`.

This project deliberately does not download audio from Spotify or Apple Music and does not bypass DRM. Spotify is used only as a metadata and playlist source.

## Quick Start

1. Install Node.js and npm.
2. Install dependencies:

   ```powershell
   npm install
   ```

3. Install `yt-dlp` and `ffmpeg`, then make both available on your PATH.
4. Start the app:

   ```powershell
   npm run dev
   ```

## Spotify Setup

普通用户可以在导入页使用 Spotify 浏览器登录自己的账号，或直接粘贴 Spotify 专辑、播放列表、单曲、艺人链接。高级 Spotify API 配置保留给完整分页导入和后续产品化封装使用。

## Current v1 Features

- Spotify 专辑、播放列表、单曲、艺人链接导入。
- Spotify 浏览器导入入口。
- 导入曲目自动匹配公开 YouTube 音源并通过 `yt-dlp` 下载。
- Match scoring with duration, title, artist, official audio, remix, live, and cover signals.
- Queue, pause, resume, retry, and cancel controls.
- User-selectable output format with MP3 as the default.

## Online Launch

The `web/` directory contains a lightweight public website and membership API template:

- SEO-ready landing page for search engine indexing.
- Download button placeholders for installer links.
- Membership registration form.
- Cloudflare Worker validation endpoint compatible with the app's `Validation URL` setting.

See `docs/ONLINE_LAUNCH.md` for the deployment checklist.
