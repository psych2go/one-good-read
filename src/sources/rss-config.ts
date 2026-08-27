import type { RssSourceConfig } from "./rss";

export const RSS_SOURCE_CONFIGS: RssSourceConfig[] = [
  {
    sourceId: "farnam-street",
    feedUrl: "https://fs.blog/feed/",
    defaultAuthor: "Farnam Street",
    exclude: (item) => /knowledge-project-podcast|\/podcast\//i.test(item.link) || /\bpodcast\b/i.test(item.title),
    pageUrl: (page) => `https://fs.blog/feed/?paged=${page}`,
  },
  {
    sourceId: "aswath-damodaran",
    feedUrl: "https://aswathdamodaran.blogspot.com/feeds/posts/default?alt=rss&max-results=10",
    defaultAuthor: "Aswath Damodaran",
    allowedAuthors: ["Aswath Damodaran"],
    normalizeAuthor: () => "Aswath Damodaran",
    pageUrl: (page) => `https://aswathdamodaran.blogspot.com/feeds/posts/default?alt=rss&max-results=10&start-index=${(page - 1) * 10 + 1}`,
  },
  {
    sourceId: "stratechery",
    feedUrl: "https://stratechery.com/feed/",
    defaultAuthor: "Ben Thompson",
    allowedAuthors: ["Ben Thompson"],
    exclude: (item) => !item.categories.includes("Articles"),
    pageUrl: (page) => `https://stratechery.com/feed/?paged=${page}`,
  },
  {
    sourceId: "benedict-evans",
    feedUrl: "https://www.ben-evans.com/benedictevans?format=rss",
    defaultAuthor: "Benedict Evans",
    allowedAuthors: ["Benedict Evans"],
    pageUrl: (page) => `https://www.ben-evans.com/benedictevans?format=rss&page=${page}`,
  },
];
