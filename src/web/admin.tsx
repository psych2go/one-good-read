import { Layout } from "./layout";

interface SimulationRow {
  simulation_date: string;
  title: string;
  author: string;
  canonical_url: string;
  reading_minutes: number;
  why_worth_reading: string;
  why_today: string;
  public_keywords: string;
  feedback_kind: string | null;
  created_at: string;
}

interface AdminData {
  automationEnabled: boolean;
  counts: { articles: number; ready: number; recommendations: number; failures: number; embeddings: number };
  preferenceModel?: { sample_count: number; max_influence: number; metrics: string; created_at: string };
  storage: { usedBytes: number; limitBytes: number; ratio: number; level: "ok" | "warning" | "critical"; objectCount: number };
  alerts: Array<{ alert_type: string; severity: string; subject: string; delivery_status: string; created_at: string }>;
  reservoir?: { value: string; updated_at: string };
  simulation?: { value: string; updated_at: string };
  simulationRows: SimulationRow[];
  sources: Array<{ id: string; name: string; status: string; last_scanned_at: string | null; consecutive_failures: number }>;
  runs: Array<{ id: string; recommendation_date: string; status: string; winner_title: string | null; failure_reason: string | null; created_at: string }>;
  recommendations: Array<{ id: string; recommendation_date: string; title: string; author: string; retry_count: number; feedback_kind: string | null }>;
}

