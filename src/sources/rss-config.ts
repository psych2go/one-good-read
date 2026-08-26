import type { RssSourceConfig } from "./rss";

export const RSS_SOURCE_CONFIGS: RssSourceConfig[] = [
  {
    sourceId: "nassim-taleb",
    feedUrl: "https://nntaleb.substack.com/feed",
    defaultAuthor: "Nassim Nicholas Taleb",
    allowedAuthors: ["Nassim Nicholas Taleb"],
  },
  {
    sourceId: "farnam-street",
    feedUrl: "https://fs.blog/feed/",
    defaultAuthor: "Farnam Street",
    exclude: (item) => /knowledge-project-podcast|\/podcast\//i.test(item.link) || /\bpodcast\b/i.test(item.title),
  },
  {
    sourceId: "astral-codex-ten",
    feedUrl: "https://www.astralcodexten.com/feed",
    defaultAuthor: "Scott Alexander",
    allowedAuthors: ["Scott Alexander"],
    exclude: (item) => /^(?:open thread|meetups?|classifieds?|links for)/i.test(item.title),
  },
  {
    sourceId: "aswath-damodaran",
    feedUrl: "https://aswathdamodaran.blogspot.com/feeds/posts/default?alt=rss&max-results=10",
    defaultAuthor: "Aswath Damodaran",
    allowedAuthors: ["Aswath Damodaran"],
    normalizeAuthor: () => "Aswath Damodaran",
  },
  {
    sourceId: "stratechery",
    feedUrl: "https://stratechery.com/feed/",
    defaultAuthor: "Ben Thompson",
    allowedAuthors: ["Ben Thompson"],
    exclude: (item) => !item.categories.includes("Articles"),
  },
  {
    sourceId: "benedict-evans",
    feedUrl: "https://www.ben-evans.com/benedictevans?format=rss",
    defaultAuthor: "Benedict Evans",
    allowedAuthors: ["Benedict Evans"],
  },
];
