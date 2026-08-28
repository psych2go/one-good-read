import { describe, expect, it } from "vitest";
import { isFreeTextPost, isSubstackSitemapCandidate, parseSubstackSitemap } from "../src/sources/substack";

describe("Substack archive eligibility", () => {
  it("keeps free newsletter posts", () => expect(isFreeTextPost({ audience: "everyone", type: "newsletter", podcast_url: null, video_upload_id: null })).toBe(true));
  it("rejects paid, podcast, and video posts", () => {
    expect(isFreeTextPost({ audience: "only_paid", type: "newsletter" })).toBe(false);
    expect(isFreeTextPost({ audience: "everyone", type: "newsletter", podcast_url: "https://example.com/audio" })).toBe(false);
    expect(isFreeTextPost({ audience: "everyone", type: "newsletter", video_upload_id: "video" })).toBe(false);
  });

  it("extracts same-origin post URLs from a sitemap", () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://example.substack.com/archive</loc></url><url><loc>https://example.substack.com/p/first-post</loc></url><url><loc>https://example.substack.com/p/second-post?utm_source=x&amp;v=1</loc></url><url><loc>https://other.example/p/nope</loc></url></urlset>`;
    expect(parseSubstackSitemap(xml, "https://example.substack.com")).toEqual([
      "https://example.substack.com/p/first-post",
      "https://example.substack.com/p/second-post?utm_source=x&v=1",
    ]);
  });
  it("filters non-article sitemap entries before they consume analysis work", () => {
    expect(isSubstackSitemapCandidate("https://example.substack.com/p/a-serious-essay")).toBe(true);
    expect(isSubstackSitemapCandidate("https://example.substack.com/p/hidden-open-thread-4445")).toBe(false);
    expect(isSubstackSitemapCandidate("https://example.substack.com/p/links-for-april-2026")).toBe(false);
    expect(isSubstackSitemapCandidate("https://example.substack.com/p/spring-meetups-everywhere-call")).toBe(false);
    expect(isSubstackSitemapCandidate("https://example.substack.com/p/take-the-2026-acx-survey")).toBe(false);
  });

});