export function AdminPage({ data }: { data: AdminData }) {
  return <Layout title="Admin — One Good Read" description="One Good Read 管理后台" noIndex>
    <section class="admin-shell">
      <header class="page-intro"><p class="edition-label">CONTROL ROOM</p><h1>系统状态</h1><p>自动运行，人工只在需要时熔断。</p></header>
      <div class="metrics"><Metric label="已发现文章" value={data.counts.articles} /><Metric label="候选文章" value={data.counts.ready} /><Metric label="已发布" value={data.counts.recommendations} /><Metric label="失败任务" value={data.counts.failures} /><Metric label="Embedding" value={data.counts.embeddings} /></div>

      <section class="admin-panel"><h2>立即运行</h2><div class="action-row">
        <form method="post" action="/admin/run-daily"><button disabled={!data.automationEnabled}>{data.automationEnabled ? "从当前候选生成今日推荐" : "正式发布已锁定"}</button></form>
        <form method="post" action="/admin/backfill"><button class="secondary">回填首批来源</button></form>
        <form method="post" action="/admin/run-reservoir"><button class="secondary">运行 Reservoir 批次</button></form>
        <form method="post" action="/admin/run-simulation"><button class="secondary">运行模拟门槛检查</button></form>
        <form method="post" action="/admin/backfill-embeddings"><button class="secondary">回填 Embedding</button></form>
        <form method="post" action="/admin/train-preference"><button class="secondary">训练偏好模型</button></form>
      </div>{!data.automationEnabled && <p class="admin-hint">私有模拟期间，正式发布按钮由服务器和界面双重锁定。</p>}</section>

      <section class="admin-panel"><h2>存储与生命周期</h2><p>已跟踪 {data.storage.objectCount} 个对象 · {(data.storage.usedBytes / 1024 / 1024).toFixed(1)} MiB / {(data.storage.limitBytes / 1024 / 1024 / 1024).toFixed(1)} GiB · 状态 {data.storage.level}</p><form method="post" action="/admin/cleanup-storage"><button class="secondary">清理过期正文</button></form></section>
      <section class="admin-panel"><h2>Reservoir 回填</h2><p>{data.reservoir ? `最近状态 ${data.reservoir.updated_at} · ${data.reservoir.value}` : "尚无协调器运行记录。"}</p></section>

      <section class="admin-panel"><h2>7天不公开模拟</h2><p>{data.simulation ? `${data.simulation.updated_at} · ${data.simulation.value}` : "候选达到300篇后自动开始。"}</p>
        <div class="simulation-list">{data.simulationRows.map((row) => <article class="simulation-review">
          <div class="simulation-heading"><div><span>{row.simulation_date}</span><h3><a href={row.canonical_url} target="_blank" rel="noopener noreferrer">{row.title} <span aria-hidden="true">↗</span></a></h3><p>{row.author} · 预计阅读 {row.reading_minutes} 分钟</p></div>{row.feedback_kind && <strong>已反馈：{feedbackLabel(row.feedback_kind)}</strong>}</div>
          <div class="simulation-notes"><div><h4>为什么值得读</h4><p>{row.why_worth_reading}</p></div><div><h4>为什么今天读</h4><p>{row.why_today}</p></div></div>
          <div class="simulation-keywords">{parseKeywords(row.public_keywords).map((keyword) => <span>{keyword}</span>)}</div>
          <FeedbackButtons action={`/admin/simulations/${row.simulation_date}/feedback`} selected={row.feedback_kind} />
        </article>)}</div>
      </section>

      <section class="admin-panel"><h2>偏好模型</h2><p>{data.preferenceModel ? `${data.preferenceModel.sample_count} 条有效反馈 · 最大影响 ${(data.preferenceModel.max_influence * 100).toFixed(0)}% · ${data.preferenceModel.created_at}` : "有效反馈不足 10 条，个人模型尚未启用。模拟反馈也会计入样本。"}</p></section>
      <section class="admin-panel"><h2>来源健康</h2><div class="table-wrap"><table><thead><tr><th>来源</th><th>状态</th><th>上次扫描</th><th>连续失败</th><th>操作</th></tr></thead><tbody>{data.sources.map((source) => <tr><td>{source.name}</td><td>{source.status}</td><td>{source.last_scanned_at ?? "尚未扫描"}</td><td>{source.consecutive_failures}</td><td><form method="post" action={`/admin/backfill/${source.id}`}><button>回填</button></form></td></tr>)}</tbody></table></div></section>
      <section class="admin-panel"><h2>最近选文运行</h2><div class="table-wrap"><table><thead><tr><th>日期</th><th>状态</th><th>文章</th><th>说明</th></tr></thead><tbody>{data.runs.map((run) => <tr><td>{run.recommendation_date}</td><td>{run.status}</td><td>{run.winner_title ?? "—"}</td><td>{run.failure_reason ?? "—"}</td></tr>)}</tbody></table></div></section>
      <section class="admin-panel"><h2>最近告警</h2><div class="table-wrap"><table><thead><tr><th>时间</th><th>级别</th><th>告警</th><th>投递</th></tr></thead><tbody>{data.alerts.map((alert) => <tr><td>{alert.created_at}</td><td>{alert.severity}</td><td>{alert.subject}</td><td>{alert.delivery_status}</td></tr>)}</tbody></table></div></section>
      <section class="admin-panel"><h2>正式推荐反馈</h2>{data.recommendations.map((item) => <div class="feedback-row"><div><strong>{item.recommendation_date} · {item.title}</strong><span>{item.author}{item.feedback_kind ? ` · 已反馈：${feedbackLabel(item.feedback_kind)}` : ""}{item.retry_count ? ` · 重试 ${item.retry_count}/2` : ""}</span></div><FeedbackButtons action={`/admin/recommendations/${item.id}/feedback`} selected={item.feedback_kind} /></div>)}</section>
    </section>
  </Layout>;
}

function FeedbackButtons({ action, selected }: { action: string; selected: string | null }) {
  return <form class="feedback-actions" method="post" action={action}>
    <button class={selected === "valuable" ? "selected" : ""} name="kind" value="valuable">非常有价值</button>
    <button class={selected === "good" ? "selected" : ""} name="kind" value="good">还不错</button>
    <button class={selected === "not_for_me" ? "selected" : ""} name="kind" value="not_for_me">不适合我</button>
    <button class={selected === "unfinished" ? "selected" : ""} name="kind" value="unfinished">没读完</button>
    <button class={selected === "later" ? "selected" : ""} name="kind" value="later">稍后再读</button>
  </form>;
}
function Metric({ label, value }: { label: string; value: number }) { return <div class="metric"><strong>{value}</strong><span>{label}</span></div>; }
function feedbackLabel(value: string): string { return ({ valuable: "非常有价值", good: "还不错", not_for_me: "不适合我", unfinished: "没读完", later: "稍后再读" } as Record<string, string>)[value] ?? value; }
function parseKeywords(value: string): string[] { try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }
