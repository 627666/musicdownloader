# Music Downloader

Electron + React desktop app for importing Spotify playlist metadata, matching tracks to public YouTube results, and downloading through `yt-dlp`.

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

Create a Spotify developer app and paste the Client ID and Client Secret into Settings. The app uses the Client Credentials flow for public playlist imports.

## Current v1 Features

- Spotify public playlist import by URL or playlist ID.
- Manual song search.
- YouTube candidate search through `yt-dlp`.
- Match scoring with duration, title, artist, official audio, remix, live, and cover signals.
- Queue, pause, resume, retry, and cancel controls.
- User-selectable output format with MP3 as the default.
