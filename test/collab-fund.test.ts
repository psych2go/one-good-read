import { describe, expect, it } from "vitest";
import { isCollabArticleUrl } from "../src/sources/collab-fund";
describe("Collaborative Fund URL scope", () => {
  it("accepts blog article slugs", () => expect(isCollabArticleUrl("https://collabfund.com/blog/long-term-money/")).toBe(true));
  it("rejects author and index pages", () => { expect(isCollabArticleUrl("https://collabfund.com/blog/authors/morgan/")).toBe(false); expect(isCollabArticleUrl("https://collabfund.com/blog/")).toBe(false); });
});
