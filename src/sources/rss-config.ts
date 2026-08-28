import type { RssSourceConfig } from "./rss";

export const RSS_SOURCE_CONFIGS: RssSourceConfig[] = [
  {
    sourceId: "aswath-damodaran",
    feedUrl: "https://aswathdamodaran.blogspot.com/feeds/posts/default?alt=rss&max-results=10",
    defaultAuthor: "Aswath Damodaran",
    allowedAuthors: ["Aswath Damodaran"],
    normalizeAuthor: () => "Aswath Damodaran",
    pageUrl: (page) => `https://aswathdamodaran.blogspot.com/feeds/posts/default?alt=rss&max-results=10&start-index=${(page - 1) * 10 + 1}`,
    articleSelector: ".post-body.entry-content",
  },
  {
    sourceId: "stratechery",
    feedUrl: "https://stratechery.com/feed/",
    defaultAuthor: "Ben Thompson",
    allowedAuthors: ["Ben Thompson"],
    exclude: (item) => !item.categories.includes("Articles"),
    pageUrl: (page) => `https://stratechery.com/feed/?paged=${page}`,
    articleSelector: ".entry-content",
  },
  {
    sourceId: "benedict-evans",
    feedUrl: "https://www.ben-evans.com/benedictevans?format=rss",
    defaultAuthor: "Benedict Evans",
    allowedAuthors: ["Benedict Evans"],
    pageUrl: (page) => `https://www.ben-evans.com/benedictevans?format=rss&page=${page}`,
    articleSelector: "article",
  },
];
