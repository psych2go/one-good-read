import { Layout } from "./layout";

interface AdminData {
  counts: { articles: number; ready: number; recommendations: number; failures: number };
  sources: Array<{ id: string; name: string; status: string; last_scanned_at: string | null; consecutive_failures: number }>;
  runs: Array<{ id: string; recommendation_date: string; status: string; winner_title: string | null; failure_reason: string | null; created_at: string }>;
  recommendations: Array<{ id: string; recommendation_date: string; title: string; author: string; feedback_kind: string | null }>;
}

export function AdminPage({ data }: { data: AdminData }) {
  return <Layout title="Admin — One Good Read" description="One Good Read 管理后台" noIndex>
    <section class="admin-shell"><header class="page-intro"><p class="edition-label">CONTROL ROOM</p><h1>系统状态</h1><p>自动运行，人工只在需要时熔断。</p></header>
      <div class="metrics"><Metric label="已发现文章" value={data.counts.articles} /><Metric label="候选文章" value={data.counts.ready} /><Metric label="已发布" value={data.counts.recommendations} /><Metric label="失败任务" value={data.counts.failures} /></div>
      <section class="admin-panel"><h2>立即运行</h2><div class="action-row"><form method="post" action="/admin/run-daily"><button>启动今日流程</button></form><form method="post" action="/admin/backfill"><button class="secondary">回填首批来源</button></form></div></section>
      <section class="admin-panel"><h2>来源健康</h2><div class="table-wrap"><table><thead><tr><th>来源</th><th>状态</th><th>上次扫描</th><th>连续失败</th></tr></thead><tbody>{data.sources.map((source) => <tr><td>{source.name}</td><td>{source.status}</td><td>{source.last_scanned_at ?? "尚未扫描"}</td><td>{source.consecutive_failures}</td></tr>)}</tbody></table></div></section>
      <section class="admin-panel"><h2>最近选文运行</h2><div class="table-wrap"><table><thead><tr><th>日期</th><th>状态</th><th>文章</th><th>说明</th></tr></thead><tbody>{data.runs.map((run) => <tr><td>{run.recommendation_date}</td><td>{run.status}</td><td>{run.winner_title ?? "—"}</td><td>{run.failure_reason ?? "—"}</td></tr>)}</tbody></table></div></section>
      <section class="admin-panel"><h2>反馈</h2>{data.recommendations.map((item) => <div class="feedback-row"><div><strong>{item.recommendation_date} · {item.title}</strong><span>{item.author}{item.feedback_kind ? ` · 已反馈：${item.feedback_kind}` : ""}</span></div><form method="post" action={`/admin/recommendations/${item.id}/feedback`}><button name="kind" value="valuable">非常有价值</button><button name="kind" value="good">还不错</button><button name="kind" value="not_for_me">不适合我</button><button name="kind" value="unfinished">没读完</button><button name="kind" value="later">稍后再读</button></form></div>)}</section>
    </section>
  </Layout>;
}
function Metric({ label, value }: { label: string; value: number }) { return <div class="metric"><strong>{value}</strong><span>{label}</span></div>; }
