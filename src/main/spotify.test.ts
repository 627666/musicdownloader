import { describe, expect, it } from "vitest";
import { parseSpotifyCollectionLink, parseSpotifyEmbedHtml, parseSpotisaverHtml } from "./spotify.js";

describe("parseSpotifyCollectionLink", () => {
  it("recognizes Spotify album links", () => {
    expect(parseSpotifyCollectionLink("https://open.spotify.com/album/2CjB8o7PqZWrCTIODE8j4U?si=lMHll8koSei8vTN9HFbhBw")).toEqual({
      type: "album",
      id: "2CjB8o7PqZWrCTIODE8j4U"
    });
  });

  it("recognizes Spotify playlist links", () => {
    expect(parseSpotifyCollectionLink("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")).toEqual({
      type: "playlist",
      id: "37i9dQZF1DXcBWIGoYBM5M"
    });
  });
});

describe("parseSpotifyEmbedHtml", () => {
  it("reads public album tracks from Spotify embed data", () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          state: {
            data: {
              entity: {
                type: "album",
                id: "2CjB8o7PqZWrCTIODE8j4U",
                title: "生活麻辣燙",
                visualIdentity: {
                  image: [
                    { url: "https://image.example/small.jpg", maxWidth: 64 },
                    { url: "https://image.example/large.jpg", maxWidth: 640 }
                  ]
                },
                trackList: [
                  {
                    uri: "spotify:track:17o0DlBVfubE3kKUMjAQiz",
                    title: "Intro：翻山越岭",
                    subtitle: "王齐铭WatchMe",
                    duration: 104243,
                    isPlayable: true,
                    playabilityReason: "PLAYABLE"
                  },
                  {
                    uri: "spotify:track:3UIS0yCKq4XhsApUpzQkgR",
                    title: "生活麻辣烫",
                    subtitle: "王齐铭WatchMe",
                    duration: 184286,
                    isPlayable: false,
                    playabilityReason: "NOT_AVAILABLE"
                  }
                ]
              }
            }
          }
        }
      }
    })}</script></body></html>`;

    const result = parseSpotifyEmbedHtml(html, { type: "album", id: "2CjB8o7PqZWrCTIODE8j4U" });

    expect(result.playlistName).toBe("生活麻辣燙");
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0]).toMatchObject({
      id: "17o0DlBVfubE3kKUMjAQiz",
      title: "Intro：翻山越岭",
      artists: ["王齐铭WatchMe"],
      album: "生活麻辣燙",
      durationMs: 104243,
      artworkUrl: "https://image.example/large.jpg"
    });
    expect(result.tracks[1]?.title).toBe("生活麻辣烫");
  });
});

describe("parseSpotisaverHtml", () => {
  it("reads public fallback track rows without using download endpoints", () => {
    const html = `
      <meta property="og:title" content="生活麻辣燙" />
      <meta property="og:image" content="https://image.example/album.jpg" />
      <div class="track-item" itemscope itemtype="https://schema.org/MusicRecording">
        <img src="https://image.example/small.jpg" alt="Intro：翻山越岭" class="track-cover">
        <span class="track-name-text">Intro：翻山越岭</span>
        <span itemprop="byArtist">王齐铭WatchMe</span>
        <span class="track-duration">01:44</span>
        <a href="https://open.spotify.com/track/17o0DlBVfubE3kKUMjAQiz">Open</a>
      </div>
    `;

    const result = parseSpotisaverHtml(html, { type: "album", id: "2CjB8o7PqZWrCTIODE8j4U" });

    expect(result.playlistName).toBe("生活麻辣燙");
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      id: "17o0DlBVfubE3kKUMjAQiz",
      title: "Intro：翻山越岭",
      artists: ["王齐铭WatchMe"],
      album: "生活麻辣燙",
      durationMs: 104000
    });
  });
});
