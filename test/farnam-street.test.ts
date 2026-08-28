import { describe, expect, it } from "vitest";
import { farnamArchivePageUrl, isFarnamArticle } from "../src/sources/farnam-street";

describe("Farnam Street archive adapter", () => {
  it("walks the official archive pages", () => {
    expect(farnamArchivePageUrl(1)).toBe("https://fs.blog/blog/");
    expect(farnamArchivePageUrl(5)).toBe("https://fs.blog/blog/page/5/");
  });

  it("keeps public essays and excludes member or media entries", () => {
    expect(isFarnamArticle("https://fs.blog/ride-wave/", "Ride the Wave")).toBe(true);
    expect(isFarnamArticle("https://fs.blog/upside-of-patience/", "[FS Members] Lessons from Rockefeller")).toBe(false);
    expect(isFarnamArticle("https://fs.blog/knowledge-project-podcast/example/", "A conversation")).toBe(false);
  });
});
