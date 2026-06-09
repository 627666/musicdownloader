import { describe, expect, it } from "vitest";
import { scoreCandidate } from "./matcher.js";
import type { TrackMetadata } from "../shared/types.js";

const track: TrackMetadata = {
  id: "track-1",
  title: "Songbird",
  artists: ["Example Artist"],
  album: "First Album",
  durationMs: 180000
};

describe("scoreCandidate", () => {
  it("rewards title, artist, official wording, and close duration", () => {
    const result = scoreCandidate(track, {
      id: "candidate-1",
      title: "Example Artist - Songbird Official Audio",
      uploader: "Example Artist Topic",
      durationMs: 181000,
      url: "https://youtube.com/watch?v=1"
    });

    expect(result.score).toBeGreaterThanOrEqual(82);
    expect(result.riskTags).toEqual([]);
  });

  it("flags risky variants", () => {
    const result = scoreCandidate(track, {
      id: "candidate-2",
      title: "Songbird live cover remix",
      uploader: "Fan Channel",
      durationMs: 235000,
      url: "https://youtube.com/watch?v=2"
    });

    expect(result.score).toBeLessThan(58);
    expect(result.riskTags).toContain("live");
    expect(result.riskTags).toContain("cover");
    expect(result.riskTags).toContain("remix");
    expect(result.riskTags).toContain("duration mismatch");
  });

  it("rewards verified Chinese official results more than lyric variants", () => {
    const chineseTrack: TrackMetadata = {
      id: "track-zh",
      title: "稻香",
      artists: ["周杰伦"],
      durationMs: 224000
    };

    const official = scoreCandidate(chineseTrack, {
      id: "candidate-zh-1",
      title: "周杰倫 Jay Chou【稻香 Rice Field】-Official Music Video",
      uploader: "周杰倫 Jay Chou",
      durationMs: 224000,
      url: "https://youtube.com/watch?v=1",
      isVerified: true
    });
    const lyric = scoreCandidate(chineseTrack, {
      id: "candidate-zh-2",
      title: "【稻香】周杰伦 歌詞 pinyin",
      uploader: "Lyric Channel",
      durationMs: 224000,
      url: "https://youtube.com/watch?v=2"
    });

    expect(official.score).toBeGreaterThan(lyric.score);
    expect(lyric.riskTags).toContain("歌詞");
    expect(lyric.riskTags).toContain("pinyin");
  });

  it("penalizes numeric-only matches for Chinese numeral titles", () => {
    const chineseTrack: TrackMetadata = {
      id: "track-1991",
      title: "一九九一·冬",
      artists: ["王齐铭WatchMe"],
      album: "生活麻辣烫",
      durationMs: 184000
    };

    const correct = scoreCandidate(chineseTrack, {
      id: "candidate-1991-good",
      title: "王齐铭WatchMe - 一九九一·冬",
      uploader: "王齐铭WatchMe",
      durationMs: 184000,
      url: "https://youtube.com/watch?v=good",
      isVerified: true
    });
    const wrong = scoreCandidate(chineseTrack, {
      id: "candidate-1991-bad",
      title: "919",
      uploader: "Music Channel",
      durationMs: 184000,
      url: "https://youtube.com/watch?v=bad"
    });

    expect(correct.score).toBeGreaterThanOrEqual(85);
    expect(wrong.score).toBeLessThan(25);
    expect(wrong.riskTags).toContain("language mismatch");
    expect(wrong.riskTags).toContain("numeric title mismatch");
  });
});
