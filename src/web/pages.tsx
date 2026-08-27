import type { RecommendationPageRow } from "../db/queries";
import { formatPublicDate } from "../domain/date";
import { Layout } from "./layout";

function RecommendationCard({ item }: { item: RecommendationPageRow }) {
  const date = formatPublicDate(item.recommendation_date);
  const keywords = JSON.parse(item.public_keywords) as string[];
  const originalDate = item.published_at_original ? new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(item.published_at_original)) : null;
  return <article class="reading-sheet">
    <aside class="date-stamp" aria-label={`推荐日期 ${item.recommendation_date}`}>
      <span>{date.month}</span><strong>{date.day}</strong><span>{date.year}</span><i>{date.weekday}</i>
    </aside>
    <div class="reading-content">
      <p class="edition-label">TODAY’S READING</p>
      <h1>{item.title}</h1>
      <p class="byline">{item.author}{originalDate ? ` · ${originalDate}` : ""}</p>
      <div class="editor-note"><h2>为什么值得读</h2><p>{item.why_worth_reading}</p></div>
      <div class="editor-note today"><h2>为什么今天推荐</h2><p>{item.why_today}</p></div>
      <div class="reading-meta"><span>{item.reading_minutes} 分钟</span>{keywords.map((keyword) => <span>{keyword}</span>)}</div>
      <a class="read-button" href={item.canonical_url} target="_blank" rel="noopener noreferrer">阅读原文 <span aria-hidden="true">↗</span></a>
    </div>
  </article>;
}

export function HomePage({ item, origin }: { item: RecommendationPageRow | null; origin: string }) {
  if (!item) return <Layout title="One Good Read" description="每天，从精选博客中自动选出一篇值得认真阅读的文章。" canonical={origin}>
    <section class="empty-state"><p class="edition-label">ONE GOOD READ</p><h1>第一篇阅读正在准备中。</h1><p>候选池和生产自动化正在准备中。启用后，系统会在北京时间早上六点发布。</p></section>
  </Layout>;
  return <Layout title={`${item.title} — One Good Read`} description={item.why_worth_reading} canonical={`${origin}/read/${item.recommendation_date}`}><RecommendationCard item={item} /></Layout>;
}

export function ReadPage({ item, origin }: { item: RecommendationPageRow; origin: string }) {
  return <Layout title={`${item.title} — One Good Read`} description={item.why_worth_reading} canonical={`${origin}/read/${item.recommendation_date}`}><RecommendationCard item={item} /></Layout>;
}

export function ArchivePage(props: { rows: RecommendationPageRow[]; facets: { authors: string[]; themes: string[]; years: string[] }; page: number; hasNext: boolean; filters: { author?: string; theme?: string; year?: string }; origin: string }) {
  const query = (page: number) => { const params = new URLSearchParams(); if (props.filters.author) params.set("author", props.filters.author); if (props.filters.theme) params.set("theme", props.filters.theme); if (props.filters.year) params.set("year", props.filters.year); params.set("page", String(page)); return `/archive?${params}`; };
  return <Layout title="Archive — One Good Read" description="One Good Read 的每日阅读档案。" canonical={`${props.origin}/archive`}>
    <section class="archive-shell">
      <header class="page-intro"><p class="edition-label">THE ARCHIVE</p><h1>过去的每日一读</h1><p>这里不是待读清单，只是每天选择过什么的记录。</p></header>
      <form class="filters" method="get"><label>作者<select name="author"><option value="">全部</option>{props.facets.authors.map((v) => <option value={v} selected={v === props.filters.author}>{v}</option>)}</select></label><label>主题<select name="theme"><option value="">全部</option>{props.facets.themes.map((v) => <option value={v} selected={v === props.filters.theme}>{v}</option>)}</select></label><label>年份<select name="year"><option value="">全部</option>{props.facets.years.map((v) => <option value={v} selected={v === props.filters.year}>{v}</option>)}</select></label><button>筛选</button></form>
      <ol class="archive-list">{props.rows.map((item) => <li><time>{item.recommendation_date}</time><div><a href={`/read/${item.recommendation_date}`}>{item.title}</a><p>{item.author} · {item.primary_theme}</p></div></li>)}</ol>
      {!props.rows.length ? <p class="empty-list">没有符合条件的历史推荐。</p> : null}
      <nav class="pagination">{props.page > 1 ? <a href={query(props.page - 1)}>← 上一页</a> : <span />}{props.hasNext ? <a href={query(props.page + 1)}>下一页 →</a> : null}</nav>
    </section>
  </Layout>;
}

export function AboutPage({ origin }: { origin: string }) {
  return <Layout title="About — One Good Read" description="One Good Read 如何每天选择一篇值得读的文章。" canonical={`${origin}/about`}>
    <article class="about-page"><p class="edition-label">ABOUT THE PROJECT</p><h1>每天，只认真选择一篇。</h1><p class="lede">One Good Read 从一组人工选定的作者和博客中，自动挑选一篇值得花时间阅读的文章。</p><section><h2>怎么选择</h2><p>系统阅读全文，评估长期价值、思想密度、论证质量、原创性和表达结构；同时避免作者与主题过度重复，并为陌生但高质量的思想保留探索空间。</p></section><section><h2>它不做什么</h2><p>这里不转载全文，不绕过登录或付费限制，也不使用 AI 摘要替代原文。推荐表示值得认真阅读，不表示对文章全部观点的背书。</p></section><section><h2>首批来源</h2><ul class="source-list"><li>Paul Graham</li><li>Morgan Housel、Ted Lamade / Collaborative Fund</li><li>Nassim Nicholas Taleb</li><li>Farnam Street</li><li>Howard Marks Memos</li><li>Scott Alexander / Astral Codex Ten</li><li>Ben Thompson / Stratechery</li><li>Tyler Cowen、Alex Tabarrok / Marginal Revolution</li><li>Aswath Damodaran</li><li>Benedict Evans</li></ul><p>Bloomberg Money Stuff 会在确认存在合规、稳定且免费全文可读的自动发现路径后接入。</p></section><section><h2>Open source</h2><p>代码、评分提示词和部署文档采用 MIT License 开源；私人反馈、偏好模型、密钥和运行数据不会公开。</p></section></article>
  </Layout>;
}
