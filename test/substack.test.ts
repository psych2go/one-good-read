import { describe, expect, it } from "vitest";
import { isFreeTextPost } from "../src/sources/substack";

describe("Substack archive eligibility", () => {
  it("keeps free newsletter posts", () => expect(isFreeTextPost({ audience: "everyone", type: "newsletter", podcast_url: null, video_upload_id: null })).toBe(true));
  it("rejects paid, podcast, and video posts", () => {
    expect(isFreeTextPost({ audience: "only_paid", type: "newsletter" })).toBe(false);
    expect(isFreeTextPost({ audience: "everyone", type: "newsletter", podcast_url: "https://example.com/audio" })).toBe(false);
    expect(isFreeTextPost({ audience: "everyone", type: "newsletter", video_upload_id: "video" })).toBe(false);
  });
});
